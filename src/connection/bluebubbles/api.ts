import {BlueBubblesAuthState} from "./session";
import {
        ApiErrorResponse,
        ChatCreateResponse,
        ChatCountResponse,
        ChatQueryPageResponse,
        ChatQueryResponse,
        MessageQueryResponse,
        MessageSendResponse,
        ServerFeaturesResponse,
        ServerMetadataResponse,
        SingleChatResponse
} from "./types";

const API_ROOT = "/api/v1";
const CHAT_QUERY_TIMEOUT_MS = 20_000;
const CHAT_QUERY_MAX_ATTEMPTS = 2;
const CHAT_QUERY_RETRY_DELAY_MS = 250;

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

interface RequestRetryOptions {
        maxAttempts?: number;
        delayMs?: number;
}

interface RequestJsonOptions extends RequestInit {
        timeoutMs?: number;
        retry?: RequestRetryOptions;
}

function isAbortError(error: unknown): boolean {
        return error instanceof DOMException && error.name === "AbortError";
}

function isRetryableNetworkError(error: unknown, upstreamSignal?: AbortSignal): boolean {
        if(upstreamSignal?.aborted) return false;
        if(error instanceof BlueBubblesApiError) return false;
        if(isAbortError(error)) return true;
        return error instanceof TypeError;
}

async function sleep(delayMs: number): Promise<void> {
        if(delayMs <= 0) return;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildRequestSignal(
        upstreamSignal: AbortSignal | undefined,
        timeoutMs: number | undefined
): {signal: AbortSignal | undefined; cleanup: () => void} {
        if(timeoutMs === undefined) {
                return {signal: upstreamSignal, cleanup: () => undefined};
        }

        const timeoutController = new AbortController();
        const timeoutID = setTimeout(() => timeoutController.abort(), timeoutMs);
        const handleUpstreamAbort = () => timeoutController.abort();

        if(upstreamSignal) {
                if(upstreamSignal.aborted) {
                        timeoutController.abort();
                } else {
                        upstreamSignal.addEventListener("abort", handleUpstreamAbort);
                }
        }

        return {
                signal: timeoutController.signal,
                cleanup: () => {
                        clearTimeout(timeoutID);
                        upstreamSignal?.removeEventListener("abort", handleUpstreamAbort);
                }
        };
}

async function requestJsonOnce<T>(auth: BlueBubblesAuthState, path: string, init: RequestJsonOptions = {}): Promise<T> {
        const {timeoutMs, retry: _retry, ...requestInit} = init;
        const requestPath = appendLegacyAuthParams(auth, `${API_ROOT}${path}`);
        const upstreamSignal = requestInit.signal ?? undefined;
        const {signal, cleanup} = buildRequestSignal(upstreamSignal, timeoutMs);

        try {
                const response = await fetch(buildEndpoint(auth, requestPath), {
                        ...requestInit,
                        signal,
                        headers: {
                                "Authorization": `Bearer ${auth.accessToken}`,
                                "Content-Type": "application/json",
                                ...(requestInit.headers ?? {})
                        }
                });

                if(!response.ok) {
                        await parseError(response);
                }

                return response.json() as Promise<T>;
        } finally {
                cleanup();
        }
}

async function requestJson<T>(auth: BlueBubblesAuthState, path: string, init: RequestJsonOptions = {}): Promise<T> {
        const maxAttempts = Math.max(1, Math.floor(init.retry?.maxAttempts ?? 1));
        const retryDelayMs = Math.max(0, Math.floor(init.retry?.delayMs ?? 0));
        let lastError: unknown;

        for(let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                        return await requestJsonOnce<T>(auth, path, init);
                } catch(error) {
                        lastError = error;
                        const upstreamSignal = init.signal ?? undefined;
                        if(attempt >= maxAttempts || !isRetryableNetworkError(error, upstreamSignal)) {
                                throw error;
                        }
                        await sleep(retryDelayMs);
                }
        }

        throw lastError;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
        if(value && typeof value === "object") {
                return value as Record<string, unknown>;
        }
        return undefined;
}

function extractDataRecord(value: unknown): Record<string, unknown> | undefined {
        const record = asRecord(value);
        if(!record) return undefined;

        const nestedData = asRecord(record.data);
        return nestedData ?? record;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
        for(const key of keys) {
                const value = record[key];
                if(typeof value === "string") {
                        return value;
                }
        }
        return undefined;
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
        for(const key of keys) {
                const value = record[key];
                if(typeof value === "boolean") {
                        return value;
                }
        }
        return undefined;
}

function readNumberOrNull(record: Record<string, unknown>, ...keys: string[]): number | null | undefined {
        for(const key of keys) {
                const value = record[key];
                if(typeof value === "number" || value === null) {
                        return value;
                }
        }
        return undefined;
}

function readStringArray(record: Record<string, unknown>, ...keys: string[]): string[] | undefined {
        for(const key of keys) {
                const value = record[key];
                if(Array.isArray(value) && value.every((item) => typeof item === "string")) {
                        return value;
                }
        }
        return undefined;
}

function normalizeServerInfoPayload(rawPayload: unknown): ServerMetadataResponse {
        const payload = extractDataRecord(rawPayload);
        if(!payload) {
                throw new Error("The server returned invalid metadata.");
        }

        const normalized: ServerMetadataResponse = {
                computer_id: readString(payload, "computer_id", "computerId", "computerID") ?? "",
                os_version: readString(payload, "os_version", "osVersion") ?? "",
                server_version: readString(payload, "server_version", "serverVersion") ?? "",
                private_api: readBoolean(payload, "private_api", "privateApi") ?? false,
                helper_connected: readBoolean(payload, "helper_connected", "helperConnected") ?? false,
                proxy_service: readString(payload, "proxy_service", "proxyService") ?? "",
                detected_icloud: readString(payload, "detected_icloud", "detectedIcloud") ?? "",
                detected_imessage: readString(payload, "detected_imessage", "detectedImessage") ?? "",
                macos_time_sync: readNumberOrNull(payload, "macos_time_sync", "macosTimeSync") ?? null,
                local_ipv4s: readStringArray(payload, "local_ipv4s", "localIpv4s") ?? [],
                local_ipv6s: readStringArray(payload, "local_ipv6s", "localIpv6s") ?? []
        };

        return normalized;
}

function normalizeServerFeaturesPayload(rawPayload: unknown): ServerFeaturesResponse {
        const payload = extractDataRecord(rawPayload);
        if(!payload) {
                return {};
        }

        const privateApi = readBoolean(payload, "private_api", "privateApi");
        const helperConnected = readBoolean(payload, "helper_connected", "helperConnected");
        const deliveredReceipts = readBoolean(payload, "delivered_receipts", "deliveredReceipts");
        const readReceipts = readBoolean(payload, "read_receipts", "readReceipts");
        const reactions = readBoolean(payload, "reactions");
        const typingIndicators = readBoolean(payload, "typing_indicators", "typingIndicators");

        return {
                ...(payload as ServerFeaturesResponse),
                ...(privateApi !== undefined ? {private_api: privateApi} : {}),
                ...(helperConnected !== undefined ? {helper_connected: helperConnected} : {}),
                ...(deliveredReceipts !== undefined ? {delivered_receipts: deliveredReceipts} : {}),
                ...(readReceipts !== undefined ? {read_receipts: readReceipts} : {}),
                ...(reactions !== undefined ? {reactions} : {}),
                ...(typingIndicators !== undefined ? {typing_indicators: typingIndicators} : {})
        };
}

export async function fetchServerMetadata(auth: BlueBubblesAuthState): Promise<ServerMetadataResponse> {
        const infoResponse = await requestJson<unknown>(auth, "/server/info", {method: "GET"});
        const info = normalizeServerInfoPayload(infoResponse);

        try {
                const featuresResponse = await requestJson<unknown>(auth, "/server/features", {method: "GET"});
                const features = normalizeServerFeaturesPayload(featuresResponse);
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

export interface FetchChatsOptions {
        limit?: number;
        offset?: number;
        signal?: AbortSignal;
}

export function fetchChats(
        auth: BlueBubblesAuthState,
        options: FetchChatsOptions & {offset: number;}
): Promise<ChatQueryPageResponse>;
export function fetchChats(auth: BlueBubblesAuthState, options?: FetchChatsOptions): Promise<ChatQueryResponse>;
export async function fetchChats(auth: BlueBubblesAuthState, options: FetchChatsOptions = {}): Promise<ChatQueryResponse> {
        const body: Record<string, unknown> = {
                with: ["participants", "lastmessage"],
                sort: "lastmessage"
        };
        if(options.limit !== undefined) {
                body.limit = options.limit;
        } else {
                body.limit = 1000;
        }
        if(options.offset !== undefined) {
                body.offset = Math.max(0, Math.floor(options.offset));
        }
        return requestJson<ChatQueryResponse>(auth, "/chat/query", {
                method: "POST",
                body: JSON.stringify(body),
                signal: options.signal,
                timeoutMs: CHAT_QUERY_TIMEOUT_MS,
                retry: {
                        maxAttempts: CHAT_QUERY_MAX_ATTEMPTS,
                        delayMs: CHAT_QUERY_RETRY_DELAY_MS
                }
        });
}

export interface FetchChatCountOptions {
        signal?: AbortSignal;
}

export function fetchChatCount(
        auth: BlueBubblesAuthState,
        options: FetchChatCountOptions = {}
): Promise<ChatCountResponse> {
        return requestJson<ChatCountResponse>(auth, "/chat/count", {
                method: "GET",
                signal: options.signal
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
