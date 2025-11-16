import {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {
        Conversation,
        ConversationItem,
        ConversationPreview,
        getConversationItemMixedID,
        isLocalConversationID,
        isRemoteConversationID,
        LinkedConversation,
        LocalConversationID,
        MessageItem,
        MessageModifier,
        MixedConversationID,
        RemoteConversationID,
        TapbackItem
} from "shared/data/blocks";
import {ConversationItemType, ConversationPreviewType, ParticipantActionType} from "shared/data/stateCodes";
import {getPlatformUtils} from "shared/interface/platform/platformUtils";
import {isModifierTapback, messageItemToConversationPreview} from "shared/util/conversationUtils";
import * as ConnectionManager from "shared/connection/connectionManager";
import {modifierUpdateEmitter} from "shared/connection/connectionManager";
import {getNotificationUtils} from "shared/interface/notification/notificationUtils";
import {playSoundMessageIn, playSoundNotification, playSoundTapback} from "shared/util/soundUtils";
import {normalizeAddress} from "shared/util/addressHelper";
import {arrayContainsAll} from "shared/util/arrayUtils";
import localMessageCache from "shared/state/localMessageCache";
import {PeopleContext} from "shared/state/peopleState";
import {useSettings} from "shared/components/settings/SettingsProvider";

interface ConversationsState {
        conversations: Conversation[] | undefined,
        visibleConversations: Conversation[] | undefined,
        hasMoreConversations: boolean,
        loadConversations(): Promise<Conversation[]>,
        loadMoreConversations(): Promise<Conversation[]>,
        addConversation(newConversation: Conversation): void,
        markConversationRead(conversationID: LocalConversationID): void
}

export default function useConversationState(activeConversationID: LocalConversationID | undefined, interactive: boolean = false): ConversationsState {
        const [conversations, setConversations] = useState<Conversation[] | undefined>(undefined);
        const {settings} = useSettings();
        const loadChunkSize = useMemo(() => Math.max(1, settings.conversations.initialLoadCount), [settings.conversations.initialLoadCount]);
        const [visibleCount, setVisibleCount] = useState<number>(loadChunkSize);
        const [requestedCount, setRequestedCount] = useState<number>(loadChunkSize);
        const [hasMoreServerResults, setHasMoreServerResults] = useState<boolean>(false);
        const pendingConversationDataMap = useRef(new Map<RemoteConversationID, ConversationItem[]>()).current;
        const handledTapbackModifiers = useRef<Set<string>>(new Set());
        const handledTapbackOrder = useRef<string[]>([]);

        const peopleState = useContext(PeopleContext);

        useEffect(() => {
                setVisibleCount((current) => Math.max(current, loadChunkSize));
                setRequestedCount((current) => Math.max(current, loadChunkSize));
        }, [loadChunkSize]);

        const applyUpdateMessages = useCallback(async (newItems: ConversationItem[]) => {
		//Sort new items into their conversations
		const sortedConversationItems = newItems.reduce<Map<MixedConversationID, ConversationItem[]>>((accumulator, item) => {
			//Get this item's ID
			const chatID = getConversationItemMixedID(item);
			if(chatID === undefined) return accumulator;
			
			//Get the message array for the message's conversation
			let array: ConversationItem[] | undefined = accumulator.get(chatID);
			if(array === undefined) {
				array = [];
				accumulator.set(chatID, array);
			}
			
			//Add the item to the array
			array.push(item);
			
			return accumulator;
		}, new Map());
		
                //Collect the last known preview date for each conversation
                const conversationPreviewDateMap = new Map<MixedConversationID, Date>();
                conversations?.forEach((conversation) => {
                        conversationPreviewDateMap.set(conversation.localID, conversation.preview.date);
                        if(!conversation.localOnly) {
                                conversationPreviewDateMap.set(conversation.guid, conversation.preview.date);
                        }
                });

                //Find all chats (and their messages) from the server that we don't have saved locally
                const unlinkedSortedConversationItems: Map<RemoteConversationID, ConversationItem[]> =
                        conversations === undefined
                                ? new Map()
				: new Map(
					Array.from(sortedConversationItems.entries())
						.filter((entry): entry is [RemoteConversationID, ConversationItem[]] =>
							isRemoteConversationID(entry[0]) &&
							!conversations.some((conversation) => !conversation.localOnly && conversation.guid === entry[0]))
				);
		
		if(unlinkedSortedConversationItems.size > 0) {
			//Saving the items for later reference when we have conversation information
			for(const [chatGUID, conversationItems] of unlinkedSortedConversationItems.entries()) {
				let pendingConversationItems = pendingConversationDataMap.get(chatGUID);
				if(pendingConversationItems === undefined) {
					pendingConversationItems = [];
					pendingConversationDataMap.set(chatGUID, pendingConversationItems);
				}
				
				pendingConversationItems.push(...conversationItems);
			}
			
			//Requesting information for new chats
			ConnectionManager.fetchConversationInfo(Array.from(unlinkedSortedConversationItems.keys()))
				.then((result) => {
					type LinkedGroupedConversationItems = [LinkedConversation, ConversationItem[]];
					const linkedSortedConversationItems = result.map(([chatGUID, conversation]): LinkedGroupedConversationItems | undefined => {
						//Remove the pending conversation if the conversation request failed
						if(conversation === undefined) {
							pendingConversationDataMap.delete(chatGUID);
							return undefined;
						}
						
						//Get the pending messages
						const pendingMessages = pendingConversationDataMap.get(chatGUID);
						
						//Remove the pending conversation
						pendingConversationDataMap.delete(chatGUID);
						
						return [conversation, pendingMessages ?? []];
					}).filter((entry): entry is LinkedGroupedConversationItems => entry !== undefined);
					
					if(linkedSortedConversationItems.length > 0) {
						//Ignore if we haven't loaded conversations yet
						if(conversations !== undefined) {
							//Clone the conversation array
							const pendingConversationArray = [...conversations];
							
							for(const [newConversation, conversationItems] of linkedSortedConversationItems) {
								//Skip conversations that already exist
								if(pendingConversationArray.find((conversation) => !conversation.localOnly && conversation.guid === newConversation.guid)) continue;
								
								//Check if there are any local conversations with matching members
								const matchingLocalConversationIndex = conversations.findIndex((conversation) => {
									return conversation.localOnly &&
										conversation.service === newConversation.service &&
										arrayContainsAll(conversation.members, newConversation.members, normalizeAddress);
								});
								if(matchingLocalConversationIndex !== -1) {
									//Copy and update the local conversation
									const matchingLocalConversation: Conversation = {...conversations[matchingLocalConversationIndex]};
									
									matchingLocalConversation.localOnly = false; //Change to linked conversation
									(matchingLocalConversation as LinkedConversation).guid = newConversation.guid;
									matchingLocalConversation.members = newConversation.members;
									matchingLocalConversation.name = newConversation.name;
									
									//Remove local cached messages (this conversation will fetch messages from the server from now on)
									localMessageCache.delete(matchingLocalConversation.localID);
									
									//Update the conversation
									pendingConversationArray[matchingLocalConversationIndex] = matchingLocalConversation;
								} else {
									//Add the conversation
									sortInsertConversation(pendingConversationArray, newConversation);
								}
								
								//Simulate the arrival of this conversations's pending messages
								//to have the target conversation update properly
								setTimeout(() => {
									ConnectionManager.messageUpdateEmitter.notify(conversationItems);
								});
							}
							
							//Update the conversations
							setConversations(pendingConversationArray);
						}
					}
				});
		}
		
		//Updating conversations
		setConversations((conversations) => {
			//Ignore if we haven't loaded conversations yet
			if(conversations === undefined) return undefined;
			
                        //Clone the conversation array lazily
                        let pendingConversationArray: Conversation[] = conversations;
                        let conversationsChanged = false;
                        const ensurePendingArray = () => {
                                if(!conversationsChanged) {
                                        pendingConversationArray = [...pendingConversationArray];
                                        conversationsChanged = true;
                                }
                        };

                        for(const [chatID, conversationItems] of sortedConversationItems.entries()) {
                                //Match the conversation to a local conversation
                                const matchedConversationIndex = getConversationIndex(pendingConversationArray, chatID);
                                if(matchedConversationIndex === -1) continue;
				
				//Filter out non-message items
				const conversationMessages = conversationItems.filter((item): item is MessageItem => item.itemType === ConversationItemType.Message);
				
				//Ignore if there are no message items
				if(conversationMessages.length === 0) continue;
				
				//Get the latest message
				const latestMessage = conversationMessages.reduce((lastMessage, message) => message.date > lastMessage.date ? message : lastMessage);
				
                                const existingConversation = pendingConversationArray[matchedConversationIndex];
                                const existingPreviewDate = existingConversation.preview.date;
                                const shouldUpdatePreview = latestMessage.date >= existingPreviewDate;
                                const hasNewIncomingMessage = latestMessage.sender !== undefined && latestMessage.date > existingPreviewDate;

                                let updatedConversation = existingConversation;
                                let previewChanged = false;
                                if(shouldUpdatePreview) {
                                        const newPreview = messageItemToConversationPreview(latestMessage);
                                        if(!arePreviewsEqual(existingConversation.preview, newPreview)) {
                                                updatedConversation = {
                                                        ...updatedConversation,
                                                        preview: newPreview
                                                };
                                                previewChanged = true;
                                        }
                                }

                                let unreadChanged = false;
                                if(hasNewIncomingMessage && activeConversationID !== updatedConversation.localID && !updatedConversation.unreadMessages) {
                                        if(!previewChanged && updatedConversation === existingConversation) {
                                                updatedConversation = {...updatedConversation};
                                        }
                                        updatedConversation.unreadMessages = true;
                                        unreadChanged = true;
                                }

                                if(previewChanged || unreadChanged) {
                                        ensurePendingArray();
                                        if(previewChanged) {
                                                //Re-sort the conversation into the list
                                                sortInsertConversation(pendingConversationArray, updatedConversation, matchedConversationIndex);
                                        } else {
                                                pendingConversationArray[matchedConversationIndex] = updatedConversation;
                                        }
                                }
                        }

                        //Applying side effects
                        for(const conversationItem of newItems) {
                                if(conversationItem.itemType === ConversationItemType.ParticipantAction) {
                                        //Get the targeted conversation
                                        const matchedConversationIndex = getConversationIndex(pendingConversationArray, getConversationItemMixedID(conversationItem));
                                        if(matchedConversationIndex === -1) continue;

                                        //If we're the target, we can ignore this as we don't show up in our own copy of the member list
                                        if(conversationItem.target === undefined) continue;

                                        //Update the conversation members
                                        if(conversationItem.type === ParticipantActionType.Join) {
                                                ensurePendingArray();
                                                pendingConversationArray[matchedConversationIndex] = {
                                                        ...pendingConversationArray[matchedConversationIndex],
                                                        members: pendingConversationArray[matchedConversationIndex].members.concat(conversationItem.target)
                                                };
                                        } else if(conversationItem.type === ParticipantActionType.Leave) {
                                                ensurePendingArray();
                                                pendingConversationArray[matchedConversationIndex] = {
                                                        ...pendingConversationArray[matchedConversationIndex],
                                                        members: pendingConversationArray[matchedConversationIndex].members.filter((member) => member !== conversationItem.target)
                                                };
                                        }
                                } else if(conversationItem.itemType === ConversationItemType.ChatRenameAction) {
                                        //Get the targeted conversation
                                        const matchedConversationIndex = getConversationIndex(pendingConversationArray, getConversationItemMixedID(conversationItem));
                                        if(matchedConversationIndex === -1) continue;

                                        //Rename the conversation
                                        const existingConversation = pendingConversationArray[matchedConversationIndex];
                                        if(existingConversation.name !== conversationItem.chatName) {
                                                ensurePendingArray();
                                                pendingConversationArray[matchedConversationIndex] = {
                                                        ...existingConversation,
                                                        name: conversationItem.chatName
                                                };
                                        }
                                }
                        }

                        return conversationsChanged ? pendingConversationArray : conversations;
                });
		
		if(interactive) {
			//Map the active conversation ID to a server GUID
			const activeConversation = conversations?.find((conversation) => conversation.localID === activeConversationID);
                        const activeConversationGUID: RemoteConversationID | undefined =
                                activeConversation !== undefined && !activeConversation.localOnly ? activeConversation.guid : undefined;
                        let activeConversationUpdatedMessage: MessageItem | undefined;
			
			//Get if the window is focused
			const hasFocus = await getPlatformUtils().hasFocus();
			
			//Get whether a message is received in the currently selected conversation
                        const activeConversationUpdated = hasFocus && newItems.some((item) => {
                                //If the new item isn't an incoming message, ignore it
                                if(item.itemType !== ConversationItemType.Message || item.sender === undefined) {
                                        return false;
                                }

                                const messageItem = item as MessageItem;
                                const conversationMixedID = getConversationItemMixedID(item);
                                if(conversationMixedID !== undefined) {
                                        const lastPreviewDate = conversationPreviewDateMap.get(conversationMixedID);
                                        if(lastPreviewDate !== undefined && item.date <= lastPreviewDate) {
                                                return false;
                                        }
                                }

                                const didUpdate = messageItem.chatGuid === activeConversationGUID;
                                if(didUpdate) {
                                        activeConversationUpdatedMessage = messageItem;
                                }
                                return didUpdate;
                        });
			
			//Collect messages that should cause a notification to be displayed
			const notificationMessages = new Map(
				Array.from(sortedConversationItems.entries()).map(([chatID, messages]): [RemoteConversationID, MessageItem[]] | undefined => {
					if(!isRemoteConversationID(chatID)) return undefined;
					
					//Make sure this conversation is available and linked
					if(conversations === undefined ||
						!conversations.some((conversation) => !conversation.localOnly && conversation.guid === chatID)) {
						return undefined;
					}
					
					//Make sure we're not displaying messages for the currently focused conversation.
					//in this case, we should play a sound instead
					if(hasFocus && chatID === activeConversationGUID) {
						return undefined;
					}
					
					//Collect outgoing messages
					const notificationMessages = messages.filter((message): message is MessageItem => {
						return message.itemType === ConversationItemType.Message &&
							message.sender !== undefined;
					});
					
					//If we have no messages, skip creating an entry
					if(notificationMessages.length === 0) {
						return undefined;
					}
					
                                        const lastPreviewDate = conversationPreviewDateMap.get(chatID);
                                        const newNotificationMessages = notificationMessages.filter((message) => {
                                                if(lastPreviewDate === undefined) return true;
                                                return message.date > lastPreviewDate;
                                        });

                                        if(newNotificationMessages.length === 0) {
                                                return undefined;
                                        }

                                        //Add the entry to the map
                                        return [
                                                chatID,
                                                newNotificationMessages
                                        ];
                                }).filter((entry): entry is [RemoteConversationID, MessageItem[]] => entry !== undefined)
                        );
			
                        if(notificationMessages.size > 0) {
                                const notificationContextEntries = Array.from(notificationMessages.entries()).map(([conversationId, messages]) => ({
                                        conversationId,
                                        messages
                                }));
                                if(hasFocus) {
                                        //If we have focus, play a notification sound
                                        playSoundNotification({
                                                type: "notification",
                                                notificationConversations: notificationContextEntries,
                                                messages: notificationContextEntries.flatMap((entry) => entry.messages)
                                        });
                                } else {
                                        //Otherwise show notifications
                                        for(const [chatGUID, messages] of notificationMessages.entries()) {
						//Finding the conversation
						const conversation = conversations?.find((conversation): conversation is LinkedConversation => !conversation.localOnly && conversation.guid === chatGUID);
						if(conversation === undefined) continue;
						
						//Sending a notification
						getNotificationUtils().showMessageNotifications(conversation, messages, peopleState);
					}
				}
                        } else {
                                if(activeConversationUpdated) {
                                        playSoundMessageIn({
                                                type: "messageIn",
                                                conversationId: activeConversationGUID,
                                                conversationLocalId: activeConversation?.localID,
                                                message: activeConversationUpdatedMessage,
                                                messages: activeConversationUpdatedMessage ? [activeConversationUpdatedMessage] : undefined
                                        });
                                }
                        }
		}
	}, [activeConversationID, conversations, setConversations, pendingConversationDataMap, interactive, peopleState]);
	
	//Subscribe to message updates
	useEffect(() => {
		ConnectionManager.messageUpdateEmitter.subscribe(applyUpdateMessages);
		return () => ConnectionManager.messageUpdateEmitter.unsubscribe(applyUpdateMessages);
	}, [applyUpdateMessages]);
	
        //Subscribe to modifier updates
        useEffect(() => {
                if(!interactive) return;

                const listener = (modifierArray: MessageModifier[]) => {
                        const tapbackAdditions = modifierArray.filter((modifier): modifier is TapbackItem => isModifierTapback(modifier) && modifier.isAddition);
                        if(tapbackAdditions.length === 0) return;

                        const newTapbackKeys = tapbackAdditions.reduce<string[]>((keys, modifier) => {
                                const tapbackKey = `${modifier.messageGuid}:${modifier.tapbackType}:${modifier.sender}:${modifier.messageIndex}:${modifier.isAddition}`;
                                if(handledTapbackModifiers.current.has(tapbackKey)) return keys;

                                handledTapbackModifiers.current.add(tapbackKey);
                                handledTapbackOrder.current.push(tapbackKey);
                                keys.push(tapbackKey);
                                return keys;
                        }, []);

                        if(newTapbackKeys.length === 0) return;

                        const maxTapbackHistory = 500;
                        while(handledTapbackOrder.current.length > maxTapbackHistory) {
                                const staleKey = handledTapbackOrder.current.shift();
                                if(staleKey !== undefined) {
                                        handledTapbackModifiers.current.delete(staleKey);
                                }
                        }

                        playSoundTapback({
                                type: "tapback",
                                modifiers: modifierArray
                        });
                };
                modifierUpdateEmitter.subscribe(listener);
                return () => modifierUpdateEmitter.unsubscribe(listener);
        }, [interactive]);

        const visibleConversations = useMemo(() => {
                if(conversations === undefined) return undefined;
                const limit = Math.min(visibleCount, conversations.length);
                return conversations.slice(0, limit);
        }, [conversations, visibleCount]);

        const hasMoreConversations = useMemo(() => {
                if(conversations === undefined) return false;
                const safeVisibleCount = Math.min(visibleCount, conversations.length);
                if(conversations.length > safeVisibleCount) return true;
                return hasMoreServerResults && conversations.length >= requestedCount;
        }, [conversations, visibleCount, hasMoreServerResults, requestedCount]);

        const fetchAndSetConversations = useCallback((count?: number): Promise<Conversation[]> => {
                return ConnectionManager.fetchConversations(count).then((fetchedConversations) => {
                        setConversations(fetchedConversations);
                        if(count !== undefined) {
                                setHasMoreServerResults(fetchedConversations.length >= count);
                        } else {
                                setHasMoreServerResults(false);
                        }
                        return fetchedConversations;
                });
        }, [setConversations, setHasMoreServerResults]);

        const loadConversations = useCallback((): Promise<Conversation[]> => {
                return fetchAndSetConversations(undefined);
        }, [fetchAndSetConversations]);

        const loadMoreConversations = useCallback((): Promise<Conversation[]> => {
                const target = requestedCount + loadChunkSize;
                setRequestedCount(target);
                setVisibleCount((current) => Math.max(current, target));
                const hasLocalCoverage = conversations !== undefined && conversations.length >= target;
                if(hasLocalCoverage || !hasMoreServerResults) {
                        return Promise.resolve(conversations ?? []);
                }

                return fetchAndSetConversations(target);
        }, [
                conversations,
                fetchAndSetConversations,
                hasMoreServerResults,
                loadChunkSize,
                requestedCount
        ]);
	
	//Adds a new conversation at the top of the list
	const addConversation = useCallback((newConversation: Conversation) => {
		setConversations((conversations) => {
			//Ignore if the conversations are still loading
			if(conversations === undefined) return conversations;
			
			return [newConversation].concat(conversations);
		});
	}, [setConversations]);
	
	//Marks the conversation with the specified ID as read
        const markConversationRead = useCallback((conversationID: LocalConversationID) => {
                let dismissedConversationGUID: RemoteConversationID | undefined;
                setConversations((conversations) => {
                        if(conversations === undefined) return conversations;

                        //Copy the conversations array
                        const pendingConversations = [...conversations];

                        //Find the conversation
                        const conversationIndex = pendingConversations.findIndex((conversation) => conversation.localID === conversationID);
                        if(conversationIndex === -1) return conversations;

                        const conversation = pendingConversations[conversationIndex];
                        if(!conversation.localOnly) {
                                dismissedConversationGUID = conversation.guid;
                        }

                        //Update the conversation
                        pendingConversations[conversationIndex] = {
                                ...conversation,
                                unreadMessages: false
                        };

                        return pendingConversations;
                });

                if(dismissedConversationGUID !== undefined) {
                        getNotificationUtils().dismissMessageNotifications(dismissedConversationGUID);
                }
        }, [setConversations]);
	
        return {
                conversations,
                visibleConversations,
                hasMoreConversations,
                loadConversations,
                loadMoreConversations,
                addConversation,
                markConversationRead
        };
}

/**
 * Sorts a conversation into a conversation list
 * @param array The array of conversations to insert to
 * @param conversation The conversation to insert
 * @param existingIndex The existing index of the conversation, which if provided,
 * will cause the conversation at this index to be removed from the list
 */
function arePreviewsEqual(a: ConversationPreview, b: ConversationPreview): boolean {
        if(a.type !== b.type) return false;
        if(a.date.getTime() !== b.date.getTime()) return false;

        if(a.type === ConversationPreviewType.Message && b.type === ConversationPreviewType.Message) {
                if(a.text !== b.text) return false;
                if(a.sendStyle !== b.sendStyle) return false;
                if(a.attachments.length !== b.attachments.length) return false;
                for(let i = 0; i < a.attachments.length; i++) {
                        if(a.attachments[i] !== b.attachments[i]) return false;
                }
        }

        return true;
}

function sortInsertConversation(array: Conversation[], conversation: Conversation, existingIndex?: number) {
	//Remove the conversation from the list
	if(existingIndex !== undefined) {
		array.splice(existingIndex, 1);
	}
	
	//Re-insert the conversation into the list
	let olderConversationIndex = array.findIndex((existingConversation) => existingConversation.preview.date < conversation.preview.date);
	if(olderConversationIndex === -1) olderConversationIndex = array.length;
	array.splice(olderConversationIndex, 0, conversation);
}

/**
 * Gets the index of the conversation with the specified ID from the conversation array
 */
function getConversationIndex(conversations: Conversation[], chatID: MixedConversationID | undefined): number {
	if(isRemoteConversationID(chatID)) {
		//Match GUID
		return conversations.findIndex((conversation) => !conversation.localOnly && conversation.guid === chatID);
	} else if(isLocalConversationID(chatID)) {
		//Match local ID
		return conversations.findIndex((conversation) => conversation.localID === chatID);
	} else {
		return -1;
	}
}