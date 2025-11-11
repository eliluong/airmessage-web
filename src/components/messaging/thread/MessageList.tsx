import React from "react";
import {Box, CircularProgress, Stack} from "@mui/material";
import Message from "./item/Message";
import {getMessageFlow} from "../../../util/conversationUtils";
import {Conversation, ConversationItem} from "../../../data/blocks";
import {ConversationItemType, MessageStatusCode} from "../../../data/stateCodes";
import {appleServiceAppleMessage} from "../../../data/appleConstants";
import EventEmitter from "../../../util/eventEmitter";
import ConversationActionParticipant from "./item/ConversationActionParticipant";
import ConversationActionRename from "./item/ConversationActionRename";
import {ThreadFocusTarget, areFocusTargetsEqual} from "./types";

interface Props {
        conversation: Conversation;
        items: ConversationItem[];
        messageSubmitEmitter: EventEmitter<void>;
        onRequestHistory: () => void;
        showHistoryLoader?: boolean;
        focusTarget?: ThreadFocusTarget;
}

interface State {
        isInThreshold: boolean;
}

const historyLoadScrollThreshold = 300;

export default class MessageList extends React.Component<Props, State> {
        state = {
                isInThreshold: false
        };

        //Reference to the message scroll list element
        readonly scrollRef = React.createRef<HTMLDivElement>();
	
	//List scroll position snapshot values
	private snapshotScrollHeight = 0;
        private snapshotScrollTop = 0;

        //Used to track whether the message list should be scrolled to the bottom when the component is next updated
        private shouldScrollNextUpdate = false;

        private focusAppliedKey?: string;
        private focusHighlightTimeout?: number;
        private focusHighlightElement?: HTMLElement;
        private focusHighlightOriginalBoxShadow?: string;

        private readonly handleScroll = (event: React.UIEvent<HTMLDivElement, UIEvent>) => {
                if(event.currentTarget.scrollTop < historyLoadScrollThreshold) {
                        if(!this.state.isInThreshold) {
                                this.setState({isInThreshold: true});
                                this.props.onRequestHistory();
                        }
                } else {
                        if(this.state.isInThreshold) {
                                this.setState({isInThreshold: false});
                        }
                }
        };

        shouldComponentUpdate(nextProps: Readonly<Props>, nextState: Readonly<State>): boolean {
                const focusChanged = !areFocusTargetsEqual(nextProps.focusTarget, this.props.focusTarget);
                return nextState.isInThreshold !== this.state.isInThreshold
                        || nextProps.items !== this.props.items
                        || nextProps.showHistoryLoader !== this.props.showHistoryLoader
                        || nextProps.conversation !== this.props.conversation
                        || nextProps.messageSubmitEmitter !== this.props.messageSubmitEmitter
                        || focusChanged;
        }

        render() {
                const normalizedService = this.props.conversation.service.toLowerCase();
                const supportsReceipts = normalizedService === appleServiceAppleMessage.toLowerCase()
                        && this.props.conversation.members.length === 1;

                const latestOutgoingIndex = supportsReceipts ? this.props.items.findIndex((item) =>
                        item.itemType === ConversationItemType.Message
                        && item.sender === undefined
                ) : -1;

                const latestOutgoingItem = latestOutgoingIndex === -1 ? undefined : this.props.items[latestOutgoingIndex];

                let readTargetIndex = -1;
                let deliveredTargetIndex = -1;

                if(supportsReceipts && latestOutgoingItem?.itemType === ConversationItemType.Message) {
                        if(latestOutgoingItem.status === MessageStatusCode.Read) {
                                readTargetIndex = latestOutgoingIndex;
                        } else if(latestOutgoingItem.status === MessageStatusCode.Delivered) {
                                deliveredTargetIndex = latestOutgoingIndex;
                        }
                }
		
		return (
			<Box sx={{
				width: "100%",
				flexGrow: 1,
				minHeight: 0,
				
				padding: 2,
				overflowX: "hidden",
				overflowY: "scroll",
				scrollBehavior: "smooth"
			}} ref={this.scrollRef} onScroll={this.handleScroll}>
				<Stack sx={{
					width: "100%",
					maxWidth: "1000px",
					marginX: "auto"
				}} direction="column-reverse">
					{this.props.items.map((item, i, array) => {
						if(item.itemType === ConversationItemType.Message) {
							return (
								<Message
									key={(item.localID ?? item.guid)}
									message={item}
									isGroupChat={this.props.conversation.members.length > 1}
									service={this.props.conversation.service}
									flow={getMessageFlow(item, array[i + 1], array[i - 1])}
									showStatus={i === readTargetIndex || i === deliveredTargetIndex} />
							);
						} else if(item.itemType === ConversationItemType.ParticipantAction) {
							return (
								<ConversationActionParticipant
									key={(item.localID ?? item.guid)}
									action={item} />
							);
						} else if(item.itemType === ConversationItemType.ChatRenameAction) {
							return (
								<ConversationActionRename
									key={(item.localID ?? item.guid)}
									action={item} />
							);
						} else {
							return null;
						}
					})}
					
					{this.props.showHistoryLoader && <HistoryLoadingProgress key="static-historyloader" />}
				</Stack>
			</Box>
		);
	}
	
        componentDidMount() {
                //Registering the submit listener
                this.props.messageSubmitEmitter.subscribe(this.onMessageSubmit);

                //Scrolling to the bottom of the list
                if(this.props.focusTarget) {
                        this.ensureFocusVisible();
                } else {
                        this.scrollToBottom(true);
                }
        }

        getSnapshotBeforeUpdate() {
                this.shouldScrollNextUpdate = !this.props.focusTarget && this.checkScrolledToBottom();

                const element = this.scrollRef.current!;
                this.snapshotScrollHeight = element.scrollHeight;
                this.snapshotScrollTop = element.scrollTop;

		return null;
	}
	
	componentDidUpdate(prevProps: Readonly<Props>) {
		//Scrolling the list to the bottom if needed
		if(this.shouldScrollNextUpdate) {
			this.scrollToBottom();
			this.shouldScrollNextUpdate = false;
		}
		//Restoring the scroll position when new items are added at the top
		else if(this.props.showHistoryLoader !== prevProps.showHistoryLoader && this.checkScrolledToTop()) {
			const element = this.scrollRef.current!;
			this.setScroll(this.snapshotScrollTop + (element.scrollHeight - this.snapshotScrollHeight), true);
		}
		
		//Updating the submit emitter
                if(this.props.messageSubmitEmitter !== prevProps.messageSubmitEmitter) {
                        prevProps.messageSubmitEmitter.unsubscribe(this.onMessageSubmit);
                        this.props.messageSubmitEmitter.subscribe(this.onMessageSubmit);
                }

                this.ensureFocusVisible();
        }


        componentWillUnmount() {
                //Unregistering the submit listener
                this.props.messageSubmitEmitter.unsubscribe(this.onMessageSubmit);
                this.clearFocusHighlight();
        }

        private readonly onMessageSubmit = () => {
                if(this.props.focusTarget) return;
                setTimeout(() => this.scrollToBottom(), 0);
        };

        private scrollToBottom(disableAnimation: boolean = false): void {
                this.setScroll(this.scrollRef.current!.scrollHeight, disableAnimation);
        }
	
	private setScroll(scrollTop: number, disableAnimation: boolean = false) {
		const element = this.scrollRef.current!;
		if(disableAnimation) element.style.scrollBehavior = "auto";
		element.scrollTop = scrollTop;
		if(disableAnimation) element.style.scrollBehavior = "";
	}
	
	private checkScrolledToBottom(): boolean {
		const element = this.scrollRef.current!;
		return element.scrollHeight - element.scrollTop - element.clientHeight <= 0;
	}
	
        private checkScrolledToTop(): boolean {
                const element = this.scrollRef.current!;
                return element.scrollTop <= 0;
        }

        private ensureFocusVisible(): void {
                if(!this.props.focusTarget) {
                        this.focusAppliedKey = undefined;
                        this.clearFocusHighlight();
                        return;
                }

                const focusKey = this.getFocusKey(this.props.focusTarget);
                if(focusKey && this.focusAppliedKey === focusKey) return;

                if(this.tryScrollToFocus()) {
                        this.focusAppliedKey = focusKey;
                }
        }

        private tryScrollToFocus(): boolean {
                const {focusTarget} = this.props;
                const container = this.scrollRef.current;
                if(!focusTarget || !container) return false;

                const candidates = Array.from(
                        container.querySelectorAll<HTMLElement>("[data-message-guid], [data-message-server-id]")
                );

                const element = candidates.find((candidate) => {
                        if(focusTarget.guid && candidate.dataset.messageGuid === focusTarget.guid) return true;
                        if(focusTarget.serverID !== undefined && candidate.dataset.messageServerId !== undefined) {
                                const parsedServerID = Number(candidate.dataset.messageServerId);
                                if(!Number.isNaN(parsedServerID) && parsedServerID === focusTarget.serverID) return true;
                        }
                        return false;
                });

                if(!element) return false;

                const previousBehavior = container.style.scrollBehavior;
                container.style.scrollBehavior = "auto";
                element.scrollIntoView({block: "center"});
                container.style.scrollBehavior = previousBehavior;

                this.highlightElement(element);

                return true;
        }

        private highlightElement(element: HTMLElement): void {
                this.clearFocusHighlight();

                if(element.animate) {
                        element.animate(
                                [
                                        {boxShadow: "0 0 0 0 rgba(25, 118, 210, 0.6)"},
                                        {boxShadow: "0 0 0 8px rgba(25, 118, 210, 0)"}
                                ],
                                {duration: 1200, easing: "ease-out"}
                        );
                        return;
                }

                this.focusHighlightElement = element;
                this.focusHighlightOriginalBoxShadow = element.style.boxShadow;
                element.style.boxShadow = "0 0 0 4px rgba(25, 118, 210, 0.6)";
                this.focusHighlightTimeout = window.setTimeout(() => {
                        if(!this.focusHighlightElement) return;
                        this.focusHighlightElement.style.boxShadow = this.focusHighlightOriginalBoxShadow ?? "";
                        this.focusHighlightElement = undefined;
                        this.focusHighlightOriginalBoxShadow = undefined;
                        this.focusHighlightTimeout = undefined;
                }, 1200);
        }

        private clearFocusHighlight(): void {
                if(this.focusHighlightTimeout !== undefined) {
                        window.clearTimeout(this.focusHighlightTimeout);
                        this.focusHighlightTimeout = undefined;
                }
                if(this.focusHighlightElement) {
                        this.focusHighlightElement.style.boxShadow = this.focusHighlightOriginalBoxShadow ?? "";
                        this.focusHighlightElement = undefined;
                        this.focusHighlightOriginalBoxShadow = undefined;
                }
        }

        private getFocusKey(target?: ThreadFocusTarget): string | undefined {
                if(!target) return undefined;
                return `${target.serverID ?? ""}|${target.guid ?? ""}`;
        }
}

function HistoryLoadingProgress() {
	return (
		<Box sx={{
			display: "flex",
			alignItems: "center",
			justifyContent: "center"
		}}>
			<CircularProgress />
		</Box>
	);
}