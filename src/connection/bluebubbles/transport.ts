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
import BffRealtimeChannel from "./bff/realtimeChannel";
import {
        BffApiError,
        downloadAttachment as downloadAttachmentBff,
        downloadAttachmentThumbnail as downloadAttachmentThumbnailBff,
        fetchChat as fetchChatBff,
        fetchChatCount as fetchChatCountBff,
        fetchChatMessages as fetchChatMessagesBff,
        fetchChats as fetchChatsBff,
        fetchServerMetadata as fetchServerMetadataBff,
        pingServer as pingServerBff,
        queryMessages as queryMessagesBff,
        sendTextMessage as sendTextMessageBff
} from "./bff/api";
import {getBffCsrfToken} from "./bff/csrf";
import {BFF_CSRF_HEADER, BFF_PROXY_ROUTES} from "./bff/contracts";

const BFF_FEATURE_NOT_IMPLEMENTED_MESSAGE = "This action is not implemented for the current BFF rollout phase.";

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
        withCredentials?: boolean;
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

function createPhase2NotImplementedError(action: string): Error {
        return new Error(`${action} failed: ${BFF_FEATURE_NOT_IMPLEMENTED_MESSAGE}`);
}

export function fetchServerMetadata(auth: BlueBubblesAuthState): Promise<ServerMetadataResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return fetchServerMetadataBff();
        }
        return fetchServerMetadataDirect(auth);
}

export function pingServer(auth: BlueBubblesAuthState): Promise<void> {
        if(resolveTransportMode(auth) === "bff") {
                return pingServerBff();
        }
        return pingServerDirect(auth);
}

export function fetchChats(
        auth: BlueBubblesAuthState,
        options: FetchChatsOptions & {offset: number;}
): Promise<ChatQueryPageResponse>;
export function fetchChats(auth: BlueBubblesAuthState, options?: FetchChatsOptions): Promise<ChatQueryResponse>;
export function fetchChats(auth: BlueBubblesAuthState, options: FetchChatsOptions = {}): Promise<ChatQueryResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return fetchChatsBff(options);
        }
        return fetchChatsDirect(auth, options);
}

export function fetchChatCount(
        auth: BlueBubblesAuthState,
        options: FetchChatCountOptions = {}
): Promise<ChatCountResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return fetchChatCountBff(options);
        }
        return fetchChatCountDirect(auth, options);
}

export function fetchChat(auth: BlueBubblesAuthState, guid: string): Promise<SingleChatResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return fetchChatBff(guid);
        }
        return fetchChatDirect(auth, guid);
}

export function createChat(auth: BlueBubblesAuthState, body: Record<string, unknown>): Promise<ChatCreateResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return Promise.reject(createPhase2NotImplementedError("Create chat"));
        }
        return createChatDirect(auth, body);
}

export function fetchChatMessages(
        auth: BlueBubblesAuthState,
        guid: string,
        options: {limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC";} = {}
): Promise<MessageQueryResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return fetchChatMessagesBff(guid, options);
        }
        return fetchChatMessagesDirect(auth, guid, options);
}

export function queryMessages(auth: BlueBubblesAuthState, payload: Record<string, unknown>): Promise<MessageQueryResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return queryMessagesBff(payload);
        }
        return queryMessagesDirect(auth, payload);
}

export function sendTextMessage(auth: BlueBubblesAuthState, payload: Record<string, unknown>): Promise<MessageSendResponse> {
        if(resolveTransportMode(auth) === "bff") {
                return sendTextMessageBff(payload);
        }
        return sendTextMessageDirect(auth, payload);
}

export function downloadAttachment(
        auth: BlueBubblesAuthState,
        guid: string,
        options: AttachmentDownloadOptions = {}
): Promise<Response> {
        if(resolveTransportMode(auth) === "bff") {
                return downloadAttachmentBff(guid, options);
        }
        return downloadAttachmentDirect(auth, guid, options);
}

export function downloadAttachmentThumbnail(
        auth: BlueBubblesAuthState,
        guid: string,
        options: AttachmentDownloadOptions = {}
): Promise<Response> {
        if(resolveTransportMode(auth) === "bff") {
                return downloadAttachmentThumbnailBff(guid, options);
        }
        return downloadAttachmentThumbnailDirect(auth, guid, options);
}

export function createRealtimeChannel(
        auth: BlueBubblesAuthState,
        options: BlueBubblesRealtimeChannelOptions = {}
): BlueBubblesRealtimeChannelLike {
        if(resolveTransportMode(auth) === "bff") {
                return new BffRealtimeChannel(options);
        }
        return new BlueBubblesRealtimeChannel(auth, options);
}

export function resolveAttachmentUploadTarget(auth: BlueBubblesAuthState): AttachmentUploadTarget {
        if(resolveTransportMode(auth) === "bff") {
                const csrfToken = getBffCsrfToken();
                if(!csrfToken) {
                        throw new Error("Upload attachment failed: BFF CSRF token is missing.");
                }
                return {
                        url: BFF_PROXY_ROUTES.messageAttachment,
                        headers: {
                                [BFF_CSRF_HEADER]: csrfToken
                        },
                        withCredentials: true
                };
        }
        const path = appendLegacyAuthParams(auth, "/api/v1/message/attachment");
        const normalizedServer = auth.serverUrl.replace(/\/$/, "");
        return {
                url: `${normalizedServer}${path}`,
                headers: {
                        "Authorization": `Bearer ${auth.accessToken}`
                }
        };
}

export function isBlueBubblesTransportApiError(error: unknown): error is BlueBubblesApiError | BffApiError {
        return error instanceof BlueBubblesApiError || error instanceof BffApiError;
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
