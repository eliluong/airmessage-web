import {
        appendLegacyAuthParams,
        AttachmentDownloadOptions,
        BlueBubblesApiError,
        createChat as createChatDirect,
        downloadAttachment as downloadAttachmentDirect,
        downloadAttachmentThumbnail as downloadAttachmentThumbnailDirect,
        fetchChat as fetchChatDirect,
        fetchChatCount as fetchChatCountDirect,
        FetchChatCountOptions,
        fetchChatMessages as fetchChatMessagesDirect,
        fetchChats as fetchChatsDirect,
        FetchChatsOptions,
        fetchServerMetadata as fetchServerMetadataDirect,
        pingServer as pingServerDirect,
        queryMessages as queryMessagesDirect,
        sendTextMessage as sendTextMessageDirect
} from "./api";
import BlueBubblesRealtimeChannel, {
        BlueBubblesRealtimeChannelOptions,
        BlueBubblesRealtimeConnectionState,
        BlueBubblesRealtimeEventName
} from "./realtimeChannel";
import {BlueBubblesAuthState, BlueBubblesTransportMode} from "./session";
import {
        AttachmentSendResponse,
        ChatCreateResponse,
        ChatCountResponse,
        ChatQueryPageResponse,
        ChatQueryResponse,
        MessageQueryResponse,
        MessageSendResponse,
        ServerMetadataResponse,
        SingleChatResponse
} from "./types";

const BFF_NOT_IMPLEMENTED_MESSAGE = "BFF transport mode is enabled but not implemented yet. Complete Phase 1 before enabling WPEnv.BFF_ENABLED.";

export interface BlueBubblesRealtimeChannelLike {
        connect(): void;
        disconnect(): void;
        subscribe(eventName: BlueBubblesRealtimeEventName, listener: (payload: unknown) => void): () => void;
        readonly state: BlueBubblesRealtimeConnectionState;
        isHealthy(): boolean;
}

export interface AttachmentUploadTarget {
        url: string;
        headers: Record<string, string>;
}

function readBffEnabledFlag(): boolean {
        if(typeof WPEnv === "undefined") return false;
        return WPEnv.BFF_ENABLED === true;
}

export function getConfiguredBlueBubblesTransportMode(): BlueBubblesTransportMode {
        return readBffEnabledFlag() ? "bff" : "direct";
}

export function isBffTransportEnabled(): boolean {
        return getConfiguredBlueBubblesTransportMode() === "bff";
}

function resolveTransportMode(auth: BlueBubblesAuthState): BlueBubblesTransportMode {
        return auth.transportMode ?? getConfiguredBlueBubblesTransportMode();
}

function assertDirectTransport(auth: BlueBubblesAuthState): void {
        if(resolveTransportMode(auth) === "bff") {
                throw new Error(BFF_NOT_IMPLEMENTED_MESSAGE);
        }
}

export function fetchServerMetadata(auth: BlueBubblesAuthState): Promise<ServerMetadataResponse> {
        assertDirectTransport(auth);
        return fetchServerMetadataDirect(auth);
}

export function pingServer(auth: BlueBubblesAuthState): Promise<void> {
        assertDirectTransport(auth);
        return pingServerDirect(auth);
}

export function fetchChats(
        auth: BlueBubblesAuthState,
        options: FetchChatsOptions & {offset: number;}
): Promise<ChatQueryPageResponse>;
export function fetchChats(auth: BlueBubblesAuthState, options?: FetchChatsOptions): Promise<ChatQueryResponse>;
export function fetchChats(auth: BlueBubblesAuthState, options: FetchChatsOptions = {}): Promise<ChatQueryResponse> {
        assertDirectTransport(auth);
        return fetchChatsDirect(auth, options);
}

export function fetchChatCount(
        auth: BlueBubblesAuthState,
        options: FetchChatCountOptions = {}
): Promise<ChatCountResponse> {
        assertDirectTransport(auth);
        return fetchChatCountDirect(auth, options);
}

export function fetchChat(auth: BlueBubblesAuthState, guid: string): Promise<SingleChatResponse> {
        assertDirectTransport(auth);
        return fetchChatDirect(auth, guid);
}

export function createChat(auth: BlueBubblesAuthState, body: Record<string, unknown>): Promise<ChatCreateResponse> {
        assertDirectTransport(auth);
        return createChatDirect(auth, body);
}

export function fetchChatMessages(
        auth: BlueBubblesAuthState,
        guid: string,
        options: {limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC";} = {}
): Promise<MessageQueryResponse> {
        assertDirectTransport(auth);
        return fetchChatMessagesDirect(auth, guid, options);
}

export function queryMessages(auth: BlueBubblesAuthState, payload: Record<string, unknown>): Promise<MessageQueryResponse> {
        assertDirectTransport(auth);
        return queryMessagesDirect(auth, payload);
}

export function sendTextMessage(auth: BlueBubblesAuthState, payload: Record<string, unknown>): Promise<MessageSendResponse> {
        assertDirectTransport(auth);
        return sendTextMessageDirect(auth, payload);
}

export function downloadAttachment(
        auth: BlueBubblesAuthState,
        guid: string,
        options: AttachmentDownloadOptions = {}
): Promise<Response> {
        assertDirectTransport(auth);
        return downloadAttachmentDirect(auth, guid, options);
}

export function downloadAttachmentThumbnail(
        auth: BlueBubblesAuthState,
        guid: string,
        options: AttachmentDownloadOptions = {}
): Promise<Response> {
        assertDirectTransport(auth);
        return downloadAttachmentThumbnailDirect(auth, guid, options);
}

export function createRealtimeChannel(
        auth: BlueBubblesAuthState,
        options: BlueBubblesRealtimeChannelOptions = {}
): BlueBubblesRealtimeChannelLike {
        assertDirectTransport(auth);
        return new BlueBubblesRealtimeChannel(auth, options);
}

export function resolveAttachmentUploadTarget(auth: BlueBubblesAuthState): AttachmentUploadTarget {
        assertDirectTransport(auth);
        const path = appendLegacyAuthParams(auth, "/api/v1/message/attachment");
        const normalizedServer = auth.serverUrl.replace(/\/$/, "");
        return {
                url: `${normalizedServer}${path}`,
                headers: {
                        "Authorization": `Bearer ${auth.accessToken}`
                }
        };
}

export function isBlueBubblesTransportApiError(error: unknown): error is BlueBubblesApiError {
        return error instanceof BlueBubblesApiError;
}

export type {
        AttachmentDownloadOptions,
        FetchChatCountOptions,
        FetchChatsOptions,
        BlueBubblesRealtimeChannelOptions,
        BlueBubblesRealtimeConnectionState,
        BlueBubblesRealtimeEventName,
        AttachmentSendResponse
};
