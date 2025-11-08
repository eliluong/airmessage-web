import {BlueBubblesAuthState} from "./session";
import {
        ApiErrorResponse,
        ChatCreateResponse,
        ChatQueryResponse,
        MessageQueryResponse,
        MessageSendResponse,
        ServerFeaturesResponse,
        ServerMetadataResponse,
        SingleChatResponse
} from "./types";

const API_ROOT = "/api/v1";

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

export async function fetchChats(auth: BlueBubblesAuthState): Promise<ChatQueryResponse> {
        return requestJson<ChatQueryResponse>(auth, "/chat/query", {
                method: "POST",
                body: JSON.stringify({
                        with: ["participants", "lastmessage"],
                        limit: 1000,
                        sort: "lastmessage"
                })
        });
}

export async function fetchChat(auth: BlueBubblesAuthState, guid: string): Promise<SingleChatResponse> {
        const params = new URLSearchParams();
        params.append("with", "participants");
        params.append("with", "lastmessage");
        return requestJson<SingleChatResponse>(auth, `/chat/${encodeURIComponent(guid)}?${params.toString()}`, {method: "GET"});
}

export async function createChat(auth: BlueBubblesAuthState, body: Record<string, unknown>): Promise<ChatCreateResponse> {
        return requestJson<ChatCreateResponse>(auth, "/chat/new", {
                method: "POST",
                body: JSON.stringify(body)
        });
}

export async function fetchChatMessages(auth: BlueBubblesAuthState, guid: string, options: {limit?: number; before?: number; after?: number;} = {}): Promise<MessageQueryResponse> {
        const params = new URLSearchParams();
        if(options.limit !== undefined) params.set("limit", String(options.limit));
        if(options.before !== undefined) params.set("before", String(options.before));
        if(options.after !== undefined) params.set("after", String(options.after));
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

export async function downloadAttachment(auth: BlueBubblesAuthState, guid: string, signal?: AbortSignal): Promise<Response> {
        const requestPath = appendLegacyAuthParams(auth, `${API_ROOT}/attachment/${encodeURIComponent(guid)}`);
        const response = await fetch(buildEndpoint(auth, requestPath), {
                method: "GET",
                headers: {
                        "Authorization": `Bearer ${auth.accessToken}`
                },
                signal
        });

        if(!response.ok) {
                await parseError(response);
        }

        return response;
}
