import {ConversationPreview, LinkedConversation} from "../../data/blocks";
import {ConversationPreviewType} from "../../data/stateCodes";
import {ChatResponse, MessageResponse} from "./types";

export function buildConversationPreview(message: MessageResponse): ConversationPreview {
        const attachments = (message.attachments ?? [])
                .filter((attachment) => !attachment.hideAttachment)
                .map((attachment) => attachment.transferName);
        return {
                type: ConversationPreviewType.Message,
                date: new Date(message.dateCreated),
                text: message.text || undefined,
                attachments,
                sendStyle: message.expressiveSendStyleId || undefined
        };
}

export function inferService(chat: ChatResponse): string {
        if(chat.participants && chat.participants.length > 0) {
                return chat.participants[0].service || "iMessage";
        }
        return "iMessage";
}

export function convertChatResponse(chat: ChatResponse): LinkedConversation {
        const members = (chat.participants ?? []).map((handle) => handle.address).filter(Boolean);
        const preview: ConversationPreview = chat.lastMessage ? buildConversationPreview(chat.lastMessage) : {
                type: ConversationPreviewType.ChatCreation,
                date: new Date()
        };
        return {
                localID: chat.originalROWID,
                guid: chat.guid,
                service: inferService(chat),
                name: chat.displayName || undefined,
                members,
                preview,
                unreadMessages: false,
                localOnly: false
        };
}
