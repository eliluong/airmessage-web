import CommunicationsManager, {
        ConversationMediaFetchResult,
        ThreadFetchMetadata,
        ThreadFetchOptions,
        normalizeThreadFetchOptions
} from "../communicationsManager";
import DataProxy from "../dataProxy";
import {Conversation, ConversationItem, ConversationPreview, LinkedConversation, MessageItem, TapbackItem} from "../../data/blocks";
import {extractConversationAttachments} from "../../data/attachment";
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
import {MessageSearchHydratedResult, MessageSearchOptions} from "../messageSearch";
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
        downloadAttachmentThumbnail,
        fetchChat,
        fetchChats,
        fetchServerMetadata,
        pingServer,
        queryMessages,
        sendTextMessage
} from "./api";
import {logBlueBubblesDebug} from "./debugLogging";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_THREAD_PAGE_SIZE = 50;
const TAPBACK_ADD_OFFSET = 2000;
const TAPBACK_REMOVE_OFFSET = 3000;
const SMS_TAPBACK_CACHE_LIMIT = 50;

const SQLITE_LIKE_SPECIAL_CHARS = /[%_\[]/g;

/**
 * Converts a JavaScript date into the seconds-since-epoch timestamp format
 * expected by the BlueBubbles REST API. The value is truncated to a whole
 * second to match the server-side filtering behavior.
 */
function toBlueBubblesTimestamp(date: Date): number {
        return Math.floor(date.getTime() / 1000);
}

/**
 * Escapes user-provided text for a SQLite LIKE query that looks for substring matches.
 *
 * SQLite doesn't reliably honor `ESCAPE` when queries are parameterized, so we translate the
 * wildcard characters into bracket expressions instead. This allows literal matches for "%",
 * "_", and "[" characters while still surrounding the value with "%" wildcards to perform a
 * contains search. Characters outside of this set keep their default behavior.
 */
function buildSqliteLikeContainsPattern(value: string): string {
        const escapedValue = value.replace(SQLITE_LIKE_SPECIAL_CHARS, (match) => {
                switch(match) {
                        case "%":
                                return "[%]";
                        case "_":
                                return "[_]";
                        case "[":
                                return "[[]";
                        default:
                                return match;
                }
        });
        return `%${escapedValue}%`;
}

interface PendingReaction {
        messageGuid: string;
        tapback: TapbackItem;
}

interface SmsTapbackCacheRecord {
        normalizedText: string;
        guid: string;
}

interface SmsTapbackCacheEntry {
        map: Map<string, string[]>;
        order: SmsTapbackCacheRecord[];
}

export default class BlueBubblesCommunicationsManager extends CommunicationsManager {
        private readonly auth: BlueBubblesAuthState;
        private metadata: ServerMetadataResponse | undefined;
        private pollTimer: ReturnType<typeof setInterval> | undefined;
        private hasStartedPolling = false;
        private isClosed = false;
        private lastMessageTimestamp: number | undefined;
        private readonly tapbackCache = new Map<string, TapbackItem[]>();
        private readonly smsTapbackCache = new Map<string, SmsTapbackCacheEntry>();
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

        public override requestLiteConversations(limit?: number): boolean {
                this.fetchLiteConversations(limit);
                return true;
        }

        public override requestConversationInfo(chatGUIDs: string[]): boolean {
                this.fetchConversationInfo(chatGUIDs);
                return true;
        }

        public override requestLiteThread(chatGUID: string, options?: ThreadFetchOptions): boolean {
                this.fetchThread(chatGUID, options);
                return true;
        }

        public async fetchConversationMedia(chatGUID: string, options?: ThreadFetchOptions): Promise<ConversationMediaFetchResult> {
                const normalizedOptions = normalizeThreadFetchOptions(options);
                const payload: Record<string, unknown> = {
                        chatGuid: chatGUID,
                        sort: "DESC",
                        limit: DEFAULT_THREAD_PAGE_SIZE,
                        with: ["attachments"],
                        offset: 0
                };

                const where: {statement: string; args?: Record<string, unknown>}[] = [
                        {
                                statement: "attachment.mimeType LIKE :mimeType",
                                args: {mimeType: "image/%"}
                        }
                ];

                if(normalizedOptions?.limit !== undefined) {
                        payload.limit = Math.max(1, Math.floor(normalizedOptions.limit));
                }

                const anchorMessageID = normalizedOptions?.anchorMessageID;
                const direction = normalizedOptions?.direction ?? (anchorMessageID !== undefined ? "before" : "latest");

                if(direction === "after") {
                        payload.sort = "ASC";
                }

                if(anchorMessageID !== undefined) {
                        where.push({
                                statement: direction === "after" ? "message.ROWID > :rowid" : "message.ROWID < :rowid",
                                args: {rowid: anchorMessageID}
                        });
                }

                payload.where = where;

                const response = await queryMessages(this.auth, payload);
                const ordered = (response.data ?? []).slice().sort((a, b) => b.dateCreated - a.dateCreated);
                const {items} = this.processMessages(ordered);
                const attachments = extractConversationAttachments(items);
                const metadata = this.buildThreadMetadata(items);
                return {items: attachments, metadata};
        }

        public async fetchAttachmentThumbnail(attachmentGUID: string, signal?: AbortSignal): Promise<Blob> {
                const response = await downloadAttachmentThumbnail(this.auth, attachmentGUID, {signal});
                return response.blob();
        }

        public async searchMessages(options: MessageSearchOptions): Promise<MessageSearchHydratedResult> {
                const term = options.term.trim();
                if(term.length === 0) {
                        return {items: [], metadata: undefined};
                }

                const payload: Record<string, unknown> = {
                        sort: "DESC",
                        with: ["chat", "handle", "attachments"]
                };
                if(options.limit !== undefined) {
                        payload.limit = Math.max(1, Math.floor(options.limit));
                }
                if(options.offset !== undefined) {
                        payload.offset = Math.max(0, Math.floor(options.offset));
                }

                const where: {statement: string; args?: Record<string, unknown>}[] = [];
                const likeTerm = buildSqliteLikeContainsPattern(term);
                where.push({
                        statement: "message.text LIKE :term",
                        args: {term: likeTerm}
                });

                if(options.startDate) {
                        payload.after = toBlueBubblesTimestamp(options.startDate);
                }
                if(options.endDate) {
                        payload.before = toBlueBubblesTimestamp(options.endDate);
                }

                if(options.chatGuids && options.chatGuids.length > 0) {
                        const args: Record<string, string> = {};
                        const placeholders = options.chatGuids.map((guid, index) => {
                                const key = `chat${index}`;
                                args[key] = guid;
                                return `:${key}`;
                        });
                        where.push({
                                statement: `chat.guid IN (${placeholders.join(", ")})`,
                                args
                        });
                }

                if(options.handleGuids && options.handleGuids.length > 0) {
                        const args: Record<string, string> = {};
                        const placeholders = options.handleGuids.map((guid, index) => {
                                const key = `handle${index}`;
                                args[key] = guid;
                                return `:${key}`;
                        });
                        where.push({
                                statement: `handle.guid IN (${placeholders.join(", ")})`,
                                args
                        });
                }

                if(where.length > 0) {
                        payload.where = where;
                }

                const response = await queryMessages(this.auth, payload);
                const {items} = this.processMessages(response.data ?? []);
                return {items, metadata: response.metadata};
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
                this.hasStartedPolling = false;
                this.conversationGuidCache.clear();
                this.clearSmsTapbackCache();
                this.lastMessageTimestamp = undefined;
                try {
                        this.metadata = await fetchServerMetadata(this.auth);
                        const features = this.metadata.features;
                        const privateApiFlag = features?.private_api ?? this.metadata.private_api;
                        const helperFlag = features?.helper_connected ?? this.metadata.helper_connected;
                        const reactionsFlag = features?.reactions ?? true;
                        const deliveredFlag = features?.delivered_receipts ?? true;
                        const readFlag = features?.read_receipts ?? deliveredFlag;

                        const reactionsEnabled = Boolean(reactionsFlag);
                        if(!reactionsEnabled) {
                                this.tapbackCache.clear();
                                this.clearSmsTapbackCache();
                        }
                        this.supportsDeliveredReceipts = Boolean(privateApiFlag && helperFlag && deliveredFlag);
                        this.supportsReadReceipts = Boolean(privateApiFlag && helperFlag && readFlag);
                        const supportsFaceTime = false;
                        this.listener?.onOpen(
                                this.metadata.computer_id,
                                this.metadata.os_version,
                                this.metadata.server_version,
                                supportsFaceTime
                        );
                } catch(error) {
                        this.handleFatalError(error);
                }
        }

        private teardown() {
                this.isClosed = true;
                this.hasStartedPolling = false;
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
                if(this.pollTimer) return;
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
                if(this.lastMessageTimestamp !== undefined) {
                        payload.after = this.lastMessageTimestamp;
                }

                const response = await queryMessages(this.auth, payload);
                if(!response.data || response.data.length === 0) return;

                const sorted = response.data.sort((a, b) => a.dateCreated - b.dateCreated);
                const latestTimestamp = sorted[sorted.length - 1].dateCreated;
                this.lastMessageTimestamp = Math.max(this.lastMessageTimestamp ?? latestTimestamp, latestTimestamp);
                const {items, modifiers} = this.processMessages(sorted);
                if(items.length > 0) {
                        const newestFirstItems = items.slice().reverse();
                        this.listener?.onMessageUpdate(newestFirstItems);
                }
                if(modifiers.length > 0) {
                        this.listener?.onModifierUpdate(modifiers);
                }
        }

        private async fetchLiteConversations(limit?: number) {
                const requestLimit = limit !== undefined ? Math.max(1, limit) : undefined;
                const response: ChatQueryResponse = await fetchChats(this.auth, {limit: requestLimit});
                const conversations = response.data.map((chat) => this.convertChat(chat));
                this.listener?.onMessageConversations(conversations);
                this.ensurePollingStarted();
        }

        private ensurePollingStarted() {
                if(this.hasStartedPolling) return;
                this.hasStartedPolling = true;
                this.startPolling();
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

        private async fetchThread(chatGUID: string, options?: ThreadFetchOptions) {
                const normalizedOptions = normalizeThreadFetchOptions(options);
                const payload: Record<string, unknown> = {
                        chatGuid: chatGUID,
                        sort: "DESC",
                        limit: DEFAULT_THREAD_PAGE_SIZE,
                        with: ["attachments"],
                        offset: 0
                };

                if(normalizedOptions?.limit !== undefined) {
                        const clampedLimit = Math.max(1, Math.floor(normalizedOptions.limit));
                        payload.limit = clampedLimit;
                }

                const anchorMessageID = normalizedOptions?.anchorMessageID;
                const direction = normalizedOptions?.direction
                        ?? (anchorMessageID !== undefined ? "before" : "latest");

                if(direction === "after") {
                        payload.sort = "ASC";
                }

                if(anchorMessageID !== undefined) {
                        if(direction === "after") {
                                payload.where = [
                                        {
                                                statement: "message.ROWID > :rowid",
                                                args: {rowid: anchorMessageID}
                                        }
                                ];
                        } else {
                                payload.where = [
                                        {
                                                statement: "message.ROWID < :rowid",
                                                args: {rowid: anchorMessageID}
                                        }
                                ];
                        }
                }

                const response: MessageQueryResponse = await queryMessages(this.auth, payload);
                const ordered = response.data.slice().sort((a, b) => b.dateCreated - a.dateCreated);
                if(direction === "latest" && ordered.length > 0) {
                        const newestTimestamp = ordered[0].dateCreated;
                        if(this.lastMessageTimestamp === undefined || newestTimestamp > this.lastMessageTimestamp) {
                                this.lastMessageTimestamp = newestTimestamp;
                        }
                }
                const processed = this.processMessages(ordered);
                const metadata = this.buildThreadMetadata(processed.items);
                this.listener?.onMessageThread(chatGUID, normalizedOptions, processed.items, metadata);
                // Historical thread fetches already include tapbacks on each message item, so do not forward
                // the modifier events (`processed.modifiers`) for this batch. Emitting them would cause the UI
                // to treat historical reactions as newly-arrived ones (triggering tapback sounds, etc.).
        }

        private buildThreadMetadata(items: ConversationItem[]): ThreadFetchMetadata | undefined {
                let oldest: number | undefined;
                let newest: number | undefined;
                for(const item of items) {
                        if(item.itemType !== ConversationItemType.Message) continue;
                        const message = item as MessageItem;
                        if(message.serverID === undefined) continue;
                        if(oldest === undefined || message.serverID < oldest) oldest = message.serverID;
                        if(newest === undefined || message.serverID > newest) newest = message.serverID;
                }

                if(oldest === undefined && newest === undefined) return undefined;
                return {oldestServerID: oldest, newestServerID: newest};
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
                        const service = getMessageService(message);
                        logBlueBubblesDebug("Message", {
                                guid: message.guid,
                                text: message.text,
                                associatedMessageGuid: message.associatedMessageGuid,
                                associatedMessageType: message.associatedMessageType,
                                itemType: message.itemType,
                                isFromMe: message.isFromMe,
                                isDelivered: message.isDelivered,
                                service,
                                dateDelivered: message.dateDelivered,
                                dateRead: message.dateRead,
                                dateEdited: message.dateEdited,
                                dateRetracted: message.dateRetracted
                        });
                        const smsTapback = !message.associatedMessageGuid && isSmsService(service)
                                ? parseSmsTapback(message)
                                : undefined;
                        if(smsTapback) {
                                const targetGuid = this.resolveSmsTapbackTargetGuid(message, smsTapback, messages);
                                if(targetGuid) {
                                        const tapback: TapbackItem = {
                                                type: MessageModifierType.Tapback,
                                                messageGuid: targetGuid,
                                                messageIndex: 0,
                                                sender: message.isFromMe ? "me" : message.handle?.address ?? "unknown",
                                                isAddition: smsTapback.isAddition,
                                                tapbackType: smsTapback.tapbackType
                                        } as TapbackItem;
                                        pendingReactions.push({messageGuid: targetGuid, tapback});
                                        modifiers.push(tapback);
                                        continue;
                                }
                                console.warn("[BlueBubbles] Unable to resolve SMS tapback target", {
                                        guid: message.guid,
                                        chatGuid: message.chats?.[0]?.guid,
                                        targetText: smsTapback.targetText
                                });
                        }
                        if(isReactionMessage(message)) {
                                const tapback = mapTapback(message);
                                if(tapback) {
                                        logBlueBubblesDebug("Tapback", {
                                                messageGuid: message.guid,
                                                associatedMessageGuid: message.associatedMessageGuid,
                                                tapbackType: tapback.tapbackType,
                                                isAddition: tapback.isAddition,
                                                sender: tapback.sender
                                        });
                                        pendingReactions.push({messageGuid: tapback.messageGuid, tapback});
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
                const service = getMessageService(message);
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

                const canonicalGuid = normalizeMessageGuid(message.guid) ?? message.guid;
                const attachments = (message.attachments ?? [])
                        .filter((attachment) => !attachment.hideAttachment)
                        .map(convertAttachment);
                const {status, statusDate} = computeMessageStatus(message, this.supportsDeliveredReceipts, this.supportsReadReceipts);
                const tapbacks = canonicalGuid ? (this.tapbackCache.get(canonicalGuid) ?? this.tapbackCache.get(message.guid) ?? []) : [];
                const error = message.error !== 0 ? {code: MessageErrorCode.ServerExternal, detail: String(message.error)} : undefined;

                const item: MessageItem = {
                        itemType: ConversationItemType.Message,
                        serverID: message.originalROWID,
                        guid: canonicalGuid ?? message.guid,
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
                        const tapbackSnapshot = tapbacks.slice();
                        this.tapbackCache.set(item.guid, tapbackSnapshot);
                        if(message.guid && message.guid !== item.guid) {
                                this.tapbackCache.set(message.guid, tapbackSnapshot);
                        }
                        if(isSmsService(service) && item.chatGuid && item.text) {
                                this.rememberSmsTapbackTarget(item.chatGuid, item.text, item.guid);
                        }
                }
                return item;
        }

        private resolveSmsTapbackTargetGuid(message: MessageResponse, tapback: ParsedSmsTapback, batch: MessageResponse[]): string | undefined {
                const chatGuid = message.chats?.[0]?.guid;
                if(!chatGuid) return undefined;

                const normalizedTargets = tapback.normalizedTargets.filter((value) => value.length > 0);
                if(normalizedTargets.length === 0) return undefined;

                let bestGuid: string | undefined;
                let bestDate = -Infinity;

                for(const candidate of batch) {
                        if(candidate.guid === message.guid) continue;
                        if(candidate.chats?.[0]?.guid !== chatGuid) continue;
                        const candidateGuid = normalizeMessageGuid(candidate.guid) ?? candidate.guid;
                        if(!candidateGuid) continue;
                        if(!candidate.text) continue;
                        const candidateNormalizedText = normalizeTapbackTargetText(candidate.text);
                        if(candidateNormalizedText.length === 0) continue;

                        let matches = false;
                        for(const normalizedTarget of normalizedTargets) {
                                if(matchesSmsTapbackTarget(candidateNormalizedText, normalizedTarget)) {
                                        matches = true;
                                        break;
                                }
                        }
                        if(!matches) continue;

                        const candidateDate = candidate.dateCreated ?? 0;
                        if(candidateDate >= bestDate) {
                                bestGuid = candidateGuid;
                                bestDate = candidateDate;
                        }
                }

                if(bestGuid) return bestGuid;
                for(const normalized of normalizedTargets) {
                        const cached = this.lookupSmsTapbackTarget(chatGuid, normalized);
                        if(cached) return cached;
                }
                return undefined;
        }

        private lookupSmsTapbackTarget(chatGuid: string, normalizedText: string): string | undefined {
                const entry = this.smsTapbackCache.get(chatGuid);
                if(!entry) return undefined;
                const guids = entry.map.get(normalizedText);
                if(guids && guids.length > 0) return guids[guids.length - 1];

                const prefix = getSmsTapbackEllipsisPrefix(normalizedText);
                if(prefix === undefined) return undefined;

                for(let index = entry.order.length - 1; index >= 0; index -= 1) {
                        const record = entry.order[index];
                        if(matchesSmsTapbackTarget(record.normalizedText, normalizedText)) {
                                return record.guid;
                        }
                }

                return undefined;
        }

        private rememberSmsTapbackTarget(chatGuid: string, text: string, messageGuid: string) {
                const normalizedText = normalizeTapbackTargetText(text);
                if(normalizedText.length === 0) return;

                let entry = this.smsTapbackCache.get(chatGuid);
                if(!entry) {
                        entry = {map: new Map<string, string[]>(), order: []};
                        this.smsTapbackCache.set(chatGuid, entry);
                }

                let guids = entry.map.get(normalizedText);
                if(!guids) {
                        guids = [];
                        entry.map.set(normalizedText, guids);
                }
                guids.push(messageGuid);
                entry.order.push({normalizedText, guid: messageGuid});

                while(entry.order.length > SMS_TAPBACK_CACHE_LIMIT) {
                        const oldest = entry.order.shift();
                        if(!oldest) break;
                        const stored = entry.map.get(oldest.normalizedText);
                        if(!stored) continue;
                        const index = stored.indexOf(oldest.guid);
                        if(index !== -1) stored.splice(index, 1);
                        if(stored.length === 0) entry.map.delete(oldest.normalizedText);
                }
        }

        private clearSmsTapbackCache() {
                this.smsTapbackCache.clear();
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
                size: attachment.totalBytes,
                blurhash: attachment.blurhash
        };
}

function buildConversationPreview(message: MessageResponse): ConversationPreview {
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

function isReactionMessage(message: MessageResponse): boolean {
        return !!message.associatedMessageGuid && !!message.associatedMessageType;
}

interface NormalizedTapbackIdentifier {
        code: number;
        isRemoval: boolean;
}

interface ParsedSmsTapback {
        tapbackType: TapbackType;
        isAddition: boolean;
        targetText: string;
        normalizedTargets: string[];
}

const TAPBACK_STRING_CODE_MAP: Record<string, number> = {
        love: 0,
        heart: 0,
        like: 1,
        thumbsup: 1,
        dislike: 2,
        thumbsdown: 2,
        laugh: 3,
        haha: 3,
        emphasize: 4,
        emphasis: 4,
        exclamation: 4,
        question: 5,
        questionmark: 5
};

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const VARIATION_SELECTOR_REGEX = /[\uFE0E\uFE0F]/g;
const EMOJI_MODIFIER_REGEX = /[\u{1F3FB}-\u{1F3FF}]/gu;
const SMS_TAPBACK_QUOTE_REGEX = /^(.*?)[“"”'’]([\s\S]*)[”"'’]$/;
const NON_ALPHANUMERIC_WITH_OPTIONAL_SUFFIX_REGEX = /^[^a-z0-9]+(?:\s+(?:to|at))?$/u;

const SMS_TAPBACK_PREFIX_MAP: Record<string, {tapbackType: TapbackType; isAddition: boolean}> = {
        loved: {tapbackType: TapbackType.Love, isAddition: true},
        love: {tapbackType: TapbackType.Love, isAddition: true},
        "❤": {tapbackType: TapbackType.Love, isAddition: true},
        liked: {tapbackType: TapbackType.Like, isAddition: true},
        like: {tapbackType: TapbackType.Like, isAddition: true},
        "👍": {tapbackType: TapbackType.Like, isAddition: true},
        disliked: {tapbackType: TapbackType.Dislike, isAddition: true},
        dislike: {tapbackType: TapbackType.Dislike, isAddition: true},
        "👎": {tapbackType: TapbackType.Dislike, isAddition: true},
        "laughed at": {tapbackType: TapbackType.Laugh, isAddition: true},
        laughed: {tapbackType: TapbackType.Laugh, isAddition: true},
        "😂": {tapbackType: TapbackType.Laugh, isAddition: true},
        emphasized: {tapbackType: TapbackType.Emphasis, isAddition: true},
        emphasised: {tapbackType: TapbackType.Emphasis, isAddition: true},
        "‼": {tapbackType: TapbackType.Emphasis, isAddition: true},
        questioned: {tapbackType: TapbackType.Question, isAddition: true},
        question: {tapbackType: TapbackType.Question, isAddition: true},
        "?": {tapbackType: TapbackType.Question, isAddition: true},
        "❓": {tapbackType: TapbackType.Question, isAddition: true},
        "removed a heart from": {tapbackType: TapbackType.Love, isAddition: false},
        "removed heart from": {tapbackType: TapbackType.Love, isAddition: false},
        "removed a ❤ from": {tapbackType: TapbackType.Love, isAddition: false},
        "removed ❤ from": {tapbackType: TapbackType.Love, isAddition: false},
        "removed a like from": {tapbackType: TapbackType.Like, isAddition: false},
        "removed like from": {tapbackType: TapbackType.Like, isAddition: false},
        "removed a thumbs up from": {tapbackType: TapbackType.Like, isAddition: false},
        "removed thumbs up from": {tapbackType: TapbackType.Like, isAddition: false},
        "removed a 👍 from": {tapbackType: TapbackType.Like, isAddition: false},
        "removed 👍 from": {tapbackType: TapbackType.Like, isAddition: false},
        "removed a dislike from": {tapbackType: TapbackType.Dislike, isAddition: false},
        "removed dislike from": {tapbackType: TapbackType.Dislike, isAddition: false},
        "removed a thumbs down from": {tapbackType: TapbackType.Dislike, isAddition: false},
        "removed thumbs down from": {tapbackType: TapbackType.Dislike, isAddition: false},
        "removed a 👎 from": {tapbackType: TapbackType.Dislike, isAddition: false},
        "removed 👎 from": {tapbackType: TapbackType.Dislike, isAddition: false},
        "removed a laugh from": {tapbackType: TapbackType.Laugh, isAddition: false},
        "removed laugh from": {tapbackType: TapbackType.Laugh, isAddition: false},
        "removed 😂 from": {tapbackType: TapbackType.Laugh, isAddition: false},
        "removed an exclamation mark from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed exclamation mark from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed an exclamation point from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed exclamation point from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed an exclamation from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed exclamation from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed an emphasis from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed emphasis from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed ‼ from": {tapbackType: TapbackType.Emphasis, isAddition: false},
        "removed a question mark from": {tapbackType: TapbackType.Question, isAddition: false},
        "removed question mark from": {tapbackType: TapbackType.Question, isAddition: false},
        "removed a question from": {tapbackType: TapbackType.Question, isAddition: false},
        "removed question from": {tapbackType: TapbackType.Question, isAddition: false},
        "removed ❓ from": {tapbackType: TapbackType.Question, isAddition: false}
};

const SMS_TAPBACK_TARGET_WRAPPERS: Partial<Record<TapbackType, string[]>> = {
        [TapbackType.Love]: ["❤", "♥"],
        [TapbackType.Like]: ["👍"],
        [TapbackType.Dislike]: ["👎"],
        [TapbackType.Laugh]: ["😂", "🤣"],
        [TapbackType.Emphasis]: ["‼", "❗", "!"],
        [TapbackType.Question]: ["?", "❓", "❔"]
};

function parseSmsTapback(message: MessageResponse): ParsedSmsTapback | undefined {
        const text = message.text;
        if(!text) return undefined;

        const sanitized = stripInvisibleSelectors(text).trim();
        if(sanitized.length === 0) return undefined;

        const match = sanitized.match(SMS_TAPBACK_QUOTE_REGEX);
        if(!match) return undefined;

        const rawPrefix = match[1].trim();
        const rawTarget = match[2].trim();
        if(rawPrefix.length === 0 || rawTarget.length === 0) return undefined;

        const normalizedPrefix = normalizeSmsTapbackPrefix(rawPrefix);
        const mapping = SMS_TAPBACK_PREFIX_MAP[normalizedPrefix];
        if(!mapping) return undefined;

        const targetText = stripInvisibleSelectors(rawTarget).trim();
        if(targetText.length === 0) return undefined;

        const normalizedBase = normalizeTapbackTargetText(targetText);
        if(normalizedBase.length === 0) return undefined;

        const normalizedTargets = buildSmsTapbackTargetVariants(normalizedBase, mapping.tapbackType);
        if(normalizedTargets.length === 0) return undefined;

        return {
                tapbackType: mapping.tapbackType,
                isAddition: mapping.isAddition,
                targetText,
                normalizedTargets
        };
}

function normalizeTapbackTargetText(text: string): string {
        return stripInvisibleSelectors(text).trim();
}

function normalizeSmsTapbackPrefix(prefix: string): string {
        const stripped = stripInvisibleSelectors(prefix);
        const withoutModifiers = removeEmojiModifiers(stripped);
        let normalized = withoutModifiers.replace(/\s+/g, " ").trim().toLowerCase();
        if(normalized.length === 0) return normalized;

        if(NON_ALPHANUMERIC_WITH_OPTIONAL_SUFFIX_REGEX.test(normalized)) {
                normalized = normalized.replace(/\s+(?:to|at)$/u, "");
        }

        if(/^[^a-z0-9]+$/u.test(normalized)) {
                normalized = collapseRepeatedSymbols(normalized);
        }

        return normalized;
}

function stripInvisibleSelectors(text: string): string {
        return text.replace(ZERO_WIDTH_REGEX, "").replace(VARIATION_SELECTOR_REGEX, "");
}

function removeEmojiModifiers(text: string): string {
        return text.replace(EMOJI_MODIFIER_REGEX, "");
}

function collapseRepeatedSymbols(text: string): string {
        const chars = Array.from(text);
        if(chars.length === 0) return text;
        const first = chars[0];
        if(chars.every((char) => char === first)) {
                return first;
        }
        return text;
}

function buildSmsTapbackTargetVariants(base: string, tapbackType: TapbackType): string[] {
        const variants = new Set<string>();
        if(base.length > 0) {
                variants.add(base);
                addSmsTapbackEllipsisVariants(base, variants);
        }
        const stripped = stripTapbackTargetWrappers(base, tapbackType);
        if(stripped.length > 0) {
                variants.add(stripped);
                addSmsTapbackEllipsisVariants(stripped, variants);
        }
        return Array.from(variants);
}

function addSmsTapbackEllipsisVariants(text: string, variants: Set<string>) {
        const prefix = getSmsTapbackEllipsisPrefix(text);
        if(prefix && prefix.length > 0) {
                variants.add(prefix);
        }
}

function stripTapbackTargetWrappers(text: string, tapbackType: TapbackType): string {
        const wrappers = SMS_TAPBACK_TARGET_WRAPPERS[tapbackType];
        if(!wrappers || wrappers.length === 0) return text;

        let result = text;
        let changed = false;
        do {
                changed = false;
                for(const wrapper of wrappers) {
                        if(result.length < wrapper.length * 2) continue;
                        if(result.startsWith(wrapper) && result.endsWith(wrapper)) {
                                result = result.slice(wrapper.length, result.length - wrapper.length).trim();
                                changed = true;
                        }
                }
        } while(changed);

        return result;
}

function matchesSmsTapbackTarget(candidate: string, target: string): boolean {
        if(candidate === target) return true;
        const prefix = getSmsTapbackEllipsisPrefix(target);
        if(!prefix) return false;
        return candidate.startsWith(prefix);
}

function getSmsTapbackEllipsisPrefix(text: string): string | undefined {
        const trimmed = text.trimEnd();
        if(trimmed.endsWith("…")) {
                const prefix = trimmed.slice(0, -1).trimEnd();
                return prefix.length > 0 ? prefix : undefined;
        }
        if(trimmed.endsWith("...")) {
                const prefix = trimmed.slice(0, -3).trimEnd();
                return prefix.length > 0 ? prefix : undefined;
        }
        return undefined;
}

function getMessageService(message: MessageResponse): string | undefined {
        const handleService = message.handle?.service?.trim();
        if(handleService) return handleService;

        const participants = message.chats?.[0]?.participants;
        if(participants) {
                for(const participant of participants) {
                        const participantService = participant.service?.trim();
                        if(participantService) return participantService;
                }
        }

        return undefined;
}

function isSmsService(service: string | undefined): boolean {
        if(!service) return false;
        const normalized = service.trim().toLowerCase();
        return normalized === "sms" || normalized === "mms" || normalized === "sms/mms";
}

function mapTapback(message: MessageResponse): TapbackItem | undefined {
        const rawType = message.associatedMessageType ?? "";
        const normalized = normalizeTapbackIdentifier(rawType);
        if(!normalized) {
                console.warn("[BlueBubbles] Unknown tapback identifier", {
                        identifier: rawType,
                        guid: message.guid,
                        associatedMessageGuid: message.associatedMessageGuid
                });
                return undefined;
        }
        const tapbackType = mapTapbackType(normalized.code);
        if(tapbackType === undefined) {
                console.warn("[BlueBubbles] Unsupported tapback code", {
                        identifier: rawType,
                        code: normalized.code,
                        guid: message.guid,
                        associatedMessageGuid: message.associatedMessageGuid
                });
                return undefined;
        }
        const normalizedGuid = normalizeMessageGuid(message.associatedMessageGuid);
        if(!normalizedGuid) {
                console.warn("[BlueBubbles] Tapback missing associated message GUID", {
                        guid: message.guid,
                        associatedMessageGuid: message.associatedMessageGuid
                });
                return undefined;
        }
        const sender = message.isFromMe ? "me" : message.handle?.address ?? "unknown";
        return {
                type: MessageModifierType.Tapback,
                messageGuid: normalizedGuid,
                messageIndex: 0,
                sender,
                isAddition: !normalized.isRemoval,
                tapbackType
        } as TapbackItem;
}

function normalizeTapbackIdentifier(rawType: string): NormalizedTapbackIdentifier | undefined {
        const trimmed = rawType.trim();
        if(trimmed.length === 0) return undefined;

        const numeric = Number.parseInt(trimmed, 10);
        if(!Number.isNaN(numeric)) {
                const isRemoval = numeric >= TAPBACK_REMOVE_OFFSET;
                const normalized = isRemoval ? numeric - TAPBACK_REMOVE_OFFSET : numeric - TAPBACK_ADD_OFFSET;
                return {code: normalized, isRemoval};
        }

        let candidate = trimmed.toLowerCase();
        candidate = candidate.replace(/^com\.apple\.messages\.tapback\./, "");
        candidate = candidate.replace(/^tapback[-:_]?/, "");

        let isRemoval = false;
        if(candidate.startsWith("-")) {
                isRemoval = true;
                candidate = candidate.slice(1);
        }
        if(candidate.startsWith("remove-")) {
                isRemoval = true;
                candidate = candidate.slice("remove-".length);
        }
        if(candidate.endsWith("-remove")) {
                isRemoval = true;
                candidate = candidate.slice(0, -"-remove".length);
        }

        const collapsed = candidate.replace(/[^a-z]/g, "");
        const mapped = TAPBACK_STRING_CODE_MAP[collapsed];
        if(mapped === undefined) return undefined;
        return {code: mapped, isRemoval};
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

export const __testables = {
        mapTapback,
        normalizeTapbackIdentifier,
        normalizeMessageGuid,
        computeMessageStatus
};

function normalizeMessageGuid(guid: string | null | undefined): string | undefined {
        if(!guid) return undefined;
        const trimmed = guid.trim();
        if(trimmed.length === 0) return undefined;

        const slashIndex = trimmed.indexOf("/");
        if(slashIndex > 0) {
                const prefix = trimmed.slice(0, slashIndex);
                if(prefix.includes(":")) {
                        return trimmed.slice(slashIndex + 1);
                }
        }

        return trimmed;
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

        const readDate = message.dateRead ? new Date(message.dateRead) : undefined;
        if(readDate) {
                return {status: MessageStatusCode.Read, statusDate: readDate};
        }

        const deliveredDate = message.dateDelivered ? new Date(message.dateDelivered) : undefined;
        if(deliveredDate) {
                return {status: MessageStatusCode.Delivered, statusDate: deliveredDate};
        }

        if(!(supportsDeliveredReceipts || supportsReadReceipts)) {
                return {status: MessageStatusCode.Sent};
        }

        if(supportsDeliveredReceipts && message.isDelivered) {
                return {status: MessageStatusCode.Delivered};
        }

        return {status: MessageStatusCode.Delivered};
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
