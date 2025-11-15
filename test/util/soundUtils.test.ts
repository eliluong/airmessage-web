import {
        playSoundMessageIn,
        playSoundMessageOut,
        playSoundNotification,
        playSoundTapback
} from "shared/util/soundUtils";
import {setBlueBubblesDebugLoggingEnabled} from "shared/connection/bluebubbles/debugLogging";
import type {MessageItem, MessageModifier} from "shared/data/blocks";
import {ConversationItemType, MessageModifierType, MessageStatusCode} from "shared/data/stateCodes";

describe("soundUtils debug logging", () => {
        const originalAudio = (global as any).Audio;
        let consoleSpy: jest.SpyInstance;

        const createMessage = (): MessageItem => ({
                itemType: ConversationItemType.Message,
                localID: 1,
                chatLocalID: 1,
                date: new Date(),
                text: "Hello",
                subject: undefined,
                sender: undefined,
                attachments: [],
                stickers: [],
                tapbacks: [],
                sendStyle: undefined,
                status: MessageStatusCode.Sent,
                statusDate: undefined,
                error: undefined,
                progress: undefined
        });

        const createModifier = (): MessageModifier => ({
                type: MessageModifierType.Tapback,
                chatGuid: "chat-guid",
                messageGuid: "message-guid",
                messageIndex: 0,
                sender: "me",
                isAddition: true,
                tapbackType: 0
        } as MessageModifier);

        beforeEach(() => {
                const playMock = jest.fn(() => ({catch: jest.fn()}));
                (global as any).Audio = jest.fn(() => ({play: playMock}));
                consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined as unknown as void);
                setBlueBubblesDebugLoggingEnabled(true);
        });

        afterEach(() => {
                consoleSpy.mockRestore();
                setBlueBubblesDebugLoggingEnabled(true);
        });

        afterAll(() => {
                if(originalAudio) {
                        (global as any).Audio = originalAudio;
                } else {
                        delete (global as any).Audio;
                }
        });

        it("logs context when each sound plays", () => {
                const message = createMessage();
                const modifier = createModifier();

                const cases: Array<{label: string; fn: (context: any) => void; context: any}> = [
                        {
                                label: "notification",
                                fn: playSoundNotification,
                                context: {type: "notification" as const, conversationId: "guid", message}
                        },
                        {
                                label: "incoming message",
                                fn: playSoundMessageIn,
                                context: {type: "messageIn" as const, message}
                        },
                        {
                                label: "outgoing message",
                                fn: playSoundMessageOut,
                                context: {type: "messageOut" as const, messages: [message]}
                        },
                        {
                                label: "tapback",
                                fn: playSoundTapback,
                                context: {type: "tapback" as const, modifiers: [modifier]}
                        }
                ];

                for(const testCase of cases) {
                        consoleSpy.mockClear();
                        testCase.fn(testCase.context);
                        expect(consoleSpy).toHaveBeenCalledWith(`[BlueBubbles] Playing ${testCase.label} sound`, testCase.context);
                }
        });

        it("respects disabled debug logging", () => {
                        setBlueBubblesDebugLoggingEnabled(false);
                        consoleSpy.mockClear();
                        const message = createMessage();
                        playSoundNotification({type: "notification", message});
                        expect(consoleSpy).not.toHaveBeenCalled();
        });
});
