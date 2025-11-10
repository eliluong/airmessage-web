import {ConversationItem, MessageItem} from "./blocks";
import {ConversationItemType} from "./stateCodes";

export interface ConversationAttachmentEntry {
        readonly key: string;
        readonly guid: string;
        readonly mimeType: string;
        readonly sender?: string;
        readonly timestamp: Date;
        readonly blurhash?: string;
        readonly name: string;
        readonly size: number;
        readonly messageGuid?: string;
        readonly messageServerID?: number;
}

function buildAttachmentKey(message: MessageItem, attachmentGuid: string | undefined, index: number): string {
        if(attachmentGuid) return attachmentGuid;
        const messageKey = message.guid ?? `${message.chatGuid ?? "local"}`;
        return `${messageKey}:${index}`;
}

function resolveSender(message: MessageItem): string | undefined {
        return message.sender ?? "me";
}

export function normalizeConversationAttachment(message: MessageItem, attachmentIndex: number): ConversationAttachmentEntry | undefined {
        const attachment = message.attachments[attachmentIndex];
        if(!attachment) return undefined;
        const key = buildAttachmentKey(message, attachment.guid, attachmentIndex);
        const guid = attachment.guid ?? key;
        return {
                key,
                guid,
                mimeType: attachment.type,
                sender: resolveSender(message),
                timestamp: message.date,
                blurhash: attachment.blurhash,
                name: attachment.name,
                size: attachment.size,
                messageGuid: message.guid,
                messageServerID: message.serverID
        };
}

export function extractConversationAttachments(items: ConversationItem[]): ConversationAttachmentEntry[] {
        const entries: ConversationAttachmentEntry[] = [];
        for(const item of items) {
                if(item.itemType !== ConversationItemType.Message) continue;
                const message = item as MessageItem;
                for(let index = 0; index < message.attachments.length; index++) {
                        const entry = normalizeConversationAttachment(message, index);
                        if(entry) entries.push(entry);
                }
        }
        entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return entries;
}

export function mergeConversationAttachments(
        current: ConversationAttachmentEntry[],
        incoming: ConversationAttachmentEntry[]
): ConversationAttachmentEntry[] {
        if(incoming.length === 0) return current;
        const map = new Map<string, ConversationAttachmentEntry>();
        for(const entry of current) {
                map.set(entry.key, entry);
        }
        for(const entry of incoming) {
                const existing = map.get(entry.key);
                if(!existing || existing.timestamp.getTime() < entry.timestamp.getTime()) {
                        map.set(entry.key, entry);
                }
        }
        const merged = Array.from(map.values());
        merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return merged;
}
