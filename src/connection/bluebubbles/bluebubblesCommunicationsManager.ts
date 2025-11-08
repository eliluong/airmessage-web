import CommunicationsManager from "../communicationsManager";
import DataProxy from "../dataProxy";
import {Conversation, ConversationItem, ConversationPreview, LinkedConversation, MessageItem, TapbackItem} from "../../data/blocks";
import {
        AttachmentRequestErrorCode,
        ConnectionErrorCode,
        ConversationItemType,
        ConversationPreviewType,
        CreateChatErrorCode,
        MessageError,
        MessageErrorCode,
        MessageModifierType,
        MessageStatusCode,
        ParticipantActionType,
        TapbackType
} from "../../data/stateCodes";
import {TransferAccumulator, BasicAccumulator} from "../transferAccumulator";
import ConversationTarget from "../../data/conversationTarget";
import {BlueBubblesAuthState} from "./session";
import {
        AttachmentResponse,
        AttachmentSendResponse,
        ChatQueryResponse,
        ChatResponse,
        MessageQueryResponse,
        MessageResponse,
        MessageSendResponse,
        ServerMetadataResponse
} from "./types";
import {
        BlueBubblesApiError,
        appendLegacyAuthParams,
        createChat as createChatApi,
        downloadAttachment,
        fetchChat,
        fetchChats,
        fetchServerMetadata,
        pingServer,
        queryMessages,
        sendTextMessage
} from "./api";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_THREAD_PAGE_SIZE = 50;
const TAPBACK_ADD_OFFSET = 2000;
const TAPBACK_REMOVE_OFFSET = 3000;

interface PendingReaction {
        messageGuid: string;
        tapback: TapbackItem;
}

export default class BlueBubblesCommunicationsManager extends CommunicationsManager {
        private readonly auth: BlueBubblesAuthState;
        private metadata: ServerMetadataResponse | undefined;
        private pollTimer: ReturnType<typeof setInterval> | undefined;
        private isClosed = false;
        private lastMessageTimestamp: number | undefined;
        private readonly tapbackCache = new Map<string, TapbackItem[]>();
        private privateApiEnabled = false;
        private supportsDeliveredReceipts = false;
        private supportsReadReceipts = false;
        private readonly conversationGuidCache = new Map<string, string>();

        constructor(dataProxy: DataProxy, auth: BlueBubblesAuthState, private readonly options: {onError?: (error: Error) => void} = {}) {
                super(dataProxy);
                this.auth = auth;
        }

        public override get communicationsVersion(): number[] {
                const version = this.metadata?.server_version;
                if(!version) return [];
                const parts = version
                        .split(".")
                        .map((part) => Number.parseInt(part.replace(/[^\d]/g, ""), 10))
                        .filter((value) => !Number.isNaN(value));
                return parts;
        }

        public override connect(): void {
                this.initialize().catch((error) => this.handleFatalError(error));
        }

        public override disconnect(code?: ConnectionErrorCode): void {
                this.teardown();
                this.listener?.onClose(code ?? ConnectionErrorCode.Connection);
        }

        protected handleOpen(): void {
                // no-op: the REST transport is controlled directly by this manager
        }

        protected handleClose(_: ConnectionErrorCode): void {
                // no-op
        }

        protected handleMessage(_: ArrayBuffer, __: boolean): void {
                // REST transport does not emit binary packets
        }

        public override sendPing(): boolean {
                pingServer(this.auth).catch(() => undefined);
                return true;
        }

        public override requestLiteConversations(): boolean {
                this.fetchLiteConversations();
                return true;
        }

        public override requestConversationInfo(chatGUIDs: string[]): boolean {
                this.fetchConversationInfo(chatGUIDs);
                return true;
        }

        public override requestLiteThread(chatGUID: string, firstMessageID?: number): boolean {
                this.fetchThread(chatGUID, firstMessageID);
                return true;
        }

        public override sendMessage(requestID: number, conversation: ConversationTarget, message: string): boolean {
                this.performSendMessage(requestID, conversation, message).catch((error) => {
                        const messageError = mapMessageError(error);
                        this.listener?.onSendMessageResponse(requestID, messageError);
                });
                return true;
        }

        public override async sendFile(requestID: number, conversation: ConversationTarget, file: File, progressCallback: (bytesUploaded: number) => void): Promise<string> {
                try {
                        const payload = new FormData();
                        const tempGuid = generateTempGuid(requestID);
                        payload.append("chatGuid", await this.resolveConversationTarget(conversation));
                        payload.append("attachment", file);
                        payload.append("name", file.name);
                        payload.append("tempGuid", tempGuid);

                        const response = await uploadAttachmentWithProgress(this.auth, payload, progressCallback);
                        const {items, modifiers} = this.processMessages([response.data]);
                        if(items.length > 0) {
                                this.listener?.onMessageUpdate(items);
                        }
                        if(modifiers.length > 0) {
                                this.listener?.onModifierUpdate(modifiers);
                        }
                        this.listener?.onSendMessageResponse(requestID, undefined);
                        return response.data.guid;
                } catch(error) {
                        const messageError = mapMessageError(error);
                        this.listener?.onSendMessageResponse(requestID, messageError);
                        throw messageError;
                }
        }

        public override requestAttachmentDownload(requestID: number, attachmentGUID: string): boolean {
                this.downloadAttachment(requestID, attachmentGUID);
                return true;
        }

        public override requestRetrievalTime(_timeLower: Date, _timeUpper: Date): boolean {
                // Not supported via BlueBubbles REST API. Missed message retrieval is handled via polling.
                return false;
        }

        public override requestRetrievalID(_idLower: number, _timeLower: Date, _timeUpper: Date): boolean {
                return false;
        }

        public override requestChatCreation(requestID: number, members: string[], service: string): boolean {
                this.createChat(requestID, members, service).catch((error) => {
                        const message = error instanceof Error ? error.message : undefined;
                        this.listener?.onCreateChatResponse(requestID, CreateChatErrorCode.UnknownExternal, message);
                });
                return true;
        }

        public override requestInstallRemoteUpdate(_updateID: number): boolean {
                return false;
        }

        public override requestFaceTimeLink(): boolean {
                return false;
        }

        public override initiateFaceTimeCall(_addresses: string[]): boolean {
                return false;
        }

        public override handleIncomingFaceTimeCall(_caller: string, _accept: boolean): boolean {
                return false;
        }

        public override dropFaceTimeCallServer(): boolean {
                return false;
        }

        private async initialize() {
                this.isClosed = false;
                this.conversationGuidCache.clear();
                try {
                        this.metadata = await fetchServerMetadata(this.auth);
                        const features = this.metadata.features;
                        const privateApiFlag = features?.private_api ?? this.metadata.private_api;
                        const helperFlag = features?.helper_connected ?? this.metadata.helper_connected;
                        const reactionsFlag = features?.reactions ?? true;
                        const deliveredFlag = features?.delivered_receipts ?? true;
                        const readFlag = features?.read_receipts ?? deliveredFlag;

                        this.privateApiEnabled = Boolean(privateApiFlag && helperFlag && reactionsFlag);
                        this.supportsDeliveredReceipts = Boolean(privateApiFlag && helperFlag && deliveredFlag);
                        this.supportsReadReceipts = Boolean(privateApiFlag && helperFlag && readFlag);
                        const supportsFaceTime = false;
                        this.listener?.onOpen(
                                this.metadata.computer_id,
                                this.metadata.os_version,
                                this.metadata.server_version,
                                supportsFaceTime
                        );

                        await this.fetchLiteConversations();
                        this.startPolling();
                } catch(error) {
                        this.handleFatalError(error);
                }
        }

        private teardown() {
                this.isClosed = true;
                if(this.pollTimer) {
                        clearInterval(this.pollTimer);
                        this.pollTimer = undefined;
                }
        }

        private handleFatalError(error: unknown) {
                if(this.isClosed) return;
                console.warn("BlueBubbles connection failed", error);
                this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
                this.listener?.onClose(ConnectionErrorCode.ExternalError);
                this.teardown();
        }

        private startPolling() {
                this.pollTimer = setInterval(() => {
                        this.pollUpdates().catch((error) => console.warn("Failed to poll BlueBubbles updates", error));
                }, POLL_INTERVAL_MS);
        }

        private async pollUpdates() {
                const payload: Record<string, unknown> = {
                        sort: "DESC",
                        limit: DEFAULT_THREAD_PAGE_SIZE,
                        with: ["attachments", "chat"],
                        offset: 0
                };
                if(this.lastMessageTimestamp) {
                        payload.after = this.lastMessageTimestamp;
                }

                const response = await queryMessages(this.auth, payload);
                if(!response.data || response.data.length === 0) return;

                const sorted = response.data.sort((a, b) => a.dateCreated - b.dateCreated);
                this.lastMessageTimestamp = sorted[sorted.length - 1].dateCreated;
                const {items, modifiers} = this.processMessages(sorted);
                if(items.length > 0) {
                        const newestFirstItems = items.slice().reverse();
                        this.listener?.onMessageUpdate(newestFirstItems);
                }
                if(modifiers.length > 0) {
                        this.listener?.onModifierUpdate(modifiers);
                }
        }

        private async fetchLiteConversations() {
                const response: ChatQueryResponse = await fetchChats(this.auth);
                const conversations = response.data.map((chat) => this.convertChat(chat));
                this.listener?.onMessageConversations(conversations);
        }

        private async fetchConversationInfo(chatGUIDs: string[]) {
                const results: [string, Conversation | undefined][] = await Promise.all(chatGUIDs.map(async (guid) => {
                        try {
                                const response = await fetchChat(this.auth, guid);
                                return [guid, this.convertChat(response.data)];
                        } catch(error) {
                                console.warn(`Failed to fetch chat ${guid}`, error);
                                return [guid, undefined];
                        }
                }));
                this.listener?.onConversationUpdate(results);
        }

        private async fetchThread(chatGUID: string, firstMessageID?: number) {
                const payload: Record<string, unknown> = {
                        chatGuid: chatGUID,
                        sort: "DESC",
                        limit: DEFAULT_THREAD_PAGE_SIZE,
                        with: ["attachments"],
                        offset: 0
                };
                if(firstMessageID !== undefined) {
                        payload.where = [
                                {
                                        statement: "message.ROWID < :rowid",
                                        args: {rowid: firstMessageID}
                                }
                        ];
                }

                const response: MessageQueryResponse = await queryMessages(this.auth, payload);
                const ordered = response.data.slice().sort((a, b) => b.dateCreated - a.dateCreated);
                if(firstMessageID === undefined && ordered.length > 0) {
                        this.lastMessageTimestamp = ordered[0].dateCreated;
                }
                const {items, modifiers} = this.processMessages(ordered);
                this.listener?.onMessageThread(chatGUID, firstMessageID, items);
                if(modifiers.length > 0) {
                        this.listener?.onModifierUpdate(modifiers);
                }
        }

        private async performSendMessage(requestID: number, conversation: ConversationTarget, message: string) {
                const chatGuid = await this.resolveConversationTarget(conversation);
                const payload = {
                        chatGuid,
                        message,
                        tempGuid: generateTempGuid(requestID)
                };
                const response: MessageSendResponse = await sendTextMessage(this.auth, payload);
                const {items, modifiers} = this.processMessages([response.data]);
                if(items.length > 0) {
                        this.listener?.onMessageUpdate(items);
                }
                if(modifiers.length > 0) {
                        this.listener?.onModifierUpdate(modifiers);
                }
                this.listener?.onSendMessageResponse(requestID, undefined);
        }

        private async resolveConversationTarget(target: ConversationTarget): Promise<string> {
                if(target.type === "linked") return target.guid;
                const key = buildConversationKey(target.members, target.service);
                const guid = this.conversationGuidCache.get(key);
                if(guid) return guid;
                throw new Error("Cannot resolve unlinked conversation for BlueBubbles transport");
        }

        private async createChat(requestID: number, members: string[], service: string) {
                const body = {
                        addresses: members,
                        service,
                        method: "private-api"
                };
                const response = await createChatApi(this.auth, body);
                const conversation = this.convertChat(response.data);
                const key = buildConversationKey(conversation.members, conversation.service);
                this.conversationGuidCache.set(key, conversation.guid);
                this.listener?.onCreateChatResponse(requestID, undefined, conversation.guid);
                this.listener?.onConversationUpdate([[conversation.guid, conversation]]);
        }

        private processMessages(messages: MessageResponse[]): {items: ConversationItem[]; modifiers: TapbackItem[]} {
                const items: ConversationItem[] = [];
                const pendingReactions: PendingReaction[] = [];
                const modifiers: TapbackItem[] = [];
                for(const message of messages) {
                        if(this.privateApiEnabled && isReactionMessage(message)) {
                                const tapback = mapTapback(message);
                                if(tapback) {
                                        pendingReactions.push({messageGuid: message.associatedMessageGuid!, tapback});
                                        modifiers.push(tapback);
                                }
                                continue;
                        }

                        const item = this.convertMessage(message);
                        if(item) {
                                items.push(item);
                        }
                }

                if(pendingReactions.length > 0) {
                                for(const pending of pendingReactions) {
                                        const tapbacks = this.tapbackCache.get(pending.messageGuid) ?? [];
                                        const existingIndex = tapbacks.findIndex((tap) => tap.sender === pending.tapback.sender && tap.tapbackType === pending.tapback.tapbackType);
                                        if(pending.tapback.isAddition) {
                                                if(existingIndex === -1) tapbacks.push(pending.tapback);
                                                else tapbacks[existingIndex] = pending.tapback;
                                        } else if(existingIndex !== -1) {
                                                tapbacks.splice(existingIndex, 1);
                                        }
                                        this.tapbackCache.set(pending.messageGuid, tapbacks);
                                }

                                for(let index = 0; index < items.length; index++) {
                                        const item = items[index];
                                        if(item.itemType === ConversationItemType.Message && item.guid) {
                                                const tapbacks = this.tapbackCache.get(item.guid);
                                                if(tapbacks) {
                                                        const messageItem = item as MessageItem;
                                                        items[index] = {
                                                                ...messageItem,
                                                                tapbacks: tapbacks.slice()
                                                        };
                                                }
                                        }
                                }
                }

                return {items, modifiers};
        }

        private convertMessage(message: MessageResponse): ConversationItem | undefined {
                if(isGroupAction(message)) {
                        const actionType = mapParticipantActionType(message.groupActionType);
                        if(actionType === ParticipantActionType.Unknown) return undefined;
                        return {
                                itemType: ConversationItemType.ParticipantAction,
                                serverID: message.originalROWID,
                                guid: message.guid,
                                chatGuid: message.chats?.[0]?.guid,
                                date: new Date(message.dateCreated),
                                type: actionType,
                                user: message.groupTitle ?? message.handle?.address,
                                target: message.replyToGuid ?? undefined
                        };
                }

                if(isRenameAction(message)) {
                        return {
                                itemType: ConversationItemType.ChatRenameAction,
                                serverID: message.originalROWID,
                                guid: message.guid,
                                chatGuid: message.chats?.[0]?.guid,
                                date: new Date(message.dateCreated),
                                user: message.handle?.address ?? "",
                                chatName: message.groupTitle ?? ""
                        };
                }

                const attachments = (message.attachments ?? []).map(convertAttachment);
                const {status, statusDate} = computeMessageStatus(message, this.supportsDeliveredReceipts, this.supportsReadReceipts);
                const tapbacks = this.tapbackCache.get(message.guid) ?? [];
                const error = message.error !== 0 ? {code: MessageErrorCode.ServerExternal, detail: String(message.error)} : undefined;

                const item: MessageItem = {
                        itemType: ConversationItemType.Message,
                        serverID: message.originalROWID,
                        guid: message.guid,
                        chatGuid: message.chats?.[0]?.guid,
                        date: new Date(message.dateCreated),
                        text: message.text || undefined,
                        subject: message.subject || undefined,
                        sender: message.isFromMe ? undefined : message.handle?.address,
                        attachments,
                        stickers: [],
                        tapbacks: tapbacks.slice(),
                        sendStyle: message.expressiveSendStyleId || undefined,
                        status,
                        statusDate,
                        error,
                        progress: undefined
                };
                if(item.guid) {
                        this.tapbackCache.set(item.guid, tapbacks.slice());
                }
                return item;
        }

        private convertChat(chat: ChatResponse): LinkedConversation {
                const members = (chat.participants ?? []).map((handle) => handle.address).filter(Boolean);
                const preview: ConversationPreview = chat.lastMessage ? buildConversationPreview(chat.lastMessage) : {
                        type: ConversationPreviewType.ChatCreation,
                        date: new Date()
                };
                const conversation: LinkedConversation = {
                        localID: chat.originalROWID,
                        guid: chat.guid,
                        service: inferService(chat),
                        name: chat.displayName || undefined,
                        members,
                        preview,
                        unreadMessages: false,
                        localOnly: false
                };
                const key = buildConversationKey(conversation.members, conversation.service);
                this.conversationGuidCache.set(key, conversation.guid);
                return conversation;
        }

        private async downloadAttachment(requestID: number, attachmentGUID: string) {
                try {
                        const response = await downloadAttachment(this.auth, attachmentGUID);
                        const contentLength = Number(response.headers.get("content-length") ?? "0");
                        const accumulator: TransferAccumulator = new BasicAccumulator();
                        this.listener?.onFileRequestStart(requestID, undefined, response.headers.get("content-type") ?? undefined, contentLength, accumulator);

                        const reader = response.body?.getReader();
                        if(!reader) throw new Error("No attachment data available");

                        let received = 0;
                        while(true) {
                                const {done, value} = await reader.read();
                                if(done) break;
                                if(value) {
                                        received += value.length;
                                        const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
                                        accumulator.push(chunk);
                                        this.listener?.onFileRequestData(requestID, chunk);
                                }
                        }

                        this.listener?.onFileRequestComplete(requestID);
                } catch(error) {
                        console.warn("Failed to download attachment", error);
                        const code = error instanceof BlueBubblesApiError && error.status === 404
                                ? AttachmentRequestErrorCode.ServerNotFound
                                : AttachmentRequestErrorCode.ServerIO;
                        this.listener?.onFileRequestFail(requestID, code);
                }
        }
}

function generateTempGuid(requestID: number): string {
        return `web-${Date.now()}-${requestID}`;
}

function convertAttachment(attachment: AttachmentResponse) {
        return {
                guid: attachment.guid,
                name: attachment.transferName,
                type: attachment.mimeType,
                size: attachment.totalBytes
        };
}

function buildConversationPreview(message: MessageResponse): ConversationPreview {
        const attachments = (message.attachments ?? []).map((attachment) => attachment.transferName);
        return {
                type: ConversationPreviewType.Message,
                date: new Date(message.dateCreated),
                text: message.text || undefined,
                attachments,
                sendStyle: message.expressiveSendStyleId || undefined
        };
}

function isReactionMessage(message: MessageResponse): boolean {
        return !!message.associatedMessageGuid && !!message.associatedMessageType;
}

function mapTapback(message: MessageResponse): TapbackItem | undefined {
        const typeCode = parseInt(message.associatedMessageType ?? "", 10);
        if(Number.isNaN(typeCode)) return undefined;
        const isRemoval = typeCode >= TAPBACK_REMOVE_OFFSET;
        const normalized = isRemoval ? typeCode - TAPBACK_REMOVE_OFFSET : typeCode - TAPBACK_ADD_OFFSET;
        const tapbackType = mapTapbackType(normalized);
        if(tapbackType === undefined) return undefined;
        const sender = message.isFromMe ? "me" : message.handle?.address ?? "unknown";
        return {
                type: MessageModifierType.Tapback,
                messageGuid: message.associatedMessageGuid!,
                messageIndex: 0,
                sender,
                isAddition: !isRemoval,
                tapbackType
        } as TapbackItem;
}

function mapTapbackType(code: number) {
        switch(code) {
                case 0:
                        return TapbackType.Love;
                case 1:
                        return TapbackType.Like;
                case 2:
                        return TapbackType.Dislike;
                case 3:
                        return TapbackType.Laugh;
                case 4:
                        return TapbackType.Emphasis;
                case 5:
                        return TapbackType.Question;
                default:
                        return undefined;
        }
}

function mapParticipantActionType(code: number): ParticipantActionType {
        switch(code) {
                case 0:
                        return ParticipantActionType.Join;
                case 1:
                        return ParticipantActionType.Leave;
                default:
                        return ParticipantActionType.Unknown;
        }
}

function isGroupAction(message: MessageResponse): boolean {
        return message.itemType === 1 && message.groupActionType !== undefined && message.groupActionType !== null;
}

function isRenameAction(message: MessageResponse): boolean {
        return message.itemType === 2;
}

function computeMessageStatus(message: MessageResponse, supportsDeliveredReceipts: boolean, supportsReadReceipts: boolean) {
        if(!message.isFromMe) {
                return {status: MessageStatusCode.Read, statusDate: new Date(message.dateRead ?? message.dateCreated)};
        }
        if(!(supportsDeliveredReceipts || supportsReadReceipts)) {
                return {status: MessageStatusCode.Sent};
        }
        if(supportsReadReceipts && message.dateRead) {
                return {status: MessageStatusCode.Read, statusDate: new Date(message.dateRead)};
        }
        if(supportsDeliveredReceipts && message.dateDelivered) {
                return {status: MessageStatusCode.Delivered, statusDate: new Date(message.dateDelivered)};
        }
        if(supportsDeliveredReceipts && message.isDelivered) {
                return {status: MessageStatusCode.Delivered};
        }
        return supportsDeliveredReceipts ? {status: MessageStatusCode.Delivered} : {status: MessageStatusCode.Sent};
}

function inferService(chat: ChatResponse): string {
        if(chat.participants && chat.participants.length > 0) {
                return chat.participants[0].service || "iMessage";
        }
        return "iMessage";
}

function buildConversationKey(members: string[], service: string): string {
        return `${service}:${members.slice().map((member) => member.toLowerCase()).sort().join(",")}`;
}

async function uploadAttachmentWithProgress(auth: BlueBubblesAuthState, payload: FormData, progressCallback: (bytesUploaded: number) => void): Promise<AttachmentSendResponse> {
        const path = appendLegacyAuthParams(auth, "/api/v1/message/attachment");
        const url = auth.serverUrl.replace(/\/$/, "") + path;
        return new Promise<AttachmentSendResponse>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.responseType = "json";
                xhr.upload.addEventListener("progress", (event) => {
                        if(event.lengthComputable) {
                                progressCallback(event.loaded);
                        }
                });
                xhr.addEventListener("error", () => reject(new Error("Upload failed")));
                xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
                xhr.addEventListener("load", () => {
                        if(xhr.status >= 200 && xhr.status < 300) {
                                let responseBody: AttachmentSendResponse | null = null;
                                if(xhr.response) {
                                        responseBody = xhr.response as AttachmentSendResponse;
                                } else if(xhr.responseText) {
                                        try {
                                                responseBody = JSON.parse(xhr.responseText) as AttachmentSendResponse;
                                        } catch {
                                                responseBody = null;
                                        }
                                }
                                if(responseBody) {
                                        resolve(responseBody);
                                        return;
                                }
                                reject(new Error("Invalid response from server"));
                                return;
                        } else {
                                const message = typeof xhr.response === "object" && xhr.response !== null && "message" in xhr.response
                                        ? String((xhr.response as Record<string, unknown>).message)
                                        : `Upload failed with status ${xhr.status}`;
                                reject(new Error(message));
                        }
                });
                xhr.open("POST", url, true);
                xhr.setRequestHeader("Authorization", `Bearer ${auth.accessToken}`);
                xhr.send(payload);
        });
}

function mapMessageError(error: unknown): MessageError {
        if(error && typeof error === "object" && "code" in (error as any)) {
                return error as MessageError;
        }
        return {code: MessageErrorCode.ServerExternal, detail: error instanceof Error ? error.message : String(error)};
}
