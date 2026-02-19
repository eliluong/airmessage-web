import {BffErrorEnvelope, BFF_PROXY_ROUTES} from "./contracts";
import {
        ChatCountResponse,
        ChatQueryPageResponse,
        ChatQueryResponse,
        MessageQueryResponse,
        ServerFeaturesResponse,
        ServerMetadataResponse,
        SingleChatResponse
} from "../types";

export interface BffRequestOptions extends RequestInit {
        skipJsonContentType?: boolean;
}

export class BffApiError extends Error {
        public readonly status: number;
        public readonly code?: string;
        public readonly requestId?: string;
        public readonly retriable?: boolean;

        constructor(message: string, options: {
                status: number;
                code?: string;
                requestId?: string;
                retriable?: boolean;
        }) {
                super(message);
                this.name = "BffApiError";
                this.status = options.status;
                this.code = options.code;
                this.requestId = options.requestId;
                this.retriable = options.retriable;
        }
}

export async function requestBffJson<T>(path: string, init: BffRequestOptions = {}): Promise<T> {
        const response = await fetch(path, {
                ...init,
                credentials: "include",
                headers: {
                        ...(init.skipJsonContentType ? {} : {"Content-Type": "application/json"}),
                        ...(init.headers ?? {})
                }
        });

        if(!response.ok) {
                await throwBffError(response);
        }

        try {
                return await response.json() as T;
        } catch {
                throw new BffApiError("The BFF returned an invalid response.", {
                        status: 502,
                        code: "BFF_INVALID_RESPONSE"
                });
        }
}

async function throwBffError(response: Response): Promise<never> {
        let parsedError: BffErrorEnvelope | undefined;
        try {
                parsedError = await response.json() as BffErrorEnvelope;
        } catch {
                parsedError = undefined;
        }

        const message = parsedError?.error?.message ?? response.statusText ?? `Request failed with status ${response.status}`;
        throw new BffApiError(message, {
                status: response.status,
                code: parsedError?.error?.code,
                requestId: parsedError?.error?.requestId,
                retriable: parsedError?.error?.retriable
        });
}

interface FetchChatsOptions {
        limit?: number;
        offset?: number;
        signal?: AbortSignal;
}

interface FetchChatCountOptions {
        signal?: AbortSignal;
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

        return {
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

export async function pingServer(): Promise<void> {
        await requestBffJson<unknown>(BFF_PROXY_ROUTES.generalPing, {method: "GET"});
}

export async function fetchServerMetadata(): Promise<ServerMetadataResponse> {
        const infoResponse = await requestBffJson<unknown>(BFF_PROXY_ROUTES.serverInfo, {method: "GET"});
        const info = normalizeServerInfoPayload(infoResponse);

        try {
                const featuresResponse = await requestBffJson<unknown>(BFF_PROXY_ROUTES.serverFeatures, {method: "GET"});
                const features = normalizeServerFeaturesPayload(featuresResponse);
                return {
                        ...info,
                        private_api: features.private_api ?? info.private_api ?? false,
                        helper_connected: features.helper_connected ?? info.helper_connected ?? false,
                        features
                };
        } catch(error) {
                if(error instanceof BffApiError && (error.status === 404 || error.status === 501)) {
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

export function fetchChats(options: FetchChatsOptions & {offset: number;}): Promise<ChatQueryPageResponse>;
export function fetchChats(options?: FetchChatsOptions): Promise<ChatQueryResponse>;
export async function fetchChats(options: FetchChatsOptions = {}): Promise<ChatQueryResponse> {
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

        return requestBffJson<ChatQueryResponse>(BFF_PROXY_ROUTES.chatQuery, {
                method: "POST",
                body: JSON.stringify(body),
                signal: options.signal
        });
}

export function fetchChatCount(options: FetchChatCountOptions = {}): Promise<ChatCountResponse> {
        return requestBffJson<ChatCountResponse>(BFF_PROXY_ROUTES.chatCount, {
                method: "GET",
                signal: options.signal
        });
}

export async function fetchChat(guid: string): Promise<SingleChatResponse> {
        const params = new URLSearchParams();
        params.append("with", "participants");
        params.append("with", "lastmessage");
        const path = BFF_PROXY_ROUTES.chatByGuid.replace(":guid", encodeURIComponent(guid));
        return requestBffJson<SingleChatResponse>(`${path}?${params.toString()}`, {method: "GET"});
}

export async function fetchChatMessages(
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

        const path = BFF_PROXY_ROUTES.chatMessagesByGuid.replace(":guid", encodeURIComponent(guid));
        return requestBffJson<MessageQueryResponse>(`${path}?${params.toString()}`, {method: "GET"});
}

export function queryMessages(payload: Record<string, unknown>): Promise<MessageQueryResponse> {
        return requestBffJson<MessageQueryResponse>(BFF_PROXY_ROUTES.messageQuery, {
                method: "POST",
                body: JSON.stringify(payload)
        });
}
