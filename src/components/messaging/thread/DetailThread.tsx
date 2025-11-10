import React, {useCallback, useEffect, useRef, useState} from "react";
import {
	Conversation,
	ConversationItem,
	LocalConversationID,
	MessageItem,
	MessageModifier,
	QueuedFile
} from "shared/data/blocks";
import MessageList from "shared/components/messaging/thread/MessageList";
import {Box, Button, CircularProgress, Stack, Typography} from "@mui/material";
import {DetailFrame} from "shared/components/messaging/master/DetailFrame";
import MessageInput from "shared/components/messaging/thread/MessageInput";
import {useConversationTitle, useIsFaceTimeSupported, useUnsubscribeContainer} from "shared/util/hookUtils";
import {mapServiceName} from "shared/util/languageUtils";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {ThreadFetchResult} from "shared/connection/connectionManager";
import {
	checkMessageConversationOwnership,
	findMatchingUnconfirmedMessageIndex,
	generateAttachmentLocalID,
	generateMessageLocalID,
	isModifierStatusUpdate,
	isModifierSticker,
	isModifierTapback
} from "shared/util/conversationUtils";
import ConversationTarget from "shared/data/conversationTarget";
import {ConversationItemType, MessageError, MessageStatusCode} from "shared/data/stateCodes";
import EmitterPromiseTuple from "shared/util/emitterPromiseTuple";
import {playSoundMessageOut} from "shared/util/soundUtils";
import EventEmitter from "shared/util/eventEmitter";
import localMessageCache from "shared/state/localMessageCache";
import {installCancellablePromise} from "shared/util/cancellablePromise";
import {ThreadFocusTarget, areFocusTargetsEqual} from "./types";
import ConversationMediaDrawer from "./ConversationMediaDrawer";

const DEFAULT_FOCUS_PAGE_LIMIT = 15;

type ThreadPageMetadata = {
        oldestServerID?: number;
        newestServerID?: number;
};

function getConversationItemKey(item: ConversationItem): string {
        if(item.guid) return item.guid;
        if(item.itemType === ConversationItemType.Message) {
                const message = item as MessageItem;
                if(message.serverID !== undefined) return `server:${message.serverID}`;
                if(message.localID !== undefined) return `local:${message.localID}`;
        }
        if(item.localID !== undefined) return `local:${item.localID}`;
        return `${item.itemType}:${item.date.getTime()}`;
}

function dedupeAndSortNewestFirst(arrays: ConversationItem[][]): ConversationItem[] {
        const map = new Map<string, ConversationItem>();
        for(const array of arrays) {
                for(const item of array) {
                        const key = getConversationItemKey(item);
                        const existing = map.get(key);
                        if(!existing || existing.date.getTime() < item.date.getTime()) {
                                map.set(key, item);
                        }
                }
        }
        const uniqueItems = Array.from(map.values());
        uniqueItems.sort((a, b) => b.date.getTime() - a.date.getTime());
        return uniqueItems;
}

function metadataFromItems(items: ConversationItem[]): ThreadPageMetadata | undefined {
        let oldest: number | undefined;
        let newest: number | undefined;
        for(const item of items) {
                if(item.itemType !== ConversationItemType.Message) continue;
                const message = item as MessageItem;
                if(message.serverID === undefined) continue;
                if(oldest === undefined || message.serverID < oldest) oldest = message.serverID;
                if(newest === undefined || message.serverID > newest) newest = message.serverID;
        }
        if(oldest === undefined && newest === undefined) return undefined;
        return {oldestServerID: oldest, newestServerID: newest};
}

function mergeMetadata(base: ThreadPageMetadata | undefined, incoming: ThreadPageMetadata | undefined): ThreadPageMetadata | undefined {
        if(!incoming) return base;
        let oldest = base?.oldestServerID;
        let newest = base?.newestServerID;
        let changed = false;
        if(incoming.oldestServerID !== undefined && (oldest === undefined || incoming.oldestServerID < oldest)) {
                oldest = incoming.oldestServerID;
                changed = true;
        }
        if(incoming.newestServerID !== undefined && (newest === undefined || incoming.newestServerID > newest)) {
                newest = incoming.newestServerID;
                changed = true;
        }
        if(!changed) return base;
        return {oldestServerID: oldest, newestServerID: newest};
}

function computeMetadataFromItems(items: ConversationItem[], seed?: ThreadPageMetadata): ThreadPageMetadata | undefined {
        const fromItems = metadataFromItems(items);
        return mergeMetadata(seed, fromItems);
}

function mergeThreadFetchMetadata(results: ThreadFetchResult[], items: ConversationItem[]): ThreadPageMetadata | undefined {
        let metadata: ThreadPageMetadata | undefined;
        for(const result of results) {
                metadata = mergeMetadata(metadata, result.metadata);
        }
        return computeMetadataFromItems(items, metadata);
}

export default function DetailThread({conversation, focusTarget}: {
        conversation: Conversation;
        focusTarget?: ThreadFocusTarget;
}) {
        const [displayState, setDisplayState] = useState<DisplayState>({type: DisplayType.Loading});
        const [historyLoadState, setHistoryLoadState] = useState(HistoryLoadState.Idle);
        const displayStateRef = useRef(displayState);
        const historyLoadStateRef = useRef(historyLoadState);
        const [focusMetadata, setFocusMetadata] = useState<ThreadFocusTarget | undefined>(undefined);

        useEffect(() => {
                displayStateRef.current = displayState;
        }, [displayState]);
        useEffect(() => {
                historyLoadStateRef.current = historyLoadState;
        }, [historyLoadState]);
	
	const conversationTitle = useConversationTitle(conversation);
	const faceTimeSupported = useIsFaceTimeSupported();
	const messageSubmitEmitter = useRef(new EventEmitter<void>());
	
	const [messageInput, setMessageInput] = useState<string>("");
        const [attachmentInput, setAttachmentInput] = useState<QueuedFile[]>([]);
        const [isMediaDrawerOpen, setIsMediaDrawerOpen] = useState(false);
	
	/**
	 * Requests messages, and updates the display state
	 */
        const requestMessages = useCallback((focus?: ThreadFocusTarget) => {
                if(conversation.localOnly) {
                        const messages = localMessageCache.get(conversation.localID) ?? [];
                        const metadata = metadataFromItems(messages);
                        setDisplayState({type: DisplayType.Messages, messages, metadata});
                        setFocusMetadata(focus);

                        return;
                }

                setDisplayState({type: DisplayType.Loading});
                setFocusMetadata(focus);

                const anchorServerID = focus?.serverID;
                if(anchorServerID === undefined) {
                        ConnectionManager.fetchThread(conversation.guid).then((result) => {
                                const metadata = mergeThreadFetchMetadata([result], result.items);
                                setDisplayState({type: DisplayType.Messages, messages: result.items, metadata});
                        }).catch(() => {
                                setDisplayState({type: DisplayType.Error});
                        });
                        return;
                }

                const beforePromise = ConnectionManager.fetchThread(conversation.guid, {
                        anchorMessageID: anchorServerID + 1,
                        direction: "before",
                        limit: DEFAULT_FOCUS_PAGE_LIMIT
                });
                const afterPromise = ConnectionManager.fetchThread(conversation.guid, {
                        anchorMessageID: anchorServerID,
                        direction: "after",
                        limit: DEFAULT_FOCUS_PAGE_LIMIT
                });

                Promise.all([beforePromise, afterPromise]).then(([beforeResult, afterResult]) => {
                        const combinedItems = dedupeAndSortNewestFirst([beforeResult.items, afterResult.items]);
                        const metadata = mergeThreadFetchMetadata([beforeResult, afterResult], combinedItems);
                        setDisplayState({type: DisplayType.Messages, messages: combinedItems, metadata});
                }).catch(() => {
                        setDisplayState({type: DisplayType.Error});
                });
        }, [conversation, setDisplayState]);
        const loadedThreadMessages = useRef<string | undefined>(undefined);
	
	const requestHistoryUnsubscribeContainer = useUnsubscribeContainer([conversation.localID]);
        const requestHistory = useCallback(() => {
                const currentDisplayState = displayStateRef.current;
                const currentHistoryLoadState = historyLoadStateRef.current;

                //Return if this is a local conversation, or if the state is already loading or is complete
                if(currentDisplayState.type !== DisplayType.Messages
                        || conversation.localOnly
                        || currentHistoryLoadState !== HistoryLoadState.Idle) return;

                //Set the state to loading
                setHistoryLoadState(HistoryLoadState.Loading);

                const currentMetadata = currentDisplayState.metadata;
                const displayStateMessages = currentDisplayState.messages;
                const fallbackAnchor = displayStateMessages[displayStateMessages.length - 1]?.serverID;
                const anchorServerID = currentMetadata?.oldestServerID ?? fallbackAnchor;

                if(anchorServerID === undefined) {
                        setHistoryLoadState(HistoryLoadState.Complete);
                        return;
                }

                installCancellablePromise(
                        ConnectionManager.fetchThread(conversation.guid, {
                                anchorMessageID: anchorServerID,
                                direction: "before"
                        }),
                        requestHistoryUnsubscribeContainer
                )
                        .then((result) => {
                                if(result.items.length > 0) {
                                        setHistoryLoadState(HistoryLoadState.Idle);

                                        setDisplayState((displayState) => {
                                                if(displayState.type !== DisplayType.Messages) return displayState;

                                                const combinedItems = dedupeAndSortNewestFirst([displayState.messages, result.items]);
                                                const metadata = mergeThreadFetchMetadata([result], combinedItems);

                                                return {
                                                        type: DisplayType.Messages,
                                                        messages: combinedItems,
                                                        metadata
                                                };
                                        });
                                } else {
                                        setHistoryLoadState(HistoryLoadState.Complete);
                                }
                        }).catch(() => {
                        setHistoryLoadState(HistoryLoadState.Idle);
                });
        }, [conversation, setDisplayState, setHistoryLoadState, requestHistoryUnsubscribeContainer, displayStateRef, historyLoadStateRef]);
	
	//Request messages when the conversation changes
        const focusKey = focusTarget ? `${focusTarget.serverID ?? ""}|${focusTarget.guid ?? ""}` : "";
        useEffect(() => {
                const loadKey = `${conversation.localID}|${focusKey}`;
                if(loadedThreadMessages.current === loadKey) return;
                requestMessages(focusTarget);
                loadedThreadMessages.current = loadKey;
        }, [conversation.localID, focusKey, requestMessages, focusTarget]);

        useEffect(() => {
                setFocusMetadata((previous) => {
                        if(areFocusTargetsEqual(previous, focusTarget)) return previous;
                        return focusTarget;
                });
        }, [focusTarget]);
	
        const handleMessageUpdate = useCallback((itemArray: ConversationItem[]) => {
                const relevantItems = itemArray.filter((item) => checkMessageConversationOwnership(conversation, item));
                if(relevantItems.length === 0) return;

                setDisplayState((displayState) => {
                        //Ignore if the chat isn't loaded
                        if(displayState.type !== DisplayType.Messages) return displayState;

                        let pendingMessages: ConversationItem[] = displayState.messages;
                        let messagesMutated = false;
                        const ensurePendingMessages = () => {
                                if(!messagesMutated) {
                                        pendingMessages = [...pendingMessages];
                                        messagesMutated = true;
                                }
                        };
                        const newMessages: ConversationItem[] = [];

                        for(const newItem of relevantItems) {
                                //Try to find a matching conversation item
                                let itemMatched = false;
                                if(newItem.itemType === ConversationItemType.Message) {
                                        const matchedIndex = findMatchingUnconfirmedMessageIndex(pendingMessages, newItem);
                                        if(matchedIndex !== -1) {
                                                //Merge the information into the item
                                                const mergeTargetItem = pendingMessages[matchedIndex] as MessageItem;
                                                const mergedItem: MessageItem = {
                                                        ...mergeTargetItem,
                                                        serverID: newItem.serverID,
                                                        guid: newItem.guid,
                                                        date: newItem.date,
                                                        status: newItem.status,
                                                        error: newItem.error,
                                                        statusDate: newItem.statusDate
                                                };

                                                const hasChanges =
                                                        mergedItem.serverID !== mergeTargetItem.serverID ||
                                                        mergedItem.guid !== mergeTargetItem.guid ||
                                                        mergedItem.date.getTime() !== mergeTargetItem.date.getTime() ||
                                                        mergedItem.status !== mergeTargetItem.status ||
                                                        mergedItem.error !== mergeTargetItem.error ||
                                                        mergedItem.statusDate?.getTime() !== mergeTargetItem.statusDate?.getTime();

                                                if(hasChanges) {
                                                        ensurePendingMessages();
                                                        pendingMessages[matchedIndex] = mergedItem;
                                                }

                                                itemMatched = true;
                                        }
                                }

                                //If we didn't merge this item, add it to the end of the message list
                                if(!itemMatched) {
                                        if(newItem.itemType === ConversationItemType.Message) {
                                                const {guid: newItemGuid, serverID: newItemServerID} = newItem;
                                                const duplicateInPending = pendingMessages.some((item) => {
                                                        if(item.itemType !== ConversationItemType.Message) return false;
                                                        if(newItemGuid && item.guid === newItemGuid) return true;
                                                        if(newItemServerID !== undefined && item.serverID === newItemServerID) return true;
                                                        return false;
                                                });
                                                const duplicateInNew = newMessages.some((item) => {
                                                        if(item.itemType !== ConversationItemType.Message) return false;
                                                        if(newItemGuid && item.guid === newItemGuid) return true;
                                                        if(newItemServerID !== undefined && item.serverID === newItemServerID) return true;
                                                        return false;
                                                });
                                                if(duplicateInPending || duplicateInNew) continue;
                                        }
                                        newMessages.push(newItem);
                                }
                        }

                        if(newMessages.length > 0) {
                                ensurePendingMessages();
                                pendingMessages.unshift(...newMessages);
                        }

                        if(!messagesMutated) return displayState;
                        const metadata = computeMetadataFromItems(pendingMessages, displayState.metadata);
                        return {type: DisplayType.Messages, messages: pendingMessages, metadata};
                });
        }, [setDisplayState, conversation]);
	
	//Subscribe to message updates
	useEffect(() => {
		return ConnectionManager.messageUpdateEmitter.subscribe(handleMessageUpdate);
	}, [handleMessageUpdate]);
	
        const handleModifierUpdate = useCallback((itemArray: MessageModifier[]) => {
                setDisplayState((displayState) => {
                        //Ignore if the chat isn't loaded
                        if(displayState.type !== DisplayType.Messages) return displayState;

                        let pendingItemArray: ConversationItem[] = displayState.messages;
                        let itemsMutated = false;
                        const ensurePendingItems = () => {
                                if(!itemsMutated) {
                                        pendingItemArray = [...pendingItemArray];
                                        itemsMutated = true;
                                }
                        };

                        for(const modifier of itemArray) {
                                //Try to match the modifier with an item
                                const matchingIndex = pendingItemArray.findIndex((item) => item.itemType === ConversationItemType.Message && item.guid === modifier.messageGuid);
                                if(matchingIndex === -1) continue;
                                const matchedItem = pendingItemArray[matchingIndex] as MessageItem;

                                //Apply the modifier
                                if(isModifierStatusUpdate(modifier)) {
                                        const hasChanges = matchedItem.status !== modifier.status || matchedItem.statusDate?.getTime() !== modifier.date?.getTime();
                                        if(!hasChanges) continue;

                                        ensurePendingItems();
                                        pendingItemArray[matchingIndex] = {
                                                ...matchedItem,
                                                status: modifier.status,
                                                statusDate: modifier.date
                                        };
                                } else if(isModifierSticker(modifier)) {
                                        ensurePendingItems();
                                        pendingItemArray[matchingIndex] = {
                                                ...matchedItem,
                                                stickers: matchedItem.stickers.concat(modifier),
                                        } as MessageItem;
                                } else if(isModifierTapback(modifier)) {
                                        const pendingTapbacks = [...matchedItem.tapbacks];
                                        const matchingTapbackIndex = pendingTapbacks.findIndex((tapback) => tapback.sender === modifier.sender);
                                        if(matchingTapbackIndex !== -1) {
                                                const existingTapback = pendingTapbacks[matchingTapbackIndex];
                                                const tapbackChanged = existingTapback.isAddition !== modifier.isAddition || existingTapback.tapbackType !== modifier.tapbackType;
                                                if(!tapbackChanged) continue;

                                                pendingTapbacks[matchingTapbackIndex] = modifier;
                                        } else {
                                                pendingTapbacks.push(modifier);
                                        }

                                        ensurePendingItems();
                                        pendingItemArray[matchingIndex] = {
                                                ...matchedItem,
                                                tapbacks: pendingTapbacks
                                        };
                                }
                        }

                        if(!itemsMutated) return displayState;
                        const metadata = computeMetadataFromItems(pendingItemArray, displayState.metadata);
                        return {type: DisplayType.Messages, messages: pendingItemArray, metadata};
                });
        }, [setDisplayState]);
	
	//Subscribe to modifier updates
	useEffect(() => {
		return ConnectionManager.modifierUpdateEmitter.subscribe(handleModifierUpdate);
	}, [handleModifierUpdate]);
	
	//Add an attachment to the attachment input
	const addAttachment = useCallback((files: File[]) => {
		setAttachmentInput((attachments) => [
			...attachments,
			...files.map((file): QueuedFile => (
				{id: generateAttachmentLocalID(), file: file}
			))
		]);
	}, [setAttachmentInput]);
	
	//Remove an attachment from the attachment input
	const removeAttachment = useCallback((file: QueuedFile) => {
		setAttachmentInput((attachments) =>
			attachments.filter((queuedFile) => queuedFile.id !== file.id)
		);
	}, [setAttachmentInput]);
	
	//Clear subscriptions when the display state or conversation changes
	const uploadSubscriptionsContainer = useUnsubscribeContainer([conversation.localID, displayState.type]);
	
	/**
	 * Applies a message error the message with the specified ID
	 */
	const applyMessageError = useCallback((localID: LocalConversationID, error: MessageError) => {
                setDisplayState((displayState) => {
                        //Ignore if there are no messages
                        if(displayState.type !== DisplayType.Messages) return displayState;

                        const itemIndex = displayState.messages.findIndex((item) => item.localID === localID);
                        if(itemIndex === -1) return displayState;

                        const message = displayState.messages[itemIndex] as MessageItem;
                        if(message.error === error) return displayState;

                        const pendingItems = [...displayState.messages];
                        pendingItems[itemIndex] = {
                                ...message,
                                error: error
                        };

                        return {type: DisplayType.Messages, messages: pendingItems, metadata: displayState.metadata};
                });
        }, [setDisplayState]);
	
	/**
	 * Subscribes to an upload progress for an outgoing attachment message
	 */
	const registerUploadProgress = useCallback((
		messageID: LocalConversationID,
		uploadProgress: EmitterPromiseTuple<number | string, void>
	) => {
		/**
		 * Updates the target message state
		 * @param updater A function that takes a {@link MessageItem},
		 * and returns a modified partial
		 */
		const updateMessage = (updater: (message: MessageItem) => Partial<MessageItem>) => {
			setDisplayState((displayState) => {
				//Ignore if there are no messages
				if(displayState.type !== DisplayType.Messages) return displayState;
				
				//Clone the item array
				const pendingItems: ConversationItem[] = [...displayState.messages];
				
				//Find the item
				const itemIndex = pendingItems.findIndex((item) => item.localID === messageID);
				if(itemIndex === -1) return displayState;
				const message = pendingItems[itemIndex] as MessageItem;
				
				//Update the item
				pendingItems[itemIndex] = {...message, ...updater(message)};
				
                                return {type: DisplayType.Messages, messages: pendingItems, metadata: displayState.metadata};
                        });
                };
		
		//Sync the progress meter
		uploadProgress.emitter.subscribe((progressData) => {
			updateMessage((message) => {
				if(typeof progressData === "number") {
					//Update the upload progress
					return {
						progress: progressData / message.attachments[0].size * 100
					};
				} else {
					//Update the checksum
					return {
						attachments: [{
							...message.attachments[0],
							checksum: progressData
						}]
					};
				}
			});
		}, uploadSubscriptionsContainer);
		
		//Remove the progress when the file is finished uploading
		installCancellablePromise(uploadProgress.promise, uploadSubscriptionsContainer)
			.then(() => {
				updateMessage(() => ({
					progress: undefined
				}));
			})
			.catch((error: MessageError) => applyMessageError(messageID, error));
	}, [setDisplayState, applyMessageError, uploadSubscriptionsContainer]);
	
	const submitInput = useCallback((messageText: string, queuedFileArray: QueuedFile[]) => {
		//Ignore if messages aren't loaded
		if(displayState.type !== DisplayType.Messages) return;
		
		//Get the conversation target
		const conversationTarget: ConversationTarget =
			!conversation.localOnly ? {
				type: "linked",
				guid: conversation.guid
			} : {
				type: "unlinked",
				members: conversation.members,
				service: conversation.service
			};
		
		const addedItems: MessageItem[] = [];
		
		//Check if there is a message input
		const trimmedMessageText = messageText.trim();
		if(trimmedMessageText !== "") {
			//Create the message
			const messageLocalID = generateMessageLocalID();
			const message: MessageItem = {
				itemType: ConversationItemType.Message,
				localID: messageLocalID,
				serverID: undefined,
				guid: undefined,
				chatGuid: conversation.localOnly ? undefined : conversation.guid,
				chatLocalID: conversation.localID,
				date: new Date(),
				
				text: trimmedMessageText,
				subject: undefined,
				sender: undefined,
				attachments: [],
				stickers: [],
				tapbacks: [],
				sendStyle: undefined,
				status: MessageStatusCode.Unconfirmed,
				error: undefined,
				statusDate: undefined
			};
			
			//Send the message
			ConnectionManager.sendMessage(conversationTarget, trimmedMessageText)
				.catch((error: MessageError) => applyMessageError(messageLocalID, error));
			
			//Keep track of the message
			addedItems.push(message);
		}
		
		//Clear the message input
		setMessageInput("");
		
		//Handle attachments
		for(const queuedFile of queuedFileArray) {
			//Convert the file to a message
			const messageLocalID = generateMessageLocalID();
			const message: MessageItem = {
				itemType: ConversationItemType.Message,
				localID: messageLocalID,
				serverID: undefined,
				guid: undefined,
				chatGuid: !conversation.localOnly ? conversation.guid : undefined,
				chatLocalID: conversation.localID,
				date: new Date(),
				
				text: undefined,
				subject: undefined,
				sender: undefined,
				attachments: [{
					localID: queuedFile.id,
					name: queuedFile.file.name,
					type: queuedFile.file.type,
					size: queuedFile.file.size,
					data: queuedFile.file
				}],
				stickers: [],
				tapbacks: [],
				sendStyle: undefined,
				status: MessageStatusCode.Unconfirmed,
				statusDate: undefined,
				error: undefined,
				progress: -1 //Show indeterminate progress by default for attachments
			};
			
			//Send the file
			const progress = ConnectionManager.sendFile(conversationTarget, queuedFile.file);
			
			//Subscribe to the file upload progress
			registerUploadProgress(messageLocalID, progress);
			
			//Keep track of the messages
			addedItems.push(message);
		}
		
		//Clear attachments
		setAttachmentInput([]);
		
		if(addedItems.length > 0) {
			//Notify message listeners
			ConnectionManager.messageUpdateEmitter.notify(addedItems);
			messageSubmitEmitter.current.notify();
			
			//Play a message sound
			playSoundMessageOut();
		}
	}, [displayState, conversation, registerUploadProgress, setMessageInput, setAttachmentInput, applyMessageError]);
	
	const startCall = useCallback(async () => {
		await ConnectionManager.initiateFaceTimeCall(conversation.members);
	}, [conversation]);
	
	let body: React.ReactNode;
	if(displayState.type === DisplayType.Messages) {
		body = (
                        <MessageList
                                conversation={conversation}
                                items={displayState.messages}
                                messageSubmitEmitter={messageSubmitEmitter.current}
                                focusTarget={focusMetadata}
                                showHistoryLoader={historyLoadState === HistoryLoadState.Loading}
                                onRequestHistory={requestHistory} />
		);
	} else if(displayState.type === DisplayType.Loading) {
		body = (
			<Stack height="100%" alignItems="center" justifyContent="center">
				<CircularProgress />
			</Stack>
		);
	} else if(displayState.type === DisplayType.Error) {
		body = (
			<Stack height="100%" alignItems="center" justifyContent="center">
                                <Typography color="textSecondary" gutterBottom>Couldn&apos;t load this conversation</Typography>
                                <Button onClick={() => requestMessages(focusMetadata)}>Retry</Button>
                        </Stack>
                );
        }
	
	const cancelDrag = useCallback((event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
	}, []);
	
	const handleDragOver = useCallback((event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		
		if(!event.dataTransfer) return;
		event.dataTransfer.dropEffect = "copy";
	}, []);
	
	const handleDrop = useCallback((event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		
		if(!event.dataTransfer) return;
		
		//Add the files
		const files = [...event.dataTransfer.files].map((file): QueuedFile => {
			return {id: generateAttachmentLocalID(), file: file};
		});
		
		setAttachmentInput((attachmentInput) => {
			return attachmentInput.concat(...files);
		});
	}, [setAttachmentInput]);
	
        const showMediaDrawer = ConnectionManager.getBlueBubblesAuth() !== undefined;

        useEffect(() => {
                if(!showMediaDrawer && isMediaDrawerOpen) {
                        setIsMediaDrawerOpen(false);
                }
        }, [showMediaDrawer, isMediaDrawerOpen]);

        const toggleMediaDrawer = useCallback(() => {
                setIsMediaDrawerOpen((open) => !open);
        }, []);

        const closeMediaDrawer = useCallback(() => setIsMediaDrawerOpen(false), []);

        return (
                <>
                        <DetailFrame
                        title={conversationTitle}
                        showCall={faceTimeSupported}
                        onClickCall={startCall}
                        showMediaDrawerButton={showMediaDrawer}
                        onClickMediaDrawer={toggleMediaDrawer}
                        mediaDrawerOpen={isMediaDrawerOpen}>
                        <Stack
                                flexGrow={1}
                                minHeight={0}
				
				onDragEnter={cancelDrag}
				onDragLeave={cancelDrag}
				onDragOver={handleDragOver}
				onDrop={handleDrop}>
				<Stack
					flexGrow={1}
					minHeight={0}>
					{body}
				</Stack>
				
				<Box
					width="100%"
					padding={2}>
					<MessageInput
						placeholder={mapServiceName(conversation.service)}
						message={messageInput}
						onMessageChange={setMessageInput}
						attachments={attachmentInput}
						onAttachmentAdd={addAttachment}
						onAttachmentRemove={removeAttachment}
						onMessageSubmit={submitInput} />
                                </Box>
                        </Stack>
                        </DetailFrame>

                        <ConversationMediaDrawer
                                conversation={conversation}
                                open={isMediaDrawerOpen}
                                onClose={closeMediaDrawer}
                        />
                </>
        );
}

enum DisplayType {
	Loading,
	Error,
	Messages
}

type DisplayStateMessages = {
        type: DisplayType.Messages;
        messages: ConversationItem[];
        metadata: ThreadPageMetadata | undefined;
};

type DisplayState = {
        type: DisplayType.Loading | DisplayType.Error
} | DisplayStateMessages;

enum HistoryLoadState {
	Idle,
	Loading,
	Complete
}