import {BffHttpError} from "../errors";
import {recordUpstreamRequest, recordUpstreamTransportFailure} from "../observability/metrics";
import {buildUpstreamUrl} from "../security/urlValidation";
import {BffSessionRecord} from "../session/types";

type QueryValue = string | number | boolean | undefined | null | string[] | number[] | boolean[];

interface UpstreamRequest {
        method: "GET" | "POST";
        path: string;
        query?: Record<string, QueryValue>;
        body?: unknown;
        rawBody?: BodyInit | null;
        headers?: Record<string, string | undefined>;
        signal?: AbortSignal;
}

interface UpstreamErrorPayload {
        message?: string;
        error?: string | {message?: string; code?: string | number};
        code?: string | number;
}

export async function requestUpstreamJson<T>(session: BffSessionRecord, request: UpstreamRequest): Promise<T> {
        const response = await requestUpstreamResponse(session, request);
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

export async function requestUpstreamResponse(session: BffSessionRecord, request: UpstreamRequest): Promise<Response> {
        if(request.body !== undefined && request.rawBody !== undefined) {
                throw new BffHttpError({
                        code: "BFF_INVALID_UPSTREAM_REQUEST",
                        status: 500,
                        message: "Invalid upstream proxy request body configuration."
                });
        }

        const url = buildUpstreamUrl(session.serverUrl, request.path);
        applyQuery(url.searchParams, request.query);
        injectSessionAuth(url.searchParams, session);

        const headers = new Headers();
        applyHeaders(headers, request.headers);

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

        let requestBody: BodyInit | null | undefined;
        if(request.rawBody !== undefined) {
                requestBody = request.rawBody;
        } else if(request.body !== undefined) {
                if(!headers.has("Content-Type")) {
                        headers.set("Content-Type", "application/json");
                }
                requestBody = JSON.stringify(request.body);
        }

        const fetchInit: RequestInit = {
                method: request.method,
                headers,
                body: requestBody,
                signal: request.signal
        };
        if(requestBody !== undefined && requestBody !== null && requiresDuplex(requestBody)) {
                (fetchInit as RequestInit & {duplex: "half";}).duplex = "half";
        }

        const startedAt = process.hrtime.bigint();
        let response: Response;
        try {
                response = await fetch(url.toString(), fetchInit);
        } catch(error) {
                recordUpstreamTransportFailure(request.method, request.path);
                throw new BffHttpError({
                        code: "BFF_UPSTREAM_UNREACHABLE",
                        status: 502,
                        message: error instanceof Error ? error.message : "Unable to reach upstream server.",
                        retriable: true
                });
        }

        recordUpstreamRequest(
                request.method,
                request.path,
                response.status,
                computeDurationMs(startedAt)
        );

        if(!response.ok) {
                throw await buildProxyError(response);
        }

        return response;
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

function applyHeaders(headers: Headers, overrides?: Record<string, string | undefined>): void {
        if(!overrides) return;
        for(const [name, value] of Object.entries(overrides)) {
                if(value === undefined) continue;
                headers.set(name, value);
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

function requiresDuplex(body: BodyInit): boolean {
        if(typeof body === "string") return false;
        if(body instanceof URLSearchParams) return false;
        if(body instanceof ArrayBuffer) return false;
        if(ArrayBuffer.isView(body)) return false;
        if(body instanceof Blob) return false;
        if(body instanceof FormData) return false;

        if(typeof body !== "object" || body === null) return false;

        const streamLike = body as {getReader?: unknown; pipe?: unknown; on?: unknown};
        if(typeof streamLike.getReader === "function") return true;
        if(typeof streamLike.pipe === "function" || typeof streamLike.on === "function") return true;

        return false;
}

function computeDurationMs(startedAt: bigint): number {
        const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
        return Number(elapsedNanoseconds) / 1_000_000;
}
