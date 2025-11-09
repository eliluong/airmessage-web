import {MessageModifierType, TapbackType} from "../../../src/data/stateCodes";
import BlueBubblesCommunicationsManager from "../../../src/connection/bluebubbles/bluebubblesCommunicationsManager";
import DataProxy from "../../../src/connection/dataProxy";
import type {BlueBubblesAuthState} from "../../../src/connection/bluebubbles/session";
import type {ChatResponse, HandleResponse, MessageResponse} from "../../../src/connection/bluebubbles/types";
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
});
