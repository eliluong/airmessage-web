import React from "react";
import {Box, CircularProgress} from "@mui/material";
import {Virtuoso, VirtuosoHandle} from "react-virtuoso";
import Message from "./item/Message";
import {getMessageFlow} from "../../../util/conversationUtils";
import {Conversation, ConversationItem, getConversationMixedID} from "../../../data/blocks";
import {ConversationItemType, MessageStatusCode} from "../../../data/stateCodes";
import EventEmitter from "../../../util/eventEmitter";
import ConversationActionParticipant from "./item/ConversationActionParticipant";
import ConversationActionRename from "./item/ConversationActionRename";

interface Props {
	conversation: Conversation;
	items: ConversationItem[];
	messageSubmitEmitter: EventEmitter<void>;
	onRequestHistory: () => void;
	showHistoryLoader?: boolean;
}

interface State {
	isInThreshold: boolean;
}

const historyLoadScrollThreshold = 300;

export default class MessageList extends React.Component<Props, State> {
	state = {
		isInThreshold: false
	};
	
        private readonly virtuosoRef = React.createRef<VirtuosoHandle>();
        private readonly scrollRef = React.createRef<HTMLDivElement>();
        private isAtBottom = true;
        private snapshotScrollHeight = 0;
        private snapshotScrollTop = 0;
        private shouldScrollNextUpdate = false;

        private readonly handleScrollThreshold = () => {
                const element = this.scrollRef.current;
                if(!element) return;

                if(element.scrollTop < historyLoadScrollThreshold) {
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
	
	render() {
		//The latest outgoing item with the "read" status
		const readTargetIndex = this.props.items.findIndex((item) =>
			item.itemType === ConversationItemType.Message
			&& item.sender === undefined
			&& item.status === MessageStatusCode.Read);
		
		//The latest outgoing item with the "delivered" status, no further than the latest item with the "read" status
		const deliveredTargetIndex = this.props.items
			.slice(0, readTargetIndex === -1 ? undefined : readTargetIndex)
			.findIndex((item) =>
				item.itemType === ConversationItemType.Message
				&& item.sender === undefined
				&& item.status === MessageStatusCode.Delivered);
		
                return (
                        <Box sx={{
                                width: "100%",
                                flexGrow: 1,
                                minHeight: 0,
                                display: "flex"
                        }}>
                                <Virtuoso
                                        key={getConversationMixedID(this.props.conversation)}
                                        ref={this.virtuosoRef}
                                        style={{flexGrow: 1}}
                                        data={this.props.items}
                                        initialTopMostItemIndex={Math.max(this.props.items.length - 1, 0)}
                                        computeItemKey={this.computeItemKey}
                                        atBottomStateChange={this.handleBottomStateChange}
                                        rangeChanged={this.handleRangeChanged}
                                        increaseViewportBy={{top: historyLoadScrollThreshold, bottom: 400}}
                                        scrollerRef={this.setScrollerRef}
                                        components={{
                                                Scroller: this.renderScroller,
                                                List: this.renderList,
                                                Header: this.props.showHistoryLoader ? HistoryLoadingProgress : undefined
                                        }}
                                        itemContent={(index, item) => this.renderItem(index, item, readTargetIndex, deliveredTargetIndex)}
                                />
                        </Box>
                );
        }

        componentDidMount() {
                //Registering the submit listener
                this.props.messageSubmitEmitter.subscribe(this.onMessageSubmit);

                //Scrolling to the bottom of the list
                this.scrollToBottom(true);
        }

        componentDidUpdate(prevProps: Readonly<Props>) {
                if(getConversationMixedID(prevProps.conversation) !== getConversationMixedID(this.props.conversation)) {
                        this.isAtBottom = true;
                        if(this.state.isInThreshold) {
                                this.setState({isInThreshold: false});
                        }
                        this.scrollToBottom(true);
                }

                if(this.props.items !== prevProps.items) {
                        if(this.shouldScrollNextUpdate) {
                                this.scrollToBottom();
                                this.shouldScrollNextUpdate = false;
                        } else {
                                this.handleItemChanges(prevProps.items);
                        }
                }

                //Updating the submit emitter
                if(this.props.messageSubmitEmitter !== prevProps.messageSubmitEmitter) {
                        prevProps.messageSubmitEmitter.unsubscribe(this.onMessageSubmit);
                        this.props.messageSubmitEmitter.subscribe(this.onMessageSubmit);
                }
        }


        getSnapshotBeforeUpdate() {
                this.shouldScrollNextUpdate = this.isAtBottom;

                const element = this.scrollRef.current;
                if(element) {
                        this.snapshotScrollHeight = element.scrollHeight;
                        this.snapshotScrollTop = element.scrollTop;
                }

                return null;
        }


        componentWillUnmount() {
                //Unregistering the submit listener
                this.props.messageSubmitEmitter.unsubscribe(this.onMessageSubmit);
        }

        private readonly onMessageSubmit = () => {
                setTimeout(() => this.scrollToBottom(), 0);
        };

        private scrollToBottom(disableAnimation: boolean = false): void {
                if(!this.virtuosoRef.current || this.props.items.length === 0) return;

                this.virtuosoRef.current.scrollToIndex({
                        index: this.props.items.length - 1,
                        align: "end",
                        behavior: disableAnimation ? "auto" : "smooth"
                });
        }

        private readonly setScrollerRef = (element: HTMLElement | null) => {
                const divElement = element instanceof HTMLDivElement ? element : null;
                if(this.scrollRef.current === divElement) return;

                this.scrollRef.current = divElement;
        };

        private readonly renderScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
                const {onScroll, style, ...rest} = props;
                return (
                        <Box
                                {...rest}
                                ref={(instance) => {
                                        if(typeof ref === "function") ref(instance);
                                        else if(ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = instance;
                                        this.setScrollerRef(instance);
                                }}
                                sx={{
                                        width: "100%",
                                        flexGrow: 1,
                                        minHeight: 0,
                                        padding: 2,
                                        overflowX: "hidden",
                                        scrollBehavior: "smooth"
                                }}
                                style={style}
                                onScroll={(event) => {
                                        onScroll?.(event);
                                        this.handleScrollThreshold();
                                }}
                        />
                );
        });

        private readonly renderList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
                const {style, ...rest} = props;
                return (
                        <Box
                                {...rest}
                                ref={ref}
                                style={style}
                                sx={{
                                        width: "100%",
                                        maxWidth: "1000px",
                                        marginX: "auto"
                                }}
                        />
                );
        });

        private readonly computeItemKey = (index: number, item: ConversationItem): React.Key => {
                return item.localID ?? item.guid ?? `${item.itemType}-${index}`;
        };

        private readonly handleBottomStateChange = (atBottom: boolean) => {
                this.isAtBottom = atBottom;
        };

        private readonly handleRangeChanged = () => {
                this.handleScrollThreshold();
        };

        private handleItemChanges(previousItems: ConversationItem[]): void {
                const element = this.scrollRef.current;
                if(!element) return;

                const previousLength = previousItems.length;
                const nextLength = this.props.items.length;

                if(nextLength > previousLength) {
                        const previousLast = previousItems[previousLength - 1];
                        const nextLast = this.props.items[nextLength - 1];

                        const previousLastKey = previousLast ? (previousLast.localID ?? previousLast.guid) : undefined;
                        const nextLastKey = nextLast ? (nextLast.localID ?? nextLast.guid) : undefined;

                        if(previousLastKey !== nextLastKey) {
                                if(this.isAtBottom) {
                                        this.scrollToBottom();
                                }
                        } else {
                                const delta = element.scrollHeight - this.snapshotScrollHeight;
                                if(delta !== 0) {
                                        element.scrollTo({top: this.snapshotScrollTop + delta, behavior: "auto"});
                                }
                        }
                }
        }

        private renderItem(index: number, item: ConversationItem, readTargetIndex: number, deliveredTargetIndex: number): React.ReactNode {
                const items = this.props.items;

                if(item.itemType === ConversationItemType.Message) {
                        return (
                                <Message
                                        message={item}
                                        isGroupChat={this.props.conversation.members.length > 1}
                                        service={this.props.conversation.service}
                                        flow={getMessageFlow(item, items[index - 1], items[index + 1])}
                                        showStatus={index === readTargetIndex || index === deliveredTargetIndex}
                                />
                        );
                } else if(item.itemType === ConversationItemType.ParticipantAction) {
                        return <ConversationActionParticipant action={item} />;
                } else if(item.itemType === ConversationItemType.ChatRenameAction) {
                        return <ConversationActionRename action={item} />;
                } else {
                        return null;
                }
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