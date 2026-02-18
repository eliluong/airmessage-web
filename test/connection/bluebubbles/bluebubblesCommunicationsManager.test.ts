import {ConnectionErrorCode, MessageModifierType, MessageStatusCode, TapbackType} from "../../../src/data/stateCodes";
import BlueBubblesCommunicationsManager from "../../../src/connection/bluebubbles/bluebubblesCommunicationsManager";
import BlueBubblesRealtimeChannel from "../../../src/connection/bluebubbles/realtimeChannel";
import DataProxy from "../../../src/connection/dataProxy";
import * as blueBubblesApi from "../../../src/connection/bluebubbles/api";
import * as debugLogging from "../../../src/connection/bluebubbles/debugLogging";
import type {BlueBubblesAuthState} from "../../../src/connection/bluebubbles/session";
import type {ChatResponse, HandleResponse, MessageResponse, ServerMetadataResponse} from "../../../src/connection/bluebubbles/types";
import {__testables} from "../../../src/connection/bluebubbles/bluebubblesCommunicationsManager";

describe("mapTapback", () => {
        const {mapTapback, normalizeMessageGuid} = __testables;
        let warnSpy: jest.SpyInstance;

        beforeEach(() => {
                warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        });

        afterEach(() => {
                warnSpy.mockRestore();
        });

        const createMessage = (associatedMessageType: string, overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 1,
                guid: "reaction-guid",
                text: "",
                handleId: 2,
                otherHandle: 0,
                subject: "",
                error: 0,
                dateCreated: 0,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: "target-guid",
                associatedMessageType,
                expressiveSendStyleId: null,
                handle: {
                        originalROWID: 3,
                        address: "friend@example.com",
                        service: "iMessage"
                },
                ...overrides
        } as MessageResponse);

        it.each([
                {
                        name: "love addition string identifier",
                        identifier: "love",
                        expectedType: TapbackType.Love,
                        isAddition: true
                },
                {
                        name: "emphasize addition string identifier (case insensitive)",
                        identifier: "EMPHASIZE",
                        expectedType: TapbackType.Emphasis,
                        isAddition: true
                },
                {
                        name: "laugh removal string identifier",
                        identifier: "-laugh",
                        expectedType: TapbackType.Laugh,
                        isAddition: false,
                        overrides: {isFromMe: true}
                }
        ])("normalizes $name", ({identifier, expectedType, isAddition, overrides}) => {
                const tapback = mapTapback(createMessage(identifier, overrides));
                expect(tapback).toBeDefined();
                expect(tapback).toEqual(
                        expect.objectContaining({
                                tapbackType: expectedType,
                                isAddition,
                                type: MessageModifierType.Tapback,
                                messageGuid: "target-guid",
                                messageIndex: 0
                        })
                );

                const expectedSender = overrides?.isFromMe ? "me" : "friend@example.com";
                expect(tapback?.sender).toBe(expectedSender);
                expect(warnSpy).not.toHaveBeenCalled();
        });

        it("normalizes associated message GUID prefixes", () => {
                const tapback = mapTapback(createMessage("laugh", {associatedMessageGuid: "p:0/target-guid"}));
                expect(tapback?.messageGuid).toBe("target-guid");
        });

        it.each([
                {input: undefined, expected: undefined},
                {input: "", expected: undefined},
                {input: "FF9E0E18-EA94-42EB-9CC0-F2963E86D7E1", expected: "FF9E0E18-EA94-42EB-9CC0-F2963E86D7E1"},
                {input: "p:0/FF9E0E18-EA94-42EB-9CC0-F2963E86D7E1", expected: "FF9E0E18-EA94-42EB-9CC0-F2963E86D7E1"},
                {input: "foo:bar/FF9E0E18", expected: "FF9E0E18"},
                {input: "no-prefix", expected: "no-prefix"}
        ])("normalizeMessageGuid(%o) returns %o", ({input, expected}) => {
                expect(normalizeMessageGuid(input)).toBe(expected);
        });
});

describe("computeMessageStatus", () => {
        const {computeMessageStatus} = __testables;

        const createOutgoingMessage = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 1,
                guid: "outgoing-guid",
                text: "hello",
                handleId: 1,
                otherHandle: 0,
                chats: [],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: 1_000,
                dateRead: null,
                dateDelivered: null,
                isFromMe: true,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: {originalROWID: 3, address: "me", service: "iMessage"},
                ...overrides
        } as MessageResponse);

        it("treats outgoing messages with a read timestamp as read even when receipts are disabled", () => {
                const result = computeMessageStatus(createOutgoingMessage({dateRead: 5_000}), false, false);
                expect(result.status).toBe(MessageStatusCode.Read);
                expect(result.statusDate?.getTime()).toBe(5_000);
        });

        it("treats outgoing messages with a delivered timestamp as delivered even when receipts are disabled", () => {
                const result = computeMessageStatus(createOutgoingMessage({dateDelivered: 4_000}), false, false);
                expect(result.status).toBe(MessageStatusCode.Delivered);
                expect(result.statusDate?.getTime()).toBe(4_000);
        });

        it("falls back to sent when no timestamps or receipt support exist", () => {
                const result = computeMessageStatus(createOutgoingMessage(), false, false);
                expect(result.status).toBe(MessageStatusCode.Sent);
                expect(result.statusDate).toBeUndefined();
        });
});

describe("processMessages SMS tapbacks", () => {
        class DummyProxy extends DataProxy {
                public override readonly proxyType = "dummy";
                public override start(): void {/* no-op */}
                public override stop(): void {/* no-op */}
                public override send(_data: ArrayBuffer, _encrypt: boolean): void {/* no-op */}
        }

        const auth: BlueBubblesAuthState = {serverUrl: "", accessToken: ""};
        const chatGuid = "chat-guid";

        const createChat = (): ChatResponse => ({
                originalROWID: 1,
                guid: chatGuid,
                participants: [],
                style: 0,
                chatIdentifier: chatGuid,
                isArchived: false,
                displayName: ""
        } as ChatResponse);

        const createHandle = (address: string): HandleResponse => ({
                originalROWID: 1,
                address,
                service: "SMS"
        } as HandleResponse);

        const baseMessageGuid = "C4F6D871-1AFC-4180-8501-0FE4DF11CF65";

        const createBaseSmsMessage = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 1,
                guid: baseMessageGuid,
                text: "whew",
                handleId: 1,
                otherHandle: 0,
                chats: [createChat()],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: 1000,
                dateRead: null,
                dateDelivered: null,
                isFromMe: true,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: createHandle("me"),
                ...overrides
        } as MessageResponse);

        const createQuestionTapback = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 2,
                guid: "EEDA84A3-6750-9CE6-59B5-9FE62387AA09",
                text: "???? to “?whew?”",
                handleId: 2,
                otherHandle: 0,
                chats: [createChat()],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: 1100,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: createHandle("friend@example.com"),
                ...overrides
        } as MessageResponse);

        const createLikeTapback = (target: string, overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 3,
                guid: "6B4C0743-8F68-4CB7-A06A-5BF9447CF88C",
                text: `Liked “${target}”`,
                handleId: 2,
                otherHandle: 0,
                chats: [createChat()],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: 1_100,
                dateRead: null,
                dateDelivered: null,
                isFromMe: true,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: createHandle("me"),
                ...overrides
        } as MessageResponse);

        const createManager = () => new BlueBubblesCommunicationsManager(new DummyProxy(), auth);

        it("matches SMS tapbacks with wrapped target text in the same batch", () => {
                const manager = createManager();
                const baseMessage = createBaseSmsMessage();
                const reaction = createQuestionTapback();

                const {items, modifiers} = (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([baseMessage, reaction]);

                expect(modifiers).toHaveLength(1);
                const tapback = modifiers[0] as unknown as {tapbackType: TapbackType; messageGuid: string; sender: string; isAddition: boolean};
                expect(tapback.tapbackType).toBe(TapbackType.Question);
                expect(tapback.messageGuid).toBe(baseMessageGuid);
                expect(tapback.sender).toBe("friend@example.com");
                expect(tapback.isAddition).toBe(true);

                const typedItems = items as Array<{guid?: string}>;
                const messageGuids = typedItems.map((item) => item.guid).filter((guid): guid is string => Boolean(guid));
                expect(messageGuids).toContain(baseMessageGuid);
        });

        it("falls back to the SMS cache when the target is not in the batch", () => {
                const manager = createManager();
                const baseMessage = createBaseSmsMessage();
                const reaction = createQuestionTapback({dateCreated: 1200});

                (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([baseMessage]);
                const {modifiers} = (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([reaction]);

                expect(modifiers).toHaveLength(1);
                const tapback = modifiers[0] as unknown as {messageGuid: string; tapbackType: TapbackType};
                expect(tapback.messageGuid).toBe(baseMessageGuid);
                expect(tapback.tapbackType).toBe(TapbackType.Question);
        });

        it("matches SMS tapbacks when the target text is truncated with an ellipsis", () => {
                const manager = createManager();
                const fullText = "Ooo its stitzlein im p sure he doesn't want hip blocked";
                const baseMessage = createBaseSmsMessage({
                        text: fullText,
                        handle: createHandle("friend@example.com"),
                        isFromMe: false
                });
                const reaction = createLikeTapback("Ooo its stitzlein im p sure he doesn't want hip bl…", {
                        dateCreated: 1_200,
                        handle: createHandle("me"),
                        isFromMe: true
                });

                const {modifiers} = (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([baseMessage, reaction]);

                expect(modifiers).toHaveLength(1);
                const tapback = modifiers[0] as unknown as {messageGuid: string; tapbackType: TapbackType};
                expect(tapback.messageGuid).toBe(baseMessageGuid);
                expect(tapback.tapbackType).toBe(TapbackType.Like);
        });
});

describe("processMessages iMessage emoji tapbacks", () => {
        class DummyProxy extends DataProxy {
                public override readonly proxyType = "dummy";
                public override start(): void {/* no-op */}
                public override stop(): void {/* no-op */}
                public override send(_data: ArrayBuffer, _encrypt: boolean): void {/* no-op */}
        }

        const auth: BlueBubblesAuthState = {serverUrl: "", accessToken: ""};
        const chatGuid = "imessage-chat-guid";
        const baseMessageGuid = "E2BB8654-24D6-4931-BA43-10D1CADF3E6D";
        const baseText = "Hello friends, my wife sarah and I are both turning 40 soon this year.";

        const createChat = (): ChatResponse => ({
                originalROWID: 1,
                guid: chatGuid,
                participants: [],
                style: 0,
                chatIdentifier: chatGuid,
                isArchived: false,
                displayName: ""
        } as ChatResponse);

        const createHandle = (address: string): HandleResponse => ({
                originalROWID: 1,
                address,
                service: "iMessage"
        } as HandleResponse);

        const createBaseMessage = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 1,
                guid: baseMessageGuid,
                text: baseText,
                handleId: 1,
                otherHandle: 0,
                chats: [createChat()],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: 1_000,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: createHandle("friend@example.com"),
                ...overrides
        } as MessageResponse);

        const createEmojiReaction = (overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 2,
                guid: "A305D551-2F28-4BB4-8D7A-95B5C2869568",
                text: `Reacted 🎊 to “${baseText}”`,
                handleId: 2,
                otherHandle: 0,
                chats: [createChat()],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: 1_100,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: createHandle("friend@example.com"),
                ...overrides
        } as MessageResponse);

        const createManager = () => new BlueBubblesCommunicationsManager(new DummyProxy(), auth);

        it("parses iMessage emoji reactions and attaches them to the target message", () => {
                const manager = createManager();
                const baseMessage = createBaseMessage();
                const reaction = createEmojiReaction();

                const {items, modifiers} = (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([baseMessage, reaction]);

                expect(modifiers).toHaveLength(1);
                const tapback = modifiers[0] as unknown as {tapbackType: TapbackType; tapbackEmoji?: string; messageGuid: string; isAddition: boolean};
                expect(tapback.tapbackType).toBe(TapbackType.Emoji);
                expect(tapback.tapbackEmoji).toBe("🎊");
                expect(tapback.messageGuid).toBe(baseMessageGuid);
                expect(tapback.isAddition).toBe(true);

                const itemGuids = (items as Array<{guid?: string}>).map((item) => item.guid).filter((guid): guid is string => Boolean(guid));
                expect(itemGuids).toContain(baseMessageGuid);
                expect(itemGuids).not.toContain(reaction.guid);
        });

        it("falls back to the text-reaction cache when emoji target text is not in the same batch", () => {
                const manager = createManager();
                const baseMessage = createBaseMessage();
                const reaction = createEmojiReaction({dateCreated: 1_200});

                (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([baseMessage]);
                const {modifiers} = (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([reaction]);

                expect(modifiers).toHaveLength(1);
                const tapback = modifiers[0] as unknown as {messageGuid: string; tapbackType: TapbackType; tapbackEmoji?: string};
                expect(tapback.messageGuid).toBe(baseMessageGuid);
                expect(tapback.tapbackType).toBe(TapbackType.Emoji);
                expect(tapback.tapbackEmoji).toBe("🎊");
        });

        it("parses emoji reaction removals", () => {
                const manager = createManager();
                const baseMessage = createBaseMessage();
                const reaction = createEmojiReaction({
                        guid: "REACT-ADD",
                        dateCreated: 1_100
                });
                const removal = createEmojiReaction({
                        guid: "REACT-REMOVE",
                        dateCreated: 1_200,
                        text: `Removed reaction 🎊 from “${baseText}”`
                });

                (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([baseMessage, reaction]);
                const {modifiers} = (manager as unknown as {processMessages(messages: MessageResponse[]): {items: unknown[]; modifiers: unknown[]}}).processMessages([removal]);

                expect(modifiers).toHaveLength(1);
                const tapback = modifiers[0] as unknown as {messageGuid: string; tapbackType: TapbackType; tapbackEmoji?: string; isAddition: boolean};
                expect(tapback.messageGuid).toBe(baseMessageGuid);
                expect(tapback.tapbackType).toBe(TapbackType.Emoji);
                expect(tapback.tapbackEmoji).toBe("🎊");
                expect(tapback.isAddition).toBe(false);
        });
});

describe("polling catch-up", () => {
        class DummyProxy extends DataProxy {
                public override readonly proxyType = "dummy";
                public override start(): void {/* no-op */}
                public override stop(): void {/* no-op */}
                public override send(_data: ArrayBuffer, _encrypt: boolean): void {/* no-op */}
        }

        const auth: BlueBubblesAuthState = {serverUrl: "", accessToken: ""};
        const chatGuid = "chat-guid";

        const createPollMessage = (rowId: number): MessageResponse => ({
                originalROWID: rowId,
                guid: `message-${rowId}`,
                text: `message ${rowId}`,
                handleId: 1,
                otherHandle: 0,
                chats: [
                        {
                                originalROWID: 1,
                                guid: chatGuid,
                                participants: [],
                                style: 0,
                                chatIdentifier: chatGuid,
                                isArchived: false,
                                displayName: ""
                        } as ChatResponse
                ],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: rowId * 1000,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: {
                        originalROWID: 1,
                        address: "friend@example.com",
                        service: "iMessage"
                } as HandleResponse
        } as MessageResponse);

        afterEach(() => {
                jest.restoreAllMocks();
        });

        it("pages through all new rows when more than one poll page is pending", async () => {
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                const firstPage = Array.from({length: 50}, (_, index) => createPollMessage(101 + index));
                const secondPage = Array.from({length: 50}, (_, index) => createPollMessage(151 + index));

                const debugSpy = jest.spyOn(debugLogging, "logBlueBubblesDebug");
                const querySpy = jest.spyOn(blueBubblesApi, "queryMessages")
                        .mockResolvedValueOnce({data: firstPage})
                        .mockResolvedValueOnce({data: secondPage})
                        .mockResolvedValueOnce({data: []});

                const listener = {
                        onPacket: jest.fn(),
                        onIDUpdate: jest.fn(),
                        onMessageUpdate: jest.fn(),
                        onModifierUpdate: jest.fn()
                };

                (manager as unknown as {lastRowId: number}).lastRowId = 100;
                (manager as unknown as {listener: unknown}).listener = listener;
                await (manager as unknown as {pollUpdates(): Promise<void>}).pollUpdates();

                expect(querySpy).toHaveBeenCalledTimes(3);
                expect(querySpy.mock.calls[0][1]).toEqual(expect.objectContaining({
                        sort: "ASC",
                        where: [
                                {
                                        statement: "message.ROWID > :rowid",
                                        args: {rowid: 100}
                                }
                        ]
                }));
                expect(querySpy.mock.calls[1][1]).toEqual(expect.objectContaining({
                        where: [
                                {
                                        statement: "message.ROWID > :rowid",
                                        args: {rowid: 150}
                                }
                        ]
                }));
                expect(querySpy.mock.calls[2][1]).toEqual(expect.objectContaining({
                        where: [
                                {
                                        statement: "message.ROWID > :rowid",
                                        args: {rowid: 200}
                                }
                        ]
                }));

                expect((manager as unknown as {lastRowId: number}).lastRowId).toBe(200);
                expect(listener.onMessageUpdate).toHaveBeenCalledTimes(2);

                const emittedRowIds = listener.onMessageUpdate.mock.calls
                        .flatMap(([batch]: [{serverID: number}[]]) => batch.map((item) => item.serverID))
                        .slice()
                        .sort((a, b) => a - b);
                expect(emittedRowIds).toHaveLength(100);
                expect(emittedRowIds[0]).toBe(101);
                expect(emittedRowIds[99]).toBe(200);

                const pollCycleLogs = debugSpy.mock.calls.filter(([label]) => label === "Poll cycle");
                expect(pollCycleLogs).toHaveLength(1);
                expect(pollCycleLogs[0][1]).toEqual(expect.objectContaining({
                        source: "interval",
                        pagesFetched: 2,
                        totalMessages: 100,
                        startRowId: 100,
                        endRowId: 200,
                        endReason: "no-data"
                }));
        });
});

describe("realtime message ingestion", () => {
        class DummyProxy extends DataProxy {
                public override readonly proxyType = "dummy";
                public override start(): void {/* no-op */}
                public override stop(): void {/* no-op */}
                public override send(_data: ArrayBuffer, _encrypt: boolean): void {/* no-op */}
        }

        const auth: BlueBubblesAuthState = {serverUrl: "", accessToken: "guid-token"};
        const chatGuid = "chat-guid";

        const createRealtimeMessage = (rowId: number, overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: rowId,
                guid: `message-${rowId}`,
                text: `message ${rowId}`,
                handleId: 1,
                otherHandle: 0,
                chats: [
                        {
                                originalROWID: 1,
                                guid: chatGuid,
                                participants: [],
                                style: 0,
                                chatIdentifier: chatGuid,
                                isArchived: false,
                                displayName: ""
                        } as ChatResponse
                ],
                attachments: [],
                subject: "",
                error: 0,
                dateCreated: rowId * 1000,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: null,
                associatedMessageType: null,
                expressiveSendStyleId: null,
                handle: {
                        originalROWID: 1,
                        address: "friend@example.com",
                        service: "iMessage"
                } as HandleResponse,
                ...overrides
        } as MessageResponse);

        const createListener = () => ({
                onPacket: jest.fn(),
                onIDUpdate: jest.fn(),
                onMessageUpdate: jest.fn(),
                onModifierUpdate: jest.fn()
        });

        afterEach(() => {
                jest.restoreAllMocks();
        });

        it("ingests full raw socket message payloads without hydration", async () => {
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                const listener = createListener();
                const querySpy = jest.spyOn(blueBubblesApi, "queryMessages");
                (manager as unknown as {listener: unknown}).listener = listener;

                const message = createRealtimeMessage(101);
                await (manager as unknown as {ingestRealtimeEvent(eventName: "new-message", payload: unknown): Promise<void>})
                        .ingestRealtimeEvent("new-message", message);

                expect(querySpy).not.toHaveBeenCalled();
                expect(listener.onPacket).toHaveBeenCalledTimes(1);
                expect(listener.onMessageUpdate).toHaveBeenCalledTimes(1);
                expect(listener.onMessageUpdate.mock.calls[0][0][0]).toEqual(
                        expect.objectContaining({
                                guid: message.guid,
                                serverID: message.originalROWID
                        })
                );
                expect((manager as unknown as {lastRowId: number}).lastRowId).toBe(101);
        });

        it("ingests envelope JSON string payloads", async () => {
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                const listener = createListener();
                (manager as unknown as {listener: unknown}).listener = listener;

                const message = createRealtimeMessage(102);
                await (manager as unknown as {ingestRealtimeEvent(eventName: "updated-message", payload: unknown): Promise<void>})
                        .ingestRealtimeEvent("updated-message", {
                                data: JSON.stringify(message),
                                encoding: "JSON_STRING"
                        });

                expect(listener.onMessageUpdate).toHaveBeenCalledTimes(1);
                expect(listener.onMessageUpdate.mock.calls[0][0][0]).toEqual(
                        expect.objectContaining({
                                guid: message.guid,
                                serverID: message.originalROWID
                        })
                );
        });

        it("hydrates partial payloads by message GUID before processing", async () => {
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                const listener = createListener();
                (manager as unknown as {listener: unknown}).listener = listener;

                const hydratedMessage = createRealtimeMessage(103, {
                        guid: "hydrated-guid",
                        text: "hydrated"
                });
                const querySpy = jest.spyOn(blueBubblesApi, "queryMessages")
                        .mockResolvedValueOnce({data: [hydratedMessage]});

                await (manager as unknown as {ingestRealtimeEvent(eventName: "updated-message", payload: unknown): Promise<void>})
                        .ingestRealtimeEvent("updated-message", {
                                data: {
                                        guid: "hydrated-guid",
                                        chats: hydratedMessage.chats
                                },
                                partial: true
                        });

                expect(querySpy).toHaveBeenCalledTimes(1);
                expect(querySpy.mock.calls[0][1]).toEqual(expect.objectContaining({
                        where: [
                                {
                                        statement: "message.guid = :guid",
                                        args: {guid: "hydrated-guid"}
                                }
                        ]
                }));
                expect(listener.onMessageUpdate).toHaveBeenCalledTimes(1);
                expect(listener.onMessageUpdate.mock.calls[0][0][0]).toEqual(
                        expect.objectContaining({
                                guid: "hydrated-guid",
                                serverID: 103
                        })
                );
        });

        it("suppresses duplicate poll emissions when the same message already arrived via realtime", async () => {
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                const listener = createListener();
                (manager as unknown as {listener: unknown}).listener = listener;

                const message = createRealtimeMessage(200, {guid: "overlap-guid"});
                await (manager as unknown as {ingestRealtimeEvent(eventName: "new-message", payload: unknown): Promise<void>})
                        .ingestRealtimeEvent("new-message", message);

                (manager as unknown as {lastRowId: number}).lastRowId = 199;
                const querySpy = jest.spyOn(blueBubblesApi, "queryMessages")
                        .mockResolvedValueOnce({data: [message]})
                        .mockResolvedValueOnce({data: []});

                await (manager as unknown as {pollUpdates(): Promise<void>}).pollUpdates();

                expect(querySpy).toHaveBeenCalledTimes(1);
                expect(listener.onMessageUpdate).toHaveBeenCalledTimes(1);
        });

        it("emits updates for the same message GUID when message content changes", async () => {
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                const listener = createListener();
                (manager as unknown as {listener: unknown}).listener = listener;

                const initial = createRealtimeMessage(300, {guid: "status-guid", text: "first text"});
                const updated = createRealtimeMessage(300, {guid: "status-guid", text: "updated text"});

                await (manager as unknown as {ingestRealtimeEvent(eventName: "new-message", payload: unknown): Promise<void>})
                        .ingestRealtimeEvent("new-message", initial);
                await (manager as unknown as {ingestRealtimeEvent(eventName: "updated-message", payload: unknown): Promise<void>})
                        .ingestRealtimeEvent("updated-message", updated);

                expect(listener.onMessageUpdate).toHaveBeenCalledTimes(2);
        });
});

describe("realtime channel lifecycle", () => {
        class DummyProxy extends DataProxy {
                public override readonly proxyType = "dummy";
                public override start(): void {/* no-op */}
                public override stop(): void {/* no-op */}
                public override send(_data: ArrayBuffer, _encrypt: boolean): void {/* no-op */}
        }

        const auth: BlueBubblesAuthState = {serverUrl: "", accessToken: "guid-token"};

        const createMetadata = (serverVersion: string): ServerMetadataResponse => ({
                computer_id: "computer",
                os_version: "14.0",
                server_version: serverVersion,
                private_api: true,
                helper_connected: true,
                proxy_service: "none",
                detected_icloud: "",
                detected_imessage: "",
                macos_time_sync: null,
                local_ipv4s: [],
                local_ipv6s: [],
                features: {
                        private_api: true,
                        helper_connected: true
                }
        });

        afterEach(() => {
                jest.restoreAllMocks();
        });

        it("creates and tears down the realtime channel for supported server versions", async () => {
                const fetchMetadataSpy = jest.spyOn(blueBubblesApi, "fetchServerMetadata").mockResolvedValue(createMetadata("1.6.0"));
                const realtimeConnectSpy = jest.spyOn(BlueBubblesRealtimeChannel.prototype, "connect").mockImplementation(() => undefined);
                const realtimeDisconnectSpy = jest.spyOn(BlueBubblesRealtimeChannel.prototype, "disconnect").mockImplementation(() => undefined);

                const onOpen = jest.fn();
                const onClose = jest.fn();
                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                (manager as unknown as {listener: unknown}).listener = {onOpen, onClose};

                await (manager as unknown as {initialize(): Promise<void>}).initialize();
                expect(fetchMetadataSpy).toHaveBeenCalledTimes(1);
                expect(onOpen).toHaveBeenCalledTimes(1);
                expect(realtimeConnectSpy).toHaveBeenCalledTimes(1);

                manager.disconnect();
                expect(realtimeDisconnectSpy).toHaveBeenCalledTimes(1);
                expect(onClose).toHaveBeenCalledWith(ConnectionErrorCode.Connection);
        });

        it("keeps realtime disabled on older server versions", async () => {
                jest.spyOn(blueBubblesApi, "fetchServerMetadata").mockResolvedValue(createMetadata("1.5.9"));
                const realtimeConnectSpy = jest.spyOn(BlueBubblesRealtimeChannel.prototype, "connect").mockImplementation(() => undefined);

                const manager = new BlueBubblesCommunicationsManager(new DummyProxy(), auth);
                (manager as unknown as {listener: unknown}).listener = {onOpen: jest.fn(), onClose: jest.fn()};

                await (manager as unknown as {initialize(): Promise<void>}).initialize();
                expect(realtimeConnectSpy).not.toHaveBeenCalled();
        });
});
