import CommunicationsManager, {
        ConversationLinkFetchResult,
        ConversationLinkScanCursor,
        ConversationMediaFetchResult,
        ConversationQueryMetadata,
        ConversationQueryOptions,
        ConversationQueryResult,
        ThreadFetchMetadata,
        ThreadFetchOptions,
        normalizeThreadFetchOptions
} from "../communicationsManager";
import DataProxy from "../dataProxy";
import {Conversation, ConversationItem, LinkedConversation, MessageItem, TapbackItem} from "../../data/blocks";
import {extractConversationAttachments} from "../../data/attachment";
import {
        AttachmentRequestErrorCode,
        ConnectionErrorCode,
        ConversationItemType,
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
        BlueBubblesRealtimeChannelLike,
        BlueBubblesRealtimeConnectionState,
        BlueBubblesRealtimeEventName,
        createChat as createChatApi,
        createRealtimeChannel,
        downloadAttachment,
        downloadAttachmentThumbnail,
        fetchChat,
        fetchChatMessages,
        fetchChats,
        FetchChatsOptions,
        fetchServerMetadata,
        isBlueBubblesTransportApiError,
        pingServer,
        queryMessages,
        resolveAttachmentUploadTarget,
        sendTextMessage
} from "./transport";
import {convertChatResponse} from "./chatTransformers";
import {logBlueBubblesDebug} from "./debugLogging";
import {
        needsRealtimeHydration,
        parseBlueBubblesRealtimePayload
} from "./realtimePayload";
import {compareVersions} from "../../util/versionUtils";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_THREAD_PAGE_SIZE = 50;
const TAPBACK_ADD_OFFSET = 2000;
const TAPBACK_REMOVE_OFFSET = 3000;
const TEXT_TAPBACK_CACHE_LIMIT = 50;
const REACTION_GUID_CACHE_LIMIT = 5000;
const EMITTED_MESSAGE_CACHE_LIMIT = 5000;
const MESSAGE_IDENTITY_ALIAS_CACHE_LIMIT = 5000;
const LINK_SCAN_QUERY_LIMIT = 1000;
const MIN_REALTIME_SERVER_VERSION = [1, 6, 0];

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

interface TextTapbackCacheRecord {
        normalizedText: string;
        guid: string;
}

interface TextTapbackCacheEntry {
        map: Map<string, string[]>;
        order: TextTapbackCacheRecord[];
}

export default class BlueBubblesCommunicationsManager extends CommunicationsManager {
        private readonly auth: BlueBubblesAuthState;
        private metadata: ServerMetadataResponse | undefined;
        private pollTimer: ReturnType<typeof setInterval> | undefined;
        private pollInFlight = false;
        private hasStartedPolling = false;
        private isClosed = false;
        private lastRowId: number | undefined;
        private lastMessageTimestamp: number | undefined;
        private readonly tapbackCache = new Map<string, TapbackItem[]>();
        private readonly textTapbackCache = new Map<string, TextTapbackCacheEntry>();
        private readonly reactionFingerprintCache = new Map<string, string>();
        private supportsDeliveredReceipts = false;
        private supportsReadReceipts = false;
        private readonly conversationGuidCache = new Map<string, string>();
        private realtimeChannel: BlueBubblesRealtimeChannelLike | undefined;
        private realtimeChannelState: BlueBubblesRealtimeConnectionState = "idle";
        private lastRealtimeErrorMessage: string | undefined;
        private isIntervalPollingActive = false;
        private readonly realtimeUnsubscribeCallbacks: Array<() => void> = [];
        private realtimeEventQueue: Promise<void> = Promise.resolve();
        private pendingCatchupPoll = false;
        private readonly emittedMessageFingerprints = new Map<string, string>();
        private readonly messageIdentityAliases = new Map<string, string>();

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

        public async fetchConversationLinkMessages(
                chatGUID: string,
                cursor?: ConversationLinkScanCursor
        ): Promise<ConversationLinkFetchResult> {
                const currentCursor: ConversationLinkScanCursor = cursor
                        ? {...cursor}
                        : {phase: "coarse", pagesFetched: 0, beforeTimestamp: undefined};

                if(currentCursor.phase === "coarse") {
                        const payload: Record<string, unknown> = {
                                chatGuid: chatGUID,
                                sort: "DESC",
                                limit: LINK_SCAN_QUERY_LIMIT,
                                with: [
                                        "chat",
                                        "handle",
                                        "attachments",
                                        "message.attributedbody",
                                        "message.payloadData"
                                ]
                        };
                        const where = [
                                {statement: "chat.guid = :chatGuid", args: {chatGuid: chatGUID}},
                                {
                                        statement:
                                                "(message.text LIKE :httpPattern OR message.text LIKE :httpsPattern OR message.text LIKE :wwwPattern)",
                                        args: {
                                                httpPattern: "%http://%",
                                                httpsPattern: "%https://%",
                                                wwwPattern: "%www.%"
                                        }
                                }
                        ];
                        payload.where = where;
                        const response = await queryMessages(this.auth, payload);
                        const ordered = (response.data ?? []).slice().sort((a, b) => b.dateCreated - a.dateCreated);
                        const {items} = this.processMessages(ordered);
                        const messages = items.filter(
                                (item): item is MessageItem => item.itemType === ConversationItemType.Message
                        );
                        const oldestTimestamp = ordered.length > 0 ? ordered[ordered.length - 1].dateCreated : undefined;
                        const nextCursor: ConversationLinkScanCursor = {
                                phase: "backfill",
                                pagesFetched: 0,
                                beforeTimestamp: oldestTimestamp !== undefined ? oldestTimestamp - 1 : undefined
                        };
                        return {messages, cursor: nextCursor, exhausted: nextCursor.beforeTimestamp === undefined};
                }

                if(currentCursor.beforeTimestamp === undefined) {
                        return {messages: [], cursor: currentCursor, exhausted: true};
                }

                const response = await fetchChatMessages(this.auth, chatGUID, {
                        limit: LINK_SCAN_QUERY_LIMIT,
                        before: currentCursor.beforeTimestamp,
                        sort: "DESC"
                });
                const ordered = (response.data ?? []).slice().sort((a, b) => b.dateCreated - a.dateCreated);
                const {items} = this.processMessages(ordered);
                const messages = items.filter((item): item is MessageItem => item.itemType === ConversationItemType.Message);
                const oldestTimestamp = ordered.length > 0 ? ordered[ordered.length - 1].dateCreated : undefined;
                const nextCursor: ConversationLinkScanCursor = {
                        phase: "backfill",
                        pagesFetched: currentCursor.pagesFetched + 1,
                        beforeTimestamp: oldestTimestamp !== undefined ? oldestTimestamp - 1 : undefined
                };
                const exhausted = ordered.length < LINK_SCAN_QUERY_LIMIT || nextCursor.beforeTimestamp === undefined;
                return {messages, cursor: nextCursor, exhausted};
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
                        this.emitMessageItems(items, false);
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

        public override requestRetrievalTime(timeLower: Date, _timeUpper: Date): boolean {
                const lowerTimestamp = Math.floor(timeLower.getTime());
                if(Number.isFinite(lowerTimestamp) && (this.lastMessageTimestamp === undefined || lowerTimestamp < this.lastMessageTimestamp)) {
                        this.lastMessageTimestamp = lowerTimestamp;
                }

                this.requestPollCatchup();
                return true;
        }

        public override requestRetrievalID(idLower: number, _timeLower: Date, _timeUpper: Date): boolean {
                const normalizedLowerId = Math.floor(idLower);
                if(Number.isFinite(normalizedLowerId) && (this.lastRowId === undefined || normalizedLowerId < this.lastRowId)) {
                        this.lastRowId = normalizedLowerId;
                }

                this.requestPollCatchup();
                return true;
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
                this.isIntervalPollingActive = false;
                this.conversationGuidCache.clear();
                this.clearTextTapbackCache();
                this.realtimeChannelState = "idle";
                this.lastRealtimeErrorMessage = undefined;
                this.lastRowId = undefined;
                this.lastMessageTimestamp = undefined;
                this.emittedMessageFingerprints.clear();
                this.messageIdentityAliases.clear();
                this.realtimeEventQueue = Promise.resolve();
                this.pendingCatchupPoll = false;
                this.teardownRealtimeChannel();
                try {
                        this.metadata = await fetchServerMetadata(this.auth);
                        const features = this.metadata.features;
                        const privateApiFlag = features?.private_api ?? this.metadata.private_api;
                        const helperFlag = features?.helper_connected ?? this.metadata.helper_connected;
                        const reactionsFlag = features?.reactions ?? true;
                        const deliveredFlag = features?.delivered_receipts ?? true;
                        const readFlag = features?.read_receipts ?? deliveredFlag;
                        logBlueBubblesDebug("Server metadata", {
                                serverVersion: this.metadata.server_version,
                                privateApi: privateApiFlag,
                                helperConnected: helperFlag,
                                hasFeaturesEndpoint: Boolean(features)
                        });

                        const reactionsEnabled = Boolean(reactionsFlag);
                        if(!reactionsEnabled) {
                                this.tapbackCache.clear();
                                this.clearTextTapbackCache();
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
                        this.initializeRealtimeChannel();
                } catch(error) {
                        this.handleFatalError(error);
                }
        }

        private teardown() {
                this.isClosed = true;
                this.hasStartedPolling = false;
                this.isIntervalPollingActive = false;
                this.realtimeEventQueue = Promise.resolve();
                this.pendingCatchupPoll = false;
                this.teardownRealtimeChannel();
                this.stopPolling();
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
                        this.pollUpdates("interval").catch((error) => console.warn("Failed to poll BlueBubbles updates", error));
                }, POLL_INTERVAL_MS);
        }

        private stopPolling() {
                if(!this.pollTimer) return;
                clearInterval(this.pollTimer);
                this.pollTimer = undefined;
        }

        private shouldUseIntervalPolling(): boolean {
                if(!this.hasStartedPolling || this.isClosed) return false;
                if(!this.isRealtimeSupported()) return true;
                return this.realtimeChannelState !== "connected";
        }

        private synchronizePollingMode() {
                const shouldUseIntervalPolling = this.shouldUseIntervalPolling();
                if(shouldUseIntervalPolling) {
                        this.startPolling();
                } else {
                        this.stopPolling();
                }

                if(this.isIntervalPollingActive !== shouldUseIntervalPolling) {
                        this.isIntervalPollingActive = shouldUseIntervalPolling;
                        if(shouldUseIntervalPolling) {
                                const reason = !this.isRealtimeSupported()
                                        ? "realtime-unsupported"
                                        : `channel-state-${this.realtimeChannelState}`;
                                console.warn("[BlueBubbles] Realtime channel unavailable, interval polling fallback is active", {
                                        reason,
                                        channelState: this.realtimeChannelState,
                                        lastRealtimeError: this.lastRealtimeErrorMessage
                                });
                        } else {
                                logBlueBubblesDebug("Realtime healthy, interval polling suspended", {
                                        channelState: this.realtimeChannelState
                                });
                        }
                }
        }

        private requestPollCatchup() {
                this.ensurePollingStarted();
                if(this.pollInFlight) {
                        this.pendingCatchupPoll = true;
                        return;
                }
                this.pollUpdates("catchup").catch((error) => console.warn("Failed to poll BlueBubbles updates", error));
        }

        private initializeRealtimeChannel() {
                if(!this.isRealtimeSupported()) {
                        logBlueBubblesDebug("Realtime channel disabled for server version", {
                                serverVersion: this.metadata?.server_version,
                                minimumVersion: MIN_REALTIME_SERVER_VERSION.join(".")
                        });
                        return;
                }

                const channel = createRealtimeChannel(this.auth, {
                        onStateChange: (state, details) => this.handleRealtimeChannelStateChange(state, details),
                        onError: (error) => this.handleRealtimeChannelError(error)
                });
                this.realtimeChannel = channel;
                this.realtimeUnsubscribeCallbacks.push(channel.subscribe("new-message", (payload) => this.queueRealtimeEvent("new-message", payload)));
                this.realtimeUnsubscribeCallbacks.push(channel.subscribe("updated-message", (payload) => this.queueRealtimeEvent("updated-message", payload)));
                channel.connect();
        }

        private teardownRealtimeChannel() {
                while(this.realtimeUnsubscribeCallbacks.length > 0) {
                        const unsubscribe = this.realtimeUnsubscribeCallbacks.pop();
                        if(!unsubscribe) break;
                        unsubscribe();
                }
                if(this.realtimeChannel) {
                        this.realtimeChannel.disconnect();
                        this.realtimeChannel = undefined;
                }
                this.realtimeChannelState = "idle";
        }

        private isRealtimeSupported(): boolean {
                return compareVersions(this.communicationsVersion, MIN_REALTIME_SERVER_VERSION) >= 0;
        }

        private handleRealtimeChannelStateChange(state: BlueBubblesRealtimeConnectionState, details?: unknown): void {
                if(this.isClosed) return;
                this.realtimeChannelState = state;
                if(state === "connected") {
                        this.lastRealtimeErrorMessage = undefined;
                } else if(state === "error") {
                        const normalizedStateError = normalizeRealtimeError(details);
                        if(normalizedStateError) {
                                this.lastRealtimeErrorMessage = normalizedStateError;
                        }
                }
                logBlueBubblesDebug("Realtime channel state", {state, details});

                if(!this.hasStartedPolling) return;
                this.synchronizePollingMode();
                if(state === "connected" || state === "disconnected" || state === "error") {
                        this.requestPollCatchup();
                }
        }

        private handleRealtimeChannelError(error: Error): void {
                if(this.isClosed) return;
                this.lastRealtimeErrorMessage = error.message;
                console.warn("[BlueBubbles] Realtime channel error", error);
                this.options.onError?.(error);
                if(this.hasStartedPolling) {
                        this.synchronizePollingMode();
                        this.requestPollCatchup();
                }
        }

        private queueRealtimeEvent(eventName: BlueBubblesRealtimeEventName, payload: unknown): void {
                this.realtimeEventQueue = this.realtimeEventQueue
                        .then(() => this.ingestRealtimeEvent(eventName, payload))
                        .catch((error) => {
                                this.handleRealtimeEventError(eventName, payload, error);
                        });
        }

        private async ingestRealtimeEvent(eventName: BlueBubblesRealtimeEventName, payload: unknown): Promise<void> {
                if(this.isClosed) return;

                const parsed = await parseBlueBubblesRealtimePayload(payload, this.auth.accessToken);
                const resolvedMessages: MessageResponse[] = [];

                for(const candidate of parsed.messages) {
                        const resolved = await this.resolveRealtimeMessageCandidate(candidate, parsed.partial);
                        if(resolved) {
                                resolvedMessages.push(resolved);
                        }
                }

                if(resolvedMessages.length === 0) {
                        logBlueBubblesDebug("Realtime message event skipped", {
                                eventName,
                                channelState: this.realtimeChannelState,
                                source: parsed.source,
                                encoding: parsed.encoding,
                                partial: parsed.partial,
                                encrypted: parsed.encrypted,
                                reason: "no-resolved-messages"
                        });
                        if(this.hasStartedPolling) {
                                this.requestPollCatchup();
                        }
                        return;
                }

                this.listener?.onPacket();

                const sorted = resolvedMessages.slice().sort((a, b) => a.dateCreated - b.dateCreated);
                this.updatePollCursor(sorted);
                const {items, modifiers} = this.processMessages(sorted);
                const emittedItems = this.emitMessageItems(items, true);
                if(modifiers.length > 0) {
                        this.listener?.onModifierUpdate(modifiers);
                }

                logBlueBubblesDebug("Realtime message event", {
                        eventName,
                        channelState: this.realtimeChannelState,
                        source: parsed.source,
                        encoding: parsed.encoding,
                        partial: parsed.partial,
                        encrypted: parsed.encrypted,
                        receivedMessages: parsed.messages.length,
                        resolvedMessages: resolvedMessages.length,
                        emittedItems,
                        emittedModifiers: modifiers.length,
                        lastRowId: this.lastRowId,
                        lastTimestamp: this.lastMessageTimestamp
                });
        }

        private async resolveRealtimeMessageCandidate(
                candidate: Partial<MessageResponse>,
                envelopePartial: boolean
        ): Promise<MessageResponse | undefined> {
                if(!needsRealtimeHydration(candidate, envelopePartial)) {
                        return candidate as MessageResponse;
                }

                const guidCandidates = new Set<string>();
                const rawGuid = typeof candidate.guid === "string" ? candidate.guid.trim() : undefined;
                const normalizedGuid = normalizeMessageGuid(rawGuid);
                if(rawGuid) guidCandidates.add(rawGuid);
                if(normalizedGuid) guidCandidates.add(normalizedGuid);

                if(guidCandidates.size === 0) {
                        console.warn("[BlueBubbles] Realtime message requires hydration but no GUID was provided", {
                                candidate
                        });
                        return undefined;
                }

                for(const guid of guidCandidates) {
                        const hydrated = await this.fetchMessageByGuid(guid);
                        if(hydrated) {
                                return hydrated;
                        }
                }

                console.warn("[BlueBubbles] Failed to hydrate realtime message by GUID", {
                        guidCandidates: Array.from(guidCandidates)
                });
                return undefined;
        }

        private async fetchMessageByGuid(guid: string): Promise<MessageResponse | undefined> {
                const response = await queryMessages(this.auth, {
                        sort: "DESC",
                        limit: 1,
                        with: ["attachments", "chat", "handle", "message.attributedbody", "message.messageSummaryInfo", "message.payloadData"],
                        where: [
                                {
                                        statement: "message.guid = :guid",
                                        args: {guid}
                                }
                        ]
                });
                const message = response.data?.[0];
                if(!message) return undefined;
                return message;
        }

        private handleRealtimeEventError(eventName: BlueBubblesRealtimeEventName, payload: unknown, error: unknown): void {
                if(this.isClosed) return;
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                console.warn("[BlueBubbles] Realtime message ingestion failed", {
                        eventName,
                        payload,
                        error: normalizedError
                });
                this.options.onError?.(normalizedError);
                if(this.hasStartedPolling) {
                        this.requestPollCatchup();
                }
        }

        private buildPollPayload(): {payload: Record<string, unknown>; hasCursor: boolean;} {
                const hasCursor = this.lastRowId !== undefined || this.lastMessageTimestamp !== undefined;
                const payload: Record<string, unknown> = {
                        sort: hasCursor ? "ASC" : "DESC",
                        limit: DEFAULT_THREAD_PAGE_SIZE,
                        with: ["attachments", "chat"],
                        offset: 0
                };
                if(this.lastRowId !== undefined) {
                        payload.where = [
                                {
                                        statement: "message.ROWID > :rowid",
                                        args: {rowid: this.lastRowId}
                                }
                        ];
                } else if(this.lastMessageTimestamp !== undefined) {
                        payload.after = this.lastMessageTimestamp;
                }
                return {payload, hasCursor};
        }

        private updatePollCursor(messages: MessageResponse[]): boolean {
                if(messages.length === 0) return false;

                let didAdvance = false;
                const latestTimestamp = messages[messages.length - 1].dateCreated;
                if(this.lastMessageTimestamp === undefined || latestTimestamp > this.lastMessageTimestamp) {
                        this.lastMessageTimestamp = latestTimestamp;
                        didAdvance = true;
                }

                const latestRowId = messages.reduce(
                        (max, message) => Math.max(max, message.originalROWID),
                        Number.NEGATIVE_INFINITY
                );
                if(Number.isFinite(latestRowId) && (this.lastRowId === undefined || latestRowId > this.lastRowId)) {
                        this.lastRowId = latestRowId;
                        this.listener?.onIDUpdate(latestRowId);
                        didAdvance = true;
                }

                return didAdvance;
        }

        private emitMessageItems(items: ConversationItem[], newestFirst: boolean): number {
                const deduped = this.filterDuplicateConversationItems(items);
                if(deduped.length === 0) return 0;

                const ordered = newestFirst ? deduped.slice().reverse() : deduped;
                this.listener?.onMessageUpdate(ordered);
                return deduped.length;
        }

        private filterDuplicateConversationItems(items: ConversationItem[]): ConversationItem[] {
                const deduped: ConversationItem[] = [];

                for(const item of items) {
                        const key = this.buildConversationItemFingerprintKey(item);
                        if(!key) {
                                deduped.push(item);
                                continue;
                        }

                        const fingerprint = this.buildConversationItemFingerprint(item);
                        const previousFingerprint = this.emittedMessageFingerprints.get(key);
                        if(previousFingerprint === fingerprint) {
                                continue;
                        }

                        if(this.emittedMessageFingerprints.has(key)) {
                                this.emittedMessageFingerprints.delete(key);
                        }
                        this.emittedMessageFingerprints.set(key, fingerprint);
                        while(this.emittedMessageFingerprints.size > EMITTED_MESSAGE_CACHE_LIMIT) {
                                const oldestKey = this.emittedMessageFingerprints.keys().next().value;
                                if(oldestKey === undefined) break;
                                this.emittedMessageFingerprints.delete(oldestKey);
                        }

                        deduped.push(item);
                }

                return deduped;
        }

        private registerMessageIdentityAliases(message: MessageResponse): void {
                const normalizedGuid = normalizeMessageGuid(message.guid);
                const normalizedTempGuid = normalizeMessageGuid(message.tempGuid);
                const guidCandidates = new Set<string>();

                if(message.guid) {
                        guidCandidates.add(`message:guid:${message.guid}`);
                }
                if(normalizedGuid) {
                        guidCandidates.add(`message:guid:${normalizedGuid}`);
                }
                if(message.tempGuid) {
                        guidCandidates.add(`message:guid:${message.tempGuid}`);
                }
                if(normalizedTempGuid) {
                        guidCandidates.add(`message:guid:${normalizedTempGuid}`);
                }

                const serverKey = Number.isFinite(message.originalROWID)
                        ? `message:server:${message.originalROWID}`
                        : undefined;
                const canonicalGuidKey = normalizedGuid
                        ? `message:guid:${normalizedGuid}`
                        : (message.guid ? `message:guid:${message.guid}` : undefined);
                const canonicalKey = serverKey ?? canonicalGuidKey;
                if(!canonicalKey) return;

                for(const candidate of guidCandidates) {
                        if(candidate === canonicalKey) continue;
                        this.recordMessageIdentityAlias(candidate, canonicalKey);
                }
        }

        private recordMessageIdentityAlias(aliasKey: string, canonicalKey: string): void {
                const resolvedAlias = this.resolveMessageIdentityKey(aliasKey);
                const resolvedCanonical = this.resolveMessageIdentityKey(canonicalKey);
                if(resolvedAlias === resolvedCanonical) return;

                this.messageIdentityAliases.set(aliasKey, resolvedCanonical);
                if(resolvedAlias !== aliasKey) {
                        this.messageIdentityAliases.set(resolvedAlias, resolvedCanonical);
                }

                const aliasFingerprint = this.emittedMessageFingerprints.get(aliasKey)
                        ?? this.emittedMessageFingerprints.get(resolvedAlias);
                if(aliasFingerprint !== undefined && !this.emittedMessageFingerprints.has(resolvedCanonical)) {
                        this.emittedMessageFingerprints.set(resolvedCanonical, aliasFingerprint);
                }

                this.emittedMessageFingerprints.delete(aliasKey);
                if(resolvedAlias !== aliasKey) {
                        this.emittedMessageFingerprints.delete(resolvedAlias);
                }

                while(this.messageIdentityAliases.size > MESSAGE_IDENTITY_ALIAS_CACHE_LIMIT) {
                        const oldestAliasKey = this.messageIdentityAliases.keys().next().value;
                        if(oldestAliasKey === undefined) break;
                        this.messageIdentityAliases.delete(oldestAliasKey);
                }
        }

        private resolveMessageIdentityKey(key: string): string {
                let current = key;
                const visited = new Set<string>();

                while(true) {
                        if(visited.has(current)) return current;
                        visited.add(current);

                        const next = this.messageIdentityAliases.get(current);
                        if(!next || next === current) return current;
                        current = next;
                }
        }

        private buildConversationItemFingerprintKey(item: ConversationItem): string | undefined {
                switch(item.itemType) {
                        case ConversationItemType.Message: {
                                const message = item as MessageItem;
                                if(message.serverID !== undefined) {
                                        return this.resolveMessageIdentityKey(`message:server:${message.serverID}`);
                                }
                                if(message.guid) {
                                        return this.resolveMessageIdentityKey(`message:guid:${message.guid}`);
                                }
                                return undefined;
                        }
                        case ConversationItemType.ParticipantAction:
                                if(item.guid) return `participant:${item.guid}`;
                                if(item.serverID !== undefined) return `participant:server:${item.serverID}`;
                                return undefined;
                        case ConversationItemType.ChatRenameAction:
                                if(item.guid) return `rename:${item.guid}`;
                                if(item.serverID !== undefined) return `rename:server:${item.serverID}`;
                                return undefined;
                        default:
                                return undefined;
                }
        }

        private buildConversationItemFingerprint(item: ConversationItem): string {
                switch(item.itemType) {
                        case ConversationItemType.Message: {
                                const message = item as MessageItem;
                                const attachmentFingerprint = message.attachments
                                        .map((attachment) => `${attachment.guid}:${attachment.name}:${attachment.type}:${attachment.size ?? ""}`)
                                        .join("|");
                                const tapbackFingerprint = message.tapbacks
                                        .map((tapback) => `${tapback.sender}:${tapback.tapbackType}:${tapback.tapbackEmoji ?? ""}:${tapback.isAddition ? "add" : "remove"}`)
                                        .sort()
                                        .join("|");
                                return [
                                        message.serverID ?? "",
                                        message.guid ?? "",
                                        message.chatGuid ?? "",
                                        message.date.getTime(),
                                        message.sender ?? "",
                                        message.text ?? "",
                                        message.subject ?? "",
                                        message.sendStyle ?? "",
                                        message.status ?? "",
                                        message.statusDate?.getTime() ?? "",
                                        message.error?.code ?? "",
                                        message.error?.detail ?? "",
                                        attachmentFingerprint,
                                        tapbackFingerprint
                                ].join("::");
                        }
                        case ConversationItemType.ParticipantAction:
                                return [
                                        item.serverID ?? "",
                                        item.guid ?? "",
                                        item.chatGuid ?? "",
                                        item.date.getTime(),
                                        item.type,
                                        item.user ?? "",
                                        item.target ?? ""
                                ].join("::");
                        case ConversationItemType.ChatRenameAction:
                                return [
                                        item.serverID ?? "",
                                        item.guid ?? "",
                                        item.chatGuid ?? "",
                                        item.date.getTime(),
                                        item.user ?? "",
                                        item.chatName ?? ""
                                ].join("::");
                }
                return "";
        }

        private async pollUpdates(source: "interval" | "catchup" = "interval") {
                if(this.pollInFlight) return;
                this.pollInFlight = true;
                const startRowId = this.lastRowId;
                const startTimestamp = this.lastMessageTimestamp;
                let pagesFetched = 0;
                let totalMessages = 0;
                let totalItems = 0;
                let totalModifiers = 0;
                let endReason: "no-data" | "page-exhausted" | "initial-sync" | "cursor-stalled" | "error" = "no-data";
                try {
                        let hasMore = true;
                        while(hasMore) {
                                const {payload, hasCursor} = this.buildPollPayload();
                                const response = await queryMessages(this.auth, payload);
                                this.listener?.onPacket();

                                const responseData = response.data ?? [];
                                if(responseData.length === 0) {
                                        endReason = "no-data";
                                        break;
                                }

                                pagesFetched += 1;
                                totalMessages += responseData.length;
                                const sorted = responseData.slice().sort((a, b) => a.dateCreated - b.dateCreated);
                                const cursorAdvanced = this.updatePollCursor(sorted);
                                const {items, modifiers} = this.processMessages(sorted);
                                totalItems += this.emitMessageItems(items, true);
                                totalModifiers += modifiers.length;
                                if(modifiers.length > 0) {
                                        this.listener?.onModifierUpdate(modifiers);
                                }

                                if(!hasCursor) {
                                        endReason = "initial-sync";
                                        break;
                                }

                                hasMore = responseData.length >= DEFAULT_THREAD_PAGE_SIZE;
                                if(hasMore && !cursorAdvanced) {
                                        endReason = "cursor-stalled";
                                        console.warn("[BlueBubbles] Poll cursor stalled while paging updates; stopping catch-up cycle");
                                        break;
                                }
                                if(!hasMore) {
                                        endReason = "page-exhausted";
                                }
                        }
                } catch(error) {
                        endReason = "error";
                        throw error;
                } finally {
                        const shouldLogSummary = source === "catchup" || pagesFetched > 1 || endReason === "cursor-stalled";
                        if(shouldLogSummary) {
                                logBlueBubblesDebug("Poll cycle", {
                                        source,
                                        pagesFetched,
                                        totalMessages,
                                        totalItems,
                                        totalModifiers,
                                        startRowId,
                                        endRowId: this.lastRowId,
                                        startTimestamp,
                                        endTimestamp: this.lastMessageTimestamp,
                                        endReason
                                });
                        }
                        this.pollInFlight = false;
                        const shouldRunQueuedCatchup = this.pendingCatchupPoll;
                        this.pendingCatchupPoll = false;
                        if(shouldRunQueuedCatchup && !this.isClosed) {
                                this.pollUpdates("catchup").catch((error) => console.warn("Failed to poll BlueBubbles updates", error));
                        }
                }
        }

        private async fetchLiteConversations(limit?: number) {
                const requestLimit = limit !== undefined ? Math.max(1, limit) : undefined;
                const response = await this.queryChats({limit: requestLimit});
                const conversations = response.data.map((chat) => this.convertChat(chat));
                this.listener?.onMessageConversations(conversations);
                this.ensurePollingStarted();
        }

        private queryChats(options: FetchChatsOptions): Promise<ChatQueryResponse> {
                return fetchChats(this.auth, options);
        }

        private ensurePollingStarted() {
                if(this.hasStartedPolling) return;
                this.hasStartedPolling = true;
                this.synchronizePollingMode();
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
                        const sortedAscending = ordered.slice().reverse();
                        this.updatePollCursor(sortedAscending);
                }
                const processed = this.processMessages(ordered);
                const metadata = this.buildThreadMetadata(processed.items);
                this.listener?.onMessageThread(chatGUID, normalizedOptions, processed.items, metadata);
                // Historical thread fetches already include tapbacks on each message item, so do not forward
                // the modifier events (`processed.modifiers`) for this batch. Emitting them would cause the UI
                // to treat historical reactions as newly-arrived ones (triggering tapback sounds, etc.).
        }

        public async fetchConversationQueryTotals(signal?: AbortSignal): Promise<ConversationQueryMetadata> {
                const response = await this.queryChats({limit: 1, signal});
                return this.normalizeChatQueryMetadata(response, {limit: 1, offset: 0});
        }

        public async fetchConversationQueryPage(options: ConversationQueryOptions = {}): Promise<ConversationQueryResult> {
                const limit = options.limit !== undefined ? Math.max(1, Math.floor(options.limit)) : 50;
                const requestOptions: FetchChatsOptions = {
                        limit,
                        offset: options.offset,
                        signal: options.signal
                };
                const response = await this.queryChats(requestOptions);
                const metadata = this.normalizeChatQueryMetadata(response, {offset: options.offset, limit});
                const conversations = response.data.map((chat) => this.convertChat(chat));
                return {conversations, metadata};
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
                this.emitMessageItems(items, false);
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
                        this.registerMessageIdentityAliases(message);
                        const service = getMessageService(message);
                        logBlueBubblesDebug("Message", {
                                guid: message.guid,
                                text: message.text,
                                associatedMessageGuid: message.associatedMessageGuid,
                                associatedMessageType: message.associatedMessageType,
                                itemType: message.itemType,
                                isFromMe: message.isFromMe,
                                service,
                                dateDelivered: message.dateDelivered,
                                dateRead: message.dateRead
                        });
                        const smsTapback = !message.associatedMessageGuid && isSmsService(service)
                                ? parseSmsTapback(message)
                                : undefined;
                        const emojiTapback = !message.associatedMessageGuid
                                ? parseEmojiTapback(message)
                                : undefined;
                        const textTapback = smsTapback ?? emojiTapback;
                        if(textTapback) {
                                const targetGuid = this.resolveTextTapbackTargetGuid(message, textTapback, messages);
                                if(targetGuid) {
                                        const tapback: TapbackItem = {
                                                type: MessageModifierType.Tapback,
                                                messageGuid: targetGuid,
                                                messageIndex: 0,
                                                sender: message.isFromMe ? "me" : message.handle?.address ?? "unknown",
                                                isAddition: textTapback.isAddition,
                                                tapbackType: textTapback.tapbackType,
                                                tapbackEmoji: textTapback.tapbackEmoji
                                        } as TapbackItem;
                                        if(this.hasSeenReaction(message.guid, tapback)) {
                                                continue;
                                        }
                                        this.markReactionSeen(message.guid, tapback);
                                        pendingReactions.push({messageGuid: targetGuid, tapback});
                                        modifiers.push(tapback);
                                        continue;
                                }
                                console.warn("[BlueBubbles] Unable to resolve text tapback target", {
                                        guid: message.guid,
                                        chatGuid: message.chats?.[0]?.guid,
                                        targetText: textTapback.targetText,
                                        tapbackType: textTapback.tapbackType,
                                        tapbackEmoji: textTapback.tapbackEmoji
                                });
                        }
                        if(isReactionMessage(message)) {
                                const tapback = mapTapback(message);
                                if(tapback) {
                                        if(this.hasSeenReaction(message.guid, tapback)) {
                                                continue;
                                        }
                                        logBlueBubblesDebug("Tapback", {
                                                messageGuid: message.guid,
                                                associatedMessageGuid: message.associatedMessageGuid,
                                                tapbackType: tapback.tapbackType,
                                                tapbackEmoji: tapback.tapbackEmoji,
                                                isAddition: tapback.isAddition,
                                                sender: tapback.sender
                                        });
                                        this.markReactionSeen(message.guid, tapback);
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

        private hasSeenReaction(guid: string | undefined, tapback: TapbackItem): boolean {
                if(!guid) return false;
                return this.reactionFingerprintCache.get(guid) === this.buildTapbackFingerprint(tapback);
        }

        private markReactionSeen(guid: string | undefined, tapback: TapbackItem): void {
                if(!guid) return;
                const fingerprint = this.buildTapbackFingerprint(tapback);
                if(this.reactionFingerprintCache.has(guid)) {
                        this.reactionFingerprintCache.delete(guid);
                }
                this.reactionFingerprintCache.set(guid, fingerprint);

                while(this.reactionFingerprintCache.size > REACTION_GUID_CACHE_LIMIT) {
                        const oldestKey = this.reactionFingerprintCache.keys().next().value;
                        if(oldestKey === undefined) break;
                        this.reactionFingerprintCache.delete(oldestKey);
                }
        }

        private buildTapbackFingerprint(tapback: TapbackItem): string {
                return [
                        tapback.messageGuid,
                        tapback.sender,
                        tapback.tapbackType,
                        tapback.tapbackEmoji ?? "",
                        tapback.messageIndex,
                        tapback.isAddition ? "add" : "remove"
                ].join("|");
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
                        if(item.chatGuid && item.text) {
                                this.rememberTextTapbackTarget(item.chatGuid, item.text, item.guid);
                        }
                }
                return item;
        }

        private resolveTextTapbackTargetGuid(message: MessageResponse, tapback: ParsedTextTapback, batch: MessageResponse[]): string | undefined {
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
                        const cached = this.lookupTextTapbackTarget(chatGuid, normalized);
                        if(cached) return cached;
                }
                return undefined;
        }

        private lookupTextTapbackTarget(chatGuid: string, normalizedText: string): string | undefined {
                const entry = this.textTapbackCache.get(chatGuid);
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

        private rememberTextTapbackTarget(chatGuid: string, text: string, messageGuid: string) {
                const normalizedText = normalizeTapbackTargetText(text);
                if(normalizedText.length === 0) return;

                let entry = this.textTapbackCache.get(chatGuid);
                if(!entry) {
                        entry = {map: new Map<string, string[]>(), order: []};
                        this.textTapbackCache.set(chatGuid, entry);
                }

                let guids = entry.map.get(normalizedText);
                if(!guids) {
                        guids = [];
                        entry.map.set(normalizedText, guids);
                }
                guids.push(messageGuid);
                entry.order.push({normalizedText, guid: messageGuid});

                while(entry.order.length > TEXT_TAPBACK_CACHE_LIMIT) {
                        const oldest = entry.order.shift();
                        if(!oldest) break;
                        const stored = entry.map.get(oldest.normalizedText);
                        if(!stored) continue;
                        const index = stored.indexOf(oldest.guid);
                        if(index !== -1) stored.splice(index, 1);
                        if(stored.length === 0) entry.map.delete(oldest.normalizedText);
                }
        }

        private clearTextTapbackCache() {
                this.textTapbackCache.clear();
        }

        private convertChat(chat: ChatResponse): LinkedConversation {
                const conversation = convertChatResponse(chat);
                const key = buildConversationKey(conversation.members, conversation.service);
                this.conversationGuidCache.set(key, conversation.guid);
                return conversation;
        }

        private normalizeChatQueryMetadata(
                response: ChatQueryResponse,
                requested?: {offset?: number; limit?: number;}
        ): ConversationQueryMetadata {
                const count = response.metadata?.count ?? response.data.length;
                const total = response.metadata?.total ?? count;
                const offset = response.metadata?.offset ?? requested?.offset ?? 0;
                const limit = response.metadata?.limit ?? requested?.limit;
                return {count, total, offset, limit};
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
                        const code = isBlueBubblesTransportApiError(error) && error.status === 404
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

function isReactionMessage(message: MessageResponse): boolean {
        return !!message.associatedMessageGuid && !!message.associatedMessageType;
}

interface NormalizedTapbackIdentifier {
        code: number;
        isRemoval: boolean;
}

interface ParsedTextTapback {
        tapbackType: TapbackType;
        tapbackEmoji?: string;
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
const EMOJI_TAPBACK_ADDITION_PREFIX_REGEX = /^reacted\s+(.+?)\s+to$/iu;
const EMOJI_TAPBACK_REMOVAL_PREFIX_REGEX = /^removed(?:\s+(?:a|an))?(?:\s+reaction)?\s+(.+?)\s+from$/iu;
const EMOJI_TAPBACK_TOKEN_REGEX = /\p{Extended_Pictographic}/u;

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

function parseSmsTapback(message: MessageResponse): ParsedTextTapback | undefined {
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

function parseEmojiTapback(message: MessageResponse): ParsedTextTapback | undefined {
        const text = message.text;
        if(!text) return undefined;

        const sanitized = stripInvisibleSelectors(text).trim();
        if(sanitized.length === 0) return undefined;

        const match = sanitized.match(SMS_TAPBACK_QUOTE_REGEX);
        if(!match) return undefined;

        const rawPrefix = match[1].trim();
        const rawTarget = match[2].trim();
        if(rawPrefix.length === 0 || rawTarget.length === 0) return undefined;

        let isAddition: boolean;
        let rawTapbackToken: string | undefined;

        const additionMatch = rawPrefix.match(EMOJI_TAPBACK_ADDITION_PREFIX_REGEX);
        if(additionMatch) {
                isAddition = true;
                rawTapbackToken = additionMatch[1];
        } else {
                const removalMatch = rawPrefix.match(EMOJI_TAPBACK_REMOVAL_PREFIX_REGEX);
                if(!removalMatch) return undefined;
                isAddition = false;
                rawTapbackToken = removalMatch[1];
        }

        const tapbackEmoji = normalizeEmojiTapbackToken(rawTapbackToken);
        if(!tapbackEmoji) return undefined;

        const targetText = stripInvisibleSelectors(rawTarget).trim();
        if(targetText.length === 0) return undefined;

        const normalizedBase = normalizeTapbackTargetText(targetText);
        if(normalizedBase.length === 0) return undefined;

        const normalizedTargets = buildSmsTapbackTargetVariants(normalizedBase, TapbackType.Emoji);
        if(normalizedTargets.length === 0) return undefined;

        return {
                tapbackType: TapbackType.Emoji,
                tapbackEmoji,
                isAddition,
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

function normalizeEmojiTapbackToken(token: string | undefined): string | undefined {
        if(!token) return undefined;
        const normalized = stripInvisibleSelectors(token).replace(/\s+/g, " ").trim();
        if(normalized.length === 0) return undefined;
        if(!EMOJI_TAPBACK_TOKEN_REGEX.test(normalized)) return undefined;
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

function normalizeRealtimeError(error: unknown): string | undefined {
        if(error instanceof Error) {
                return error.message;
        }
        if(typeof error === "string") {
                return error;
        }
        if(error && typeof error === "object" && "message" in error) {
                const value = (error as {message?: unknown}).message;
                if(typeof value === "string") {
                        return value;
                }
        }
        if(error === undefined || error === null) {
                return undefined;
        }
        try {
                return JSON.stringify(error);
        } catch {
                return String(error);
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

function buildConversationKey(members: string[], service: string): string {
        return `${service}:${members.slice().map((member) => member.toLowerCase()).sort().join(",")}`;
}

async function uploadAttachmentWithProgress(auth: BlueBubblesAuthState, payload: FormData, progressCallback: (bytesUploaded: number) => void): Promise<AttachmentSendResponse> {
        const uploadTarget = resolveAttachmentUploadTarget(auth);
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
                xhr.open("POST", uploadTarget.url, true);
                for(const [header, value] of Object.entries(uploadTarget.headers)) {
                        xhr.setRequestHeader(header, value);
                }
                xhr.send(payload);
        });
}

function mapMessageError(error: unknown): MessageError {
        if(error && typeof error === "object" && "code" in (error as any)) {
                return error as MessageError;
        }
        return {code: MessageErrorCode.ServerExternal, detail: error instanceof Error ? error.message : String(error)};
}
