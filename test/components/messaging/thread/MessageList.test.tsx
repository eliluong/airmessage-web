import React from "react";
import {cleanup, render} from "@testing-library/react";
import MessageList from "shared/components/messaging/thread/MessageList";
import Message from "shared/components/messaging/thread/item/Message";
import EventEmitter from "shared/util/eventEmitter";
import {LocalConversation, MessageItem} from "shared/data/blocks";
import {ConversationItemType, ConversationPreviewType, MessageStatusCode} from "shared/data/stateCodes";
import {appleServiceAppleMessage} from "shared/data/appleConstants";

jest.mock("shared/components/messaging/thread/item/Message", () => ({
        __esModule: true,
        default: jest.fn(() => null)
}));

jest.mock("shared/components/messaging/thread/item/ConversationActionParticipant", () => ({
        __esModule: true,
        default: jest.fn(() => null)
}));

jest.mock("shared/components/messaging/thread/item/ConversationActionRename", () => ({
        __esModule: true,
        default: jest.fn(() => null)
}));

jest.mock("shared/util/conversationUtils", () => ({
        __esModule: true,
        getMessageFlow: jest.fn(() => ({anchorTop: false, anchorBottom: false}))
}));

const mockedMessage = jest.mocked(Message);

function createConversation(overrides?: Partial<LocalConversation>): LocalConversation {
        const baseConversation: LocalConversation = {
                localOnly: true,
                localID: 1,
                service: appleServiceAppleMessage,
                members: ["member"],
                preview: {
                        type: ConversationPreviewType.Message,
                        date: new Date(0),
                        attachments: []
                },
                unreadMessages: false
        };

        return {
                ...baseConversation,
                ...overrides
        };
}

function createMessageItem(overrides: Partial<MessageItem>): MessageItem {
        return {
                itemType: ConversationItemType.Message,
                guid: overrides.guid,
                date: overrides.date ?? new Date(0),
                text: overrides.text,
                sender: overrides.sender,
                attachments: overrides.attachments ?? [],
                stickers: overrides.stickers ?? [],
                tapbacks: overrides.tapbacks ?? [],
                status: overrides.status ?? MessageStatusCode.Delivered,
                statusDate: overrides.statusDate,
                error: overrides.error,
                progress: overrides.progress
        } as MessageItem;
}

describe("MessageList delivery status rendering", () => {
        afterEach(() => {
                mockedMessage.mockClear();
                cleanup();
        });

        it("omits delivery status for ineligible conversations", () => {
                const conversation = createConversation({members: ["member", "other"]});
                const items = [
                        createMessageItem({guid: "delivered", status: MessageStatusCode.Delivered, sender: undefined}),
                        createMessageItem({guid: "read", status: MessageStatusCode.Read, statusDate: new Date(), sender: undefined})
                ];

                render(
                        <MessageList
                                conversation={conversation}
                                items={items}
                                messageSubmitEmitter={new EventEmitter<void>()}
                                onRequestHistory={jest.fn()}
                        />
                );

                expect(mockedMessage).toHaveBeenCalledTimes(2);
                for(const call of mockedMessage.mock.calls) {
                        expect(call[0].showStatus).not.toBe(true);
                }
        });

        it("shows read receipt status for eligible conversations", () => {
                const conversation = createConversation({members: ["member"]});
                const readDate = new Date();
                const items = [
                        createMessageItem({guid: "first", status: MessageStatusCode.Delivered, sender: undefined}),
                        createMessageItem({guid: "read", status: MessageStatusCode.Read, statusDate: readDate, sender: undefined})
                ];

                render(
                        <MessageList
                                conversation={conversation}
                                items={items}
                                messageSubmitEmitter={new EventEmitter<void>()}
                                onRequestHistory={jest.fn()}
                        />
                );

                expect(mockedMessage).toHaveBeenCalledTimes(2);
                const readCall = mockedMessage.mock.calls.find((call) => call[0].message.guid === "read");
                expect(readCall).toBeDefined();
                expect(readCall?.[0].showStatus).toBe(true);

                const otherCalls = mockedMessage.mock.calls.filter((call) => call[0].message.guid !== "read");
                for(const call of otherCalls) {
                        expect(call[0].showStatus).not.toBe(true);
                }
        });

        it("falls back to delivered status when read receipts are missing a timestamp", () => {
                const conversation = createConversation({members: ["member"]});
                const items = [
                        createMessageItem({guid: "delivered", status: MessageStatusCode.Delivered, sender: undefined}),
                        createMessageItem({guid: "read", status: MessageStatusCode.Read, sender: undefined})
                ];

                render(
                        <MessageList
                                conversation={conversation}
                                items={items}
                                messageSubmitEmitter={new EventEmitter<void>()}
                                onRequestHistory={jest.fn()}
                        />
                );

                expect(mockedMessage).toHaveBeenCalledTimes(2);
                const deliveredCall = mockedMessage.mock.calls.find((call) => call[0].message.guid === "delivered");
                expect(deliveredCall).toBeDefined();
                expect(deliveredCall?.[0].showStatus).toBe(true);

                const readCall = mockedMessage.mock.calls.find((call) => call[0].message.guid === "read");
                expect(readCall).toBeDefined();
                expect(readCall?.[0].showStatus).not.toBe(true);
        });
});
