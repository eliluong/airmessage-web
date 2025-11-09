import React, {useCallback, useContext, useEffect, useRef, useState} from "react";
import Sidebar from "../master/Sidebar";
import * as ConnectionManager from "../../../connection/connectionManager";
import {ConnectionListener} from "../../../connection/connectionManager";
import {ConnectionErrorCode, MessageError} from "../../../data/stateCodes";
import {Conversation} from "../../../data/blocks";
import SnackbarProvider from "../../control/SnackbarProvider";
import {getNotificationUtils} from "shared/interface/notification/notificationUtils";
import {getPlatformUtils} from "shared/interface/platform/platformUtils";
import {Box, Divider, Stack} from "@mui/material";
import CallOverlay from "shared/components/calling/CallOverlay";
import useConversationState from "shared/state/conversationState";
import DetailCreate from "shared/components/messaging/create/DetailCreate";
import DetailLoading from "shared/components/messaging/detail/DetailLoading";
import DetailError from "shared/components/messaging/detail/DetailError";
import DetailWelcome from "shared/components/messaging/detail/DetailWelcome";
import {arrayContainsAll} from "shared/util/arrayUtils";
import {normalizeAddress} from "shared/util/addressHelper";
import DetailThread from "shared/components/messaging/thread/DetailThread";
import {PeopleContext} from "shared/state/peopleState";

export default function Messaging(props: {
        serverUrl: string;
        accessToken: string;
        refreshToken?: string;
        legacyPasswordAuth?: boolean;
        deviceName?: string;
        onReset?: VoidFunction;
}) {
        const {serverUrl, accessToken, refreshToken, legacyPasswordAuth, deviceName, onReset} = props;
        const [detailPane, setDetailPane] = useState<DetailPane>({type: DetailType.Loading});
        const [sidebarBanner, setSidebarBanner] = useState<ConnectionErrorCode | "connecting" | undefined>(undefined);
        const {
                conversations,
                visibleConversations,
                hasMoreConversations,
                loadConversations,
                loadMoreConversations,
                addConversation,
                markConversationRead
        } = useConversationState(detailPane.type === DetailType.Thread ? detailPane.conversationID : undefined, true);
        useEffect(() => {
                ConnectionManager.setBlueBubblesAuth({
                        serverUrl,
                        accessToken,
                        refreshToken,
                        legacyPasswordAuth,
                        deviceName
                });

                return () => {
                        ConnectionManager.setBlueBubblesAuth(undefined);
                };
        }, [serverUrl, accessToken, refreshToken, legacyPasswordAuth, deviceName]);
	
	const navigateConversation = useCallback((conversationID: number | string) => {
		//Ignore if conversations aren't loaded
		if(conversations === undefined) return;
		
		//Get the conversation
		let conversation: Conversation | undefined;
		if(typeof conversationID === "number") {
			conversation = conversations.find((conversation) => conversation.localID == conversationID);
		} else {
			conversation = conversations.find((conversation) => !conversation.localOnly && conversation.guid == conversationID);
		}
		if(conversation === undefined) return;
		
		//Mark the conversation as read
		if(conversation.unreadMessages) {
			markConversationRead(conversation.localID);
		}
		
		//Select the conversation
		setDetailPane({type: DetailType.Thread, conversationID: conversation.localID});
	}, [conversations, markConversationRead, setDetailPane]);
	
	const navigateConversationCreate = useCallback(() => {
		setDetailPane({type: DetailType.Create});
	}, [setDetailPane]);
	
	const createConversation = useCallback((conversation: Conversation) => {
		//If we have a matching local conversation, select it
		let matchingConversation: Conversation | undefined;
		if(conversation.localOnly) {
			matchingConversation = conversations?.find((existingConversation) => arrayContainsAll(existingConversation.members, conversation.members, normalizeAddress));
		} else {
			matchingConversation = conversations?.find((existingConversation) => !existingConversation.localOnly && existingConversation.guid == conversation.guid);
		}
		if(matchingConversation !== undefined) {
			setDetailPane({type: DetailType.Thread, conversationID: matchingConversation.localID});
			return;
		}
		
		//Add the new conversation and select it
		addConversation(conversation);
		setDetailPane({type: DetailType.Thread, conversationID: conversation.localID});
	}, [conversations, addConversation, setDetailPane]);
	
	const peopleState = useContext(PeopleContext);
	
        const requestPeoplePermission = useCallback(() => {
                // People data is not available when using BlueBubbles authentication.
                // Surface the reconfigure callback instead so the user can adjust their connection settings.
                onReset?.();
        }, [onReset]);
	
	useEffect(() => {
		//Initialize notifications
		getNotificationUtils().initialize();
		
		return () => {
			//Disconnect
			ConnectionManager.disconnect();
		};
	}, []);
	
	//Register for notification response events
	useEffect(() => {
		getNotificationUtils().getMessageActionEmitter().subscribe(navigateConversation);
		return () => {
			getNotificationUtils().getMessageActionEmitter().unsubscribe(navigateConversation);
			getPlatformUtils().getChatActivationEmitter()?.unsubscribe(navigateConversation);
		};
	}, [navigateConversation]);
	
	//Subscribe to connection updates
	const connectionListenerInitialized = useRef(false);
	useEffect(() => {
		const listener: ConnectionListener = {
			onConnecting(): void {
				//Checking if conversations have never been loaded
                                if(conversations === undefined) {
                                        //Displaying the full-screen loading pane
                                        setDetailPane({type: DetailType.Loading});
                                } else {
                                        //Displaying a loading indicator on the sidebar
                                        setSidebarBanner("connecting");
                                }
                        },

                        onOpen(): void {
				//Check if conversations have never been loaded
				if(conversations === undefined) {
					//Request conversation details
					loadConversations().then((conversations) => {
						if(conversations.length > 0) {
							//If there are any conversations available, select the first one
							setDetailPane({type: DetailType.Thread, conversationID: conversations[0].localID});
						} else {
							//Otherwise show a welcome screen
							setDetailPane({type: DetailType.Welcome});
						}
						
						//Register for activations
						getPlatformUtils().initializeActivations();
						getPlatformUtils().getChatActivationEmitter()?.subscribe(navigateConversation);
					}).catch((reason: MessageError) => {
						console.error("Failed to fetch conversations", reason);
						ConnectionManager.disconnect();
					});
				} else {
					//Clear the error from the sidebar
					setSidebarBanner(undefined);
					
					//Fetch missed messages
					ConnectionManager.requestMissedMessages();
                                }
                        },

                        onClose(error: ConnectionErrorCode): void {
				//Check if conversations have never been loaded
				if(conversations === undefined) {
					//Display a full-screen error pane
					setDetailPane({type: DetailType.Error, errorCode: error});
                                } else {
                                        //Displaying an error in the sidebar
                                        setSidebarBanner(error);
                                }
                        },
                };
                ConnectionManager.addConnectionListener(listener);
		
		//Connect
		if(!connectionListenerInitialized.current) {
			if(ConnectionManager.isDisconnected()) {
				ConnectionManager.connect();
			} else {
				if(ConnectionManager.isConnected()) {
					listener.onOpen();
				} else {
					listener.onConnecting();
				}
			}
			
			connectionListenerInitialized.current = true;
		}
		
		return () => ConnectionManager.removeConnectionListener(listener);
        }, [conversations, setDetailPane, setSidebarBanner, navigateConversation, loadConversations]);
	
	let masterNode: React.ReactNode;
	switch(detailPane.type) {
		case DetailType.Thread: {
			const conversation: Conversation = conversations!.find((conversation) => conversation.localID === detailPane.conversationID)!;
			masterNode = <DetailThread conversation={conversation} />;
			break;
		}
		case DetailType.Create:
			masterNode = <DetailCreate onConversationCreated={createConversation} />;
			break;
		case DetailType.Loading:
			masterNode = <DetailLoading />;
			break;
		case DetailType.Error:
			masterNode = <DetailError error={detailPane.errorCode} resetCallback={props.onReset} />;
			break;
		case DetailType.Welcome:
			masterNode = <DetailWelcome />;
			break;
	}
	
	return (
		<SnackbarProvider>
			<Stack direction="row" width="100%" height="100%">
				<Box
					width="30vw"
					minWidth="350px"
					maxWidth="400px"
					bgcolor="background.sidebar">
<Sidebar
conversations={visibleConversations}
hasMoreConversations={hasMoreConversations}
onLoadMoreConversations={loadMoreConversations}
selectedConversation={detailPane.type === DetailType.Thread ? detailPane.conversationID : undefined}
                                                onConversationSelected={navigateConversation}
                                                onCreateSelected={navigateConversationCreate}
                                                errorBanner={(typeof sidebarBanner === "number") ? sidebarBanner : undefined}
                                                needsPeoplePermission={peopleState.needsPermission}
                                                onRequestPeoplePermission={requestPeoplePermission} />
				</Box>
				
				<Divider orientation="vertical" />
				
				<Box flex={1} minWidth={0}>{masterNode}</Box>
			</Stack>
			
			<CallOverlay />
		</SnackbarProvider>
	);
}

enum DetailType {
	Thread,
	Create,
	Loading,
	Error,
	Welcome,
}

type DetailPane = {
	type: DetailType.Create | DetailType.Loading | DetailType.Welcome;
} | {
	type: DetailType.Thread;
	conversationID: number;
} | {
	type: DetailType.Error;
	errorCode: ConnectionErrorCode;
};