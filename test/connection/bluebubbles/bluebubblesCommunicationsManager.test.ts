import BlueBubblesCommunicationsManager from "../../../src/connection/bluebubbles/bluebubblesCommunicationsManager";
import DataProxy from "../../../src/connection/dataProxy";
import {BlueBubblesAuthState} from "../../../src/connection/bluebubbles/session";
import {MessageResponse} from "../../../src/connection/bluebubbles/types";
import {MessageItem, TapbackItem} from "../../../src/data/blocks";
import {ConversationItemType, TapbackType} from "../../../src/data/stateCodes";

class StubProxy extends DataProxy {
        public readonly proxyType = "stub";
        start(): void {}
        stop(): void {}
        send(): void {}
}

function createManager() {
        const proxy = new StubProxy();
        const auth: BlueBubblesAuthState = {serverUrl: "https://example.com", accessToken: "token"};
        return new BlueBubblesCommunicationsManager(proxy, auth);
}

function buildMessage(overrides: Partial<MessageResponse>): MessageResponse {
        return {
                originalROWID: overrides.originalROWID ?? 1,
                guid: overrides.guid ?? "guid",
                text: overrides.text ?? "Hello",
                handle: overrides.handle ?? ({address: "friend"} as any),
                handleId: overrides.handleId ?? 1,
                otherHandle: overrides.otherHandle ?? 0,
                chats: overrides.chats,
                attachments: overrides.attachments ?? [],
                subject: overrides.subject ?? "",
                country: overrides.country,
                error: overrides.error ?? 0,
                dateCreated: overrides.dateCreated ?? Date.now(),
                dateRead: overrides.dateRead ?? null,
                dateDelivered: overrides.dateDelivered ?? null,
                isFromMe: overrides.isFromMe ?? false,
                isDelayed: overrides.isDelayed,
                isDelivered: overrides.isDelivered,
                isAutoReply: overrides.isAutoReply,
                isSystemMessage: overrides.isSystemMessage,
                isServiceMessage: overrides.isServiceMessage,
                isForward: overrides.isForward,
                isArchived: overrides.isArchived ?? false,
                hasDdResults: overrides.hasDdResults,
                cacheRoomnames: overrides.cacheRoomnames,
                isAudioMessage: overrides.isAudioMessage,
                datePlayed: overrides.datePlayed ?? null,
                itemType: overrides.itemType ?? 0,
                groupTitle: overrides.groupTitle ?? null,
                groupActionType: overrides.groupActionType ?? 0,
                isExpired: overrides.isExpired,
                balloonBundleId: overrides.balloonBundleId ?? null,
                associatedMessageGuid: overrides.associatedMessageGuid ?? null,
                associatedMessageType: overrides.associatedMessageType ?? null,
                expressiveSendStyleId: overrides.expressiveSendStyleId ?? null,
                timeExpressiveSendPlayed: overrides.timeExpressiveSendPlayed ?? null,
                replyToGuid: overrides.replyToGuid ?? null,
                isCorrupt: overrides.isCorrupt,
                isSpam: overrides.isSpam,
                threadOriginatorGuid: overrides.threadOriginatorGuid ?? null,
                threadOriginatorPart: overrides.threadOriginatorPart ?? null,
                dateRetracted: overrides.dateRetracted ?? null,
                dateEdited: overrides.dateEdited ?? null,
                partCount: overrides.partCount ?? null,
                payloadData: overrides.payloadData,
                hasPayloadData: overrides.hasPayloadData,
                wasDeliveredQuietly: overrides.wasDeliveredQuietly,
                didNotifyRecipient: overrides.didNotifyRecipient,
                shareStatus: overrides.shareStatus ?? null,
                shareDirection: overrides.shareDirection ?? null,
        } as MessageResponse;
}

describe("BlueBubbles tapback parsing", () => {
        it("maps string tapback codes to modifiers and message items", () => {
                const manager = createManager();
                const managerAny = manager as unknown as {
                        processMessages(messages: MessageResponse[]): {items: MessageItem[]; modifiers: TapbackItem[]};
                };

                const targetGuid = "base-guid";
                const baseMessage = buildMessage({guid: targetGuid, text: "Funny joke ?"});
                const reactionMessage = buildMessage({
                        guid: "reaction-guid",
                        associatedMessageGuid: targetGuid,
                        associatedMessageType: "laugh",
                        dateCreated: (baseMessage.dateCreated as number) + 1,
                });

                const {items, modifiers} = managerAny.processMessages([reactionMessage, baseMessage]);
                expect(modifiers).toHaveLength(1);
                expect(modifiers[0]).toMatchObject({
                        tapbackType: TapbackType.Laugh,
                        isAddition: true,
                        messageGuid: targetGuid,
                });

                const messageItem = items.find(
                        (item) => item.itemType === ConversationItemType.Message && item.guid === targetGuid
                ) as MessageItem | undefined;
                expect(messageItem).toBeDefined();
                expect(messageItem?.tapbacks).toHaveLength(1);
                expect(messageItem?.tapbacks[0]).toMatchObject({tapbackType: TapbackType.Laugh, isAddition: true});
        });

        it("removes tapbacks when BlueBubbles sends string removal codes", () => {
                const manager = createManager();
                const managerAny = manager as unknown as {
                        processMessages(messages: MessageResponse[]): {items: MessageItem[]; modifiers: TapbackItem[]};
                        tapbackCache: Map<string, TapbackItem[]>;
                };

                const targetGuid = "base-guid";
                const baseMessage = buildMessage({guid: targetGuid});
                const addReaction = buildMessage({
                        guid: "add-guid",
                        associatedMessageGuid: targetGuid,
                        associatedMessageType: "love",
                });

                managerAny.processMessages([addReaction, baseMessage]);

                expect(managerAny.tapbackCache.get(targetGuid)).toHaveLength(1);

                const removeReaction = buildMessage({
                        guid: "remove-guid",
                        associatedMessageGuid: targetGuid,
                        associatedMessageType: "-love",
                });

                const {modifiers} = managerAny.processMessages([removeReaction]);
                expect(modifiers).toHaveLength(1);
                expect(modifiers[0]).toMatchObject({tapbackType: TapbackType.Love, isAddition: false});
                expect(managerAny.tapbackCache.get(targetGuid)).toHaveLength(0);
        });
});
