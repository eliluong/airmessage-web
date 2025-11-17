import {ConversationItem, MessageItem} from "shared/data/blocks";
import {ConversationItemType, MessageStatusCode} from "shared/data/stateCodes";
import {deriveEditedMessageGroups, MessageItemWithEdits} from "shared/components/messaging/thread/hooks/useEditedMessageGroups";

describe("deriveEditedMessageGroups", () => {
        function buildMessage(overrides: Partial<MessageItem>): MessageItem {
                const base: MessageItem = {
                        itemType: ConversationItemType.Message,
                        localID: overrides.localID ?? Math.floor(Math.random() * 100000),
                        chatLocalID: 1,
                        guid: overrides.guid ?? `guid-${Math.random()}`,
                        date: overrides.date ?? new Date(),
                        text: overrides.text,
                        subject: overrides.subject,
                        sender: overrides.sender,
                        attachments: overrides.attachments ?? [],
                        stickers: overrides.stickers ?? [],
                        tapbacks: overrides.tapbacks ?? [],
                        sendStyle: overrides.sendStyle,
                        status: overrides.status ?? MessageStatusCode.Sent,
                        statusDate: overrides.statusDate,
                        error: overrides.error,
                        progress: overrides.progress
                };

                return base;
        }

        it("suppresses edit stubs and decorates the original message", () => {
                const original = buildMessage({
                        guid: "original",
                        sender: "friend",
                        text: "They are so bag but could make the playoffs",
                        date: new Date("2023-01-01T10:00:00Z")
                });
                const edit = buildMessage({
                        guid: "edit",
                        sender: "friend",
                        text: "Edited to “They are so bad but could make the playoffs”",
                        date: new Date("2023-01-01T10:05:00Z")
                });

                const items: ConversationItem[] = [edit, original];
                const result = deriveEditedMessageGroups(items);

                expect(result).toHaveLength(1);
                const message = result[0] as MessageItemWithEdits;
                expect(message.uiEdited).toBeDefined();
                expect(message.uiEdited?.latestText).toBe("They are so bad but could make the playoffs");
                expect(message.uiEdited?.history).toHaveLength(1);
                expect(message.uiEdited?.history[0].text).toBe("They are so bag but could make the playoffs");
        });

        it("leaves unmatched edits untouched", () => {
                const original = buildMessage({
                        guid: "original",
                        sender: "friend",
                        text: "Totally unrelated",
                        date: new Date("2023-01-01T08:00:00Z")
                });
                const edit = buildMessage({
                        guid: "edit",
                        sender: "friend",
                        text: "Edited to “Another message entirely”",
                        date: new Date("2023-01-01T08:10:00Z")
                });

                const items: ConversationItem[] = [edit, original];
                const result = deriveEditedMessageGroups(items);

                expect(result).toHaveLength(2);
                expect(result[0]).toBe(edit);
                expect(result[1]).toBe(original);
        });

        it("chains multiple edits into a single history", () => {
                const original = buildMessage({
                        guid: "original",
                        sender: "friend",
                        text: "Version A",
                        date: new Date("2023-01-01T09:00:00Z")
                });
                const firstEdit = buildMessage({
                        guid: "edit-1",
                        sender: "friend",
                        text: "Edited to “Version B”",
                        date: new Date("2023-01-01T09:10:00Z")
                });
                const secondEdit = buildMessage({
                        guid: "edit-2",
                        sender: "friend",
                        text: "Edited to “Version C”",
                        date: new Date("2023-01-01T09:20:00Z")
                });

                const items: ConversationItem[] = [secondEdit, firstEdit, original];
                const result = deriveEditedMessageGroups(items);

                expect(result).toHaveLength(1);
                const message = result[0] as MessageItemWithEdits;
                expect(message.uiEdited?.latestText).toBe("Version C");
                expect(message.uiEdited?.history.map((entry) => entry.text)).toEqual(["Version A", "Version B"]);
        });
});
