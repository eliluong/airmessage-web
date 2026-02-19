import {BffHttpError} from "../errors";
import {buildUpstreamUrl} from "../security/urlValidation";
import {BffSessionRecord} from "../session/types";

type QueryValue = string | number | boolean | undefined | null | string[] | number[] | boolean[];

interface UpstreamJsonRequest {
        method: "GET" | "POST";
        path: string;
        query?: Record<string, QueryValue>;
        body?: unknown;
}

interface UpstreamErrorPayload {
        message?: string;
        error?: string | {message?: string; code?: string | number};
        code?: string | number;
}

export async function requestUpstreamJson<T>(session: BffSessionRecord, request: UpstreamJsonRequest): Promise<T> {
        const url = buildUpstreamUrl(session.serverUrl, request.path);
        applyQuery(url.searchParams, request.query);
        injectSessionAuth(url.searchParams, session);

        const headers = new Headers();
        if(session.authMode === "modern-token") {
                const token = session.accessToken;
                if(!token) {
                        throw new BffHttpError({
                                code: "BFF_SESSION_INVALID",
                                status: 401,
                                message: "Session token is missing."
                        });
                }
                headers.set("Authorization", `Bearer ${token}`);
        }

        if(request.body !== undefined) {
                headers.set("Content-Type", "application/json");
        }

        let response: Response;
        try {
                response = await fetch(url.toString(), {
                        method: request.method,
                        headers,
                        body: request.body !== undefined ? JSON.stringify(request.body) : undefined
                });
        } catch(error) {
                throw new BffHttpError({
                        code: "BFF_UPSTREAM_UNREACHABLE",
                        status: 502,
                        message: error instanceof Error ? error.message : "Unable to reach upstream server.",
                        retriable: true
                });
        }

        if(!response.ok) {
                throw await buildProxyError(response);
        }

        const payload = await readResponsePayload(response);
        if(payload === undefined) {
                throw new BffHttpError({
                        code: "BFF_UPSTREAM_INVALID_RESPONSE",
                        status: 502,
                        message: "Upstream returned an invalid JSON payload."
                });
        }
        return payload as T;
}

export function toUpstreamQuery(rawQuery: unknown): Record<string, QueryValue> | undefined {
        if(!rawQuery || typeof rawQuery !== "object") return undefined;

        const output: Record<string, QueryValue> = {};
        const entries = Object.entries(rawQuery as Record<string, unknown>);
        for(const [key, value] of entries) {
                if(value === undefined) continue;
                const parsed = normalizeQueryValue(key, value);
                if(parsed !== undefined) {
                        output[key] = parsed;
                }
        }
        return output;
}

function normalizeQueryValue(key: string, value: unknown): QueryValue {
        if(value === undefined || value === null) return undefined;
        if(typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                return value;
        }
        if(Array.isArray(value)) {
                if(value.every((entry) => typeof entry === "string")) {
                        return value as string[];
                }
                if(value.every((entry) => typeof entry === "number")) {
                        return value as number[];
                }
                if(value.every((entry) => typeof entry === "boolean")) {
                        return value as boolean[];
                }
        }

        throw new BffHttpError({
                code: "BFF_INVALID_QUERY",
                status: 400,
                message: `Unsupported query parameter type for "${key}".`
        });
}

function applyQuery(params: URLSearchParams, query?: Record<string, QueryValue>): void {
        if(!query) return;
        for(const [key, value] of Object.entries(query)) {
                if(value === undefined || value === null) continue;

                if(Array.isArray(value)) {
                        for(const entry of value) {
                                params.append(key, String(entry));
                        }
                        continue;
                }

                params.append(key, String(value));
        }
}

function injectSessionAuth(params: URLSearchParams, session: BffSessionRecord): void {
        if(session.authMode !== "legacy-guid") return;
        const guid = session.legacyPasswordGuid;
        if(!guid) {
                throw new BffHttpError({
                        code: "BFF_SESSION_INVALID",
                        status: 401,
                        message: "Legacy session credentials are missing."
                });
        }

        params.set("password", guid);
        if(session.deviceName) {
                params.set("device", session.deviceName);
        }
}

async function buildProxyError(response: Response): Promise<BffHttpError> {
        const payload = await readResponsePayload(response) as UpstreamErrorPayload | undefined;
        const upstreamMessage = readUpstreamErrorMessage(payload);

        if(response.status === 401 || response.status === 403) {
                return new BffHttpError({
                        code: "BFF_UPSTREAM_UNAUTHORIZED",
                        status: 401,
                        message: upstreamMessage ?? "Upstream authentication is no longer valid.",
                        details: payload
                });
        }

        return new BffHttpError({
                code: "BFF_UPSTREAM_ERROR",
                status: response.status >= 400 && response.status < 500 ? 400 : 502,
                message: upstreamMessage ?? `Upstream request failed with status ${response.status}.`,
                retriable: response.status >= 500,
                details: payload
        });
}

async function readResponsePayload(response: Response): Promise<unknown | undefined> {
        try {
                return await response.json();
        } catch {
                return undefined;
        }
}

function readUpstreamErrorMessage(payload: UpstreamErrorPayload | undefined): string | undefined {
        if(!payload) return undefined;
        if(typeof payload.message === "string" && payload.message.trim().length > 0) {
                return payload.message;
        }
        if(typeof payload.error === "string" && payload.error.trim().length > 0) {
                return payload.error;
        }
        if(payload.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
                return payload.error.message;
        }
        return undefined;
}
