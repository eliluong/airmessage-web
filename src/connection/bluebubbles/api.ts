import {BlueBubblesAuthState} from "./session";
import {
        ApiErrorResponse,
        ChatCreateResponse,
        ChatQueryResponse,
        MessageQueryResponse,
        MessageSendResponse,
        ServerFeaturesResponse,
        ServerMetadataResponse,
        SingleChatResponse,
        SingleMessageResponse
} from "./types";

const API_ROOT = "/api/v1";

export type AttachmentQualityPreset = "good" | "better" | "best";

export interface AttachmentDownloadOptions {
        width?: number;
        height?: number;
        quality?: number | AttachmentQualityPreset;
        signal?: AbortSignal;
}

function buildEndpoint(auth: BlueBubblesAuthState, path: string): string {
        const normalized = auth.serverUrl.replace(/\/$/, "");
        return `${normalized}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function appendLegacyAuthParams(auth: BlueBubblesAuthState, path: string): string {
        if(!auth.legacyPasswordAuth) return path;
        const [basePath, queryString] = path.split("?");
        const params = new URLSearchParams(queryString ?? "");
        if(auth.accessToken) {
                params.set("password", auth.accessToken);
        }
        if(auth.deviceName) {
                params.set("device", auth.deviceName);
        }
        const serialized = params.toString();
        return serialized.length > 0 ? `${basePath}?${serialized}` : basePath;
}

export class BlueBubblesApiError extends Error {
        public readonly status: number;
        public readonly details: ApiErrorResponse | undefined;

        constructor(message: string, status: number, details?: ApiErrorResponse) {
                super(message);
                this.name = "BlueBubblesApiError";
                this.status = status;
                this.details = details;
        }
}

async function parseError(response: Response): Promise<never> {
        let details: ApiErrorResponse | undefined;
        try {
                details = await response.json() as ApiErrorResponse;
        } catch {
                // Ignore parse errors, we will fall back to status text
        }

        const message = details?.message || (typeof details?.error === "string" ? details.error : undefined) || response.statusText || `Request failed with status ${response.status}`;
        throw new BlueBubblesApiError(message, response.status, details);
}

async function requestJson<T>(auth: BlueBubblesAuthState, path: string, init?: RequestInit): Promise<T> {
        const requestPath = appendLegacyAuthParams(auth, `${API_ROOT}${path}`);
        const response = await fetch(buildEndpoint(auth, requestPath), {
                ...init,
                headers: {
                        "Authorization": `Bearer ${auth.accessToken}`,
                        "Content-Type": "application/json",
                        ...(init?.headers ?? {})
                }
        });

        if(!response.ok) {
                await parseError(response);
        }

        return response.json() as Promise<T>;
}

export async function fetchServerMetadata(auth: BlueBubblesAuthState): Promise<ServerMetadataResponse> {
        const info = await requestJson<ServerMetadataResponse>(auth, "/server/info", {method: "GET"});

        try {
                const features = await requestJson<ServerFeaturesResponse>(auth, "/server/features", {method: "GET"});
                return {
                        ...info,
                        private_api: features.private_api ?? info.private_api ?? false,
                        helper_connected: features.helper_connected ?? info.helper_connected ?? false,
                        features
                };
        } catch(error) {
                if(error instanceof BlueBubblesApiError && (error.status === 404 || error.status === 501)) {
                        return {
                                ...info,
                                private_api: info.private_api ?? false,
                                helper_connected: info.helper_connected ?? false,
                                features: undefined
                        };
                }
                throw error;
        }
}

export async function pingServer(auth: BlueBubblesAuthState): Promise<void> {
        await requestJson(auth, "/general/ping", {method: "GET"});
}

export async function fetchChats(auth: BlueBubblesAuthState, options: {limit?: number} = {}): Promise<ChatQueryResponse> {
        const body: Record<string, unknown> = {
                with: ["participants", "lastmessage", "lastmessage.attachments"],
                sort: "lastmessage"
        };
        if(options.limit !== undefined) {
                body.limit = options.limit;
        } else {
                body.limit = 1000;
        }
        return requestJson<ChatQueryResponse>(auth, "/chat/query", {
                method: "POST",
                body: JSON.stringify(body)
        });
}

export async function fetchChat(auth: BlueBubblesAuthState, guid: string): Promise<SingleChatResponse> {
        const params = new URLSearchParams();
        params.append("with", "participants");
        params.append("with", "lastmessage");
        params.append("with", "lastmessage.attachments");
        return requestJson<SingleChatResponse>(auth, `/chat/${encodeURIComponent(guid)}?${params.toString()}`, {method: "GET"});
}

export async function fetchMessage(auth: BlueBubblesAuthState, guid: string, options: {includeMetadata?: boolean} = {}): Promise<SingleMessageResponse> {
        const params = new URLSearchParams();
        params.append("with", "attachments");
        if(options.includeMetadata) {
                params.append("with", "attachment.metadata");
        }
        return requestJson<SingleMessageResponse>(
                auth,
                `/message/${encodeURIComponent(guid)}?${params.toString()}`,
                {method: "GET"}
        );
}

export async function createChat(auth: BlueBubblesAuthState, body: Record<string, unknown>): Promise<ChatCreateResponse> {
        return requestJson<ChatCreateResponse>(auth, "/chat/new", {
                method: "POST",
                body: JSON.stringify(body)
        });
}

export async function fetchChatMessages(
        auth: BlueBubblesAuthState,
        guid: string,
        options: {limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC";} = {}
): Promise<MessageQueryResponse> {
        const params = new URLSearchParams();
        if(options.limit !== undefined) params.set("limit", String(options.limit));
        if(options.before !== undefined) params.set("before", String(options.before));
        if(options.after !== undefined) params.set("after", String(options.after));
        if(options.sort !== undefined) params.set("sort", options.sort);
        params.append("with", "attachments");
        params.append("with", "message.attributedbody");
        params.append("with", "message.messageSummaryInfo");
        params.append("with", "message.payloadData");
        return requestJson<MessageQueryResponse>(auth, `/chat/${encodeURIComponent(guid)}/message?${params.toString()}`, {method: "GET"});
}

export async function queryMessages(auth: BlueBubblesAuthState, payload: Record<string, unknown>): Promise<MessageQueryResponse> {
        return requestJson<MessageQueryResponse>(auth, "/message/query", {
                method: "POST",
                body: JSON.stringify(payload)
        });
}

export async function sendTextMessage(auth: BlueBubblesAuthState, payload: Record<string, unknown>): Promise<MessageSendResponse> {
        return requestJson<MessageSendResponse>(auth, "/message/text", {
                method: "POST",
                body: JSON.stringify(payload)
        });
}

export async function downloadAttachment(
        auth: BlueBubblesAuthState,
        guid: string,
        options: AttachmentDownloadOptions = {}
): Promise<Response> {
        const params = new URLSearchParams();
        if(options.width !== undefined) {
                params.set("width", String(Math.max(1, Math.floor(options.width))));
        }
        if(options.height !== undefined) {
                params.set("height", String(Math.max(1, Math.floor(options.height))));
        }
        if(options.quality !== undefined) {
                if(typeof options.quality === "string") {
                        params.set("quality", options.quality);
                } else {
                        const clampedQuality = Math.min(100, Math.max(1, Math.floor(options.quality)));
                        params.set("quality", String(clampedQuality));
                }
        }

        const queryString = params.toString();
        const basePath = `${API_ROOT}/attachment/${encodeURIComponent(guid)}/download`;
        const requestPath = appendLegacyAuthParams(auth, queryString.length > 0 ? `${basePath}?${queryString}` : basePath);
        const response = await fetch(buildEndpoint(auth, requestPath), {
                method: "GET",
                headers: {
                        "Authorization": `Bearer ${auth.accessToken}`
                },
                signal: options.signal
        });

        if(!response.ok) {
                await parseError(response);
        }

        return response;
}

export async function downloadAttachmentThumbnail(
        auth: BlueBubblesAuthState,
        guid: string,
        options: AttachmentDownloadOptions = {}
): Promise<Response> {
        const defaulted: AttachmentDownloadOptions = {
                width: options.width ?? 512,
                quality: options.quality ?? "best",
                signal: options.signal,
                ...(options.height !== undefined ? {height: options.height} : {})
        };

        try {
                return await downloadAttachment(auth, guid, defaulted);
        } catch(error) {
                if(
                        defaulted.quality === "best"
                        && error instanceof BlueBubblesApiError
                        && error.status === 400
                ) {
                        const fallback: AttachmentDownloadOptions = {
                                ...defaulted,
                                quality: 70
                        };
                        return downloadAttachment(auth, guid, fallback);
                }
                throw error;
        }
}
