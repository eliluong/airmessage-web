import React from "react";
import {act, cleanup, render, waitFor} from "@testing-library/react";
import DetailThread from "shared/components/messaging/thread/DetailThread";
import type {MessageModifier} from "shared/data/blocks";
import {
        Conversation,
        ConversationItem,
        ConversationPreview,
        MessageItem,
        TapbackItem,
} from "shared/data/blocks";
import {ConversationItemType, ConversationPreviewType, MessageModifierType, MessageStatusCode, TapbackType} from "shared/data/stateCodes";
import localMessageCache from "shared/state/localMessageCache";
import {modifierUpdateEmitter} from "shared/connection/connectionManager";

const messageListRenders: ConversationItem[][] = [];

jest.mock("shared/components/messaging/thread/MessageList", () => ({
        __esModule: true,
        default: (props: {items: ConversationItem[]}) => {
                messageListRenders.push(props.items);
                return null;
        }
}));

jest.mock("shared/util/soundUtils", () => ({
        playSoundNotification: jest.fn(),
        playSoundMessageIn: jest.fn(),
        playSoundMessageOut: jest.fn(),
        playSoundTapback: jest.fn()
}));

jest.mock("shared/connection/connectionManager", () => {
        class MockEventEmitter<T> {
                private listeners = new Set<(event: T) => void>();

                public subscribe(listener: (event: T) => void): () => void {
                        this.listeners.add(listener);
                        return () => this.unsubscribe(listener);
                }

                public unsubscribe(listener: (event: T) => void): void {
                        this.listeners.delete(listener);
                }

                public notify(event: T): void {
                        for(const listener of this.listeners) {
                                listener(event);
                        }
                }
        }

        const modifierUpdateEmitter = new MockEventEmitter<MessageModifier[]>();
        const messageUpdateEmitter = new MockEventEmitter<ConversationItem[]>();
        const faceTimeSupportedEmitter = new MockEventEmitter<boolean>();

        return {
                __esModule: true,
                modifierUpdateEmitter,
                messageUpdateEmitter,
                faceTimeSupportedEmitter,
                fetchThread: jest.fn(),
                sendMessage: jest.fn(),
                sendFile: jest.fn(() => ({promise: Promise.resolve(), cancel: jest.fn()})),
                initiateFaceTimeCall: jest.fn(),
                getBlueBubblesAuth: jest.fn(() => undefined),
                getActiveProxyType: jest.fn(() => undefined)
        };
});

describe("DetailThread tapback handling", () => {
        beforeEach(() => {
                messageListRenders.length = 0;
                localMessageCache.clear();
        });

        afterEach(() => {
                cleanup();
                localMessageCache.clear();
        });

        it("removes a tapback after an add-then-remove sequence", async () => {
                const preview: ConversationPreview = {
                        type: ConversationPreviewType.Message,
                        date: new Date(0),
                        attachments: []
                };
                const conversation: Conversation = {
                        localID: 1,
                        service: "iMessage",
                        members: ["me", "friend"],
                        preview,
                        unreadMessages: false,
                        localOnly: true
                };

                const baseMessage: MessageItem = {
                        itemType: ConversationItemType.Message,
                        localID: 1,
                        chatLocalID: conversation.localID,
                        guid: "message-guid",
                        date: new Date(0),
                        text: "Hello",
                        subject: undefined,
                        sender: "friend",
                        attachments: [],
                        stickers: [],
                        tapbacks: [],
                        sendStyle: undefined,
                        status: MessageStatusCode.Sent,
                        statusDate: undefined,
                        error: undefined,
                        progress: undefined
                };

                localMessageCache.set(conversation.localID, [baseMessage]);

                render(<DetailThread conversation={conversation} />);
                await waitFor(() => expect(messageListRenders.length).toBeGreaterThan(0));

                const addition: TapbackItem = {
                        type: MessageModifierType.Tapback,
                        messageGuid: baseMessage.guid as string,
                        messageIndex: 0,
                        sender: "friend",
                        isAddition: true,
                        tapbackType: TapbackType.Like
                };

                await act(async () => {
                        modifierUpdateEmitter.notify([addition]);
                });

                await waitFor(() => {
                        const latest = messageListRenders[messageListRenders.length - 1];
                        const message = latest[0] as MessageItem;
                        expect(message.tapbacks).toHaveLength(1);
                });

                const removal: TapbackItem = {
                        type: MessageModifierType.Tapback,
                        messageGuid: baseMessage.guid as string,
                        messageIndex: 0,
                        sender: "friend",
                        isAddition: false,
                        tapbackType: TapbackType.Like
                };

                await act(async () => {
                        modifierUpdateEmitter.notify([removal]);
                });

                await waitFor(() => {
                        const latest = messageListRenders[messageListRenders.length - 1];
                        const message = latest[0] as MessageItem;
                        expect(message.tapbacks).toHaveLength(0);
                });
        });
});
