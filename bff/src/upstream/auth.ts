import {randomUUID} from "node:crypto";
import {BffHttpError} from "../errors";
import {buildUpstreamUrl, normalizeServerUrl} from "../security/urlValidation";
import {BffSessionRecord} from "../session/types";
import {generateCsrfToken} from "../session/csrf";

type AuthAction = "login" | "register";

interface AuthenticateInput {
        serverUrl: string;
        password: string;
        deviceName?: string;
        action: AuthAction;
}

interface UpstreamAuthPayload {
        token?: string;
        accessToken?: string;
        access_token?: string;
        socketGuid?: string;
        socket_guid?: string;
        guid?: string;
        guidAuthKey?: string;
        guid_auth_key?: string;
        refreshToken?: string;
        refresh_token?: string;
        expiresIn?: number;
        expires_in?: number;
        expiresAt?: number;
        expires_at?: number;
}

interface UpstreamErrorPayload {
        message?: string;
        error?: string | {message?: string; code?: string | number};
        code?: string | number;
}

interface ModernAuthResult {
        accessToken: string;
        socketGuid?: string;
        refreshToken?: string;
        expiresAt?: number;
}

export interface SessionLoginRequest {
        serverUrl: string;
        password: string;
        deviceName?: string;
        action?: AuthAction;
}

export function sanitizeSessionLoginRequest(rawBody: unknown): AuthenticateInput {
        if(!rawBody || typeof rawBody !== "object") {
                throw new BffHttpError({
                        code: "BFF_INVALID_LOGIN_PAYLOAD",
                        status: 400,
                        message: "Invalid login payload."
                });
        }

        const body = rawBody as Record<string, unknown>;
        const serverUrl = typeof body.serverUrl === "string" ? body.serverUrl : "";
        const password = typeof body.password === "string" ? body.password : "";
        const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : undefined;
        const action = body.action === "register" ? "register" : "login";

        if(password.trim().length === 0) {
                throw new BffHttpError({
                        code: "BFF_INVALID_LOGIN_PAYLOAD",
                        status: 400,
                        message: "A password is required."
                });
        }

        return {
                serverUrl: normalizeServerUrl(serverUrl),
                password: password.trim(),
                deviceName: deviceName && deviceName.length > 0 ? deviceName : undefined,
                action
        };
}

export async function authenticateUpstream(input: AuthenticateInput): Promise<BffSessionRecord> {
        const now = Date.now();
        const modernAuthResult = await authenticateModern(input);

        if(modernAuthResult) {
                return {
                        id: randomUUID(),
                        createdAt: now,
                        updatedAt: now,
                        serverUrl: input.serverUrl,
                        deviceName: input.deviceName,
                        authMode: "modern-token",
                        csrfToken: generateCsrfToken(),
                        accessToken: modernAuthResult.accessToken,
                        refreshToken: modernAuthResult.refreshToken,
                        expiresAt: modernAuthResult.expiresAt,
                        socketGuid: modernAuthResult.socketGuid
                };
        }

        if(input.action === "register") {
                throw new BffHttpError({
                        code: "BFF_REGISTER_UNSUPPORTED",
                        status: 400,
                        message: "The upstream server does not support device registration endpoints."
                });
        }

        const legacyAuthenticated = await probeLegacyAuth(input.serverUrl, input.password, input.deviceName);
        if(!legacyAuthenticated) {
                throw new BffHttpError({
                        code: "BFF_AUTH_UNSUPPORTED",
                        status: 400,
                        message: "The upstream server did not expose a supported authentication flow."
                });
        }

        return {
                id: randomUUID(),
                createdAt: now,
                updatedAt: now,
                serverUrl: input.serverUrl,
                deviceName: input.deviceName,
                authMode: "legacy-guid",
                csrfToken: generateCsrfToken(),
                legacyPasswordGuid: input.password,
                socketGuid: input.password
        };
}

function getAuthEndpoints(action: AuthAction): string[] {
        if(action === "register") {
                return ["/api/v1/auth/register", "/api/v1/register"];
        }
        return ["/api/v1/auth/login", "/api/v1/login"];
}

async function authenticateModern(input: AuthenticateInput): Promise<ModernAuthResult | undefined> {
        const payload: Record<string, unknown> = {
                password: input.password
        };
        if(input.deviceName) {
                payload.device = input.deviceName;
        }

        const endpoints = getAuthEndpoints(input.action);
        for(const endpoint of endpoints) {
                const response = await fetchUpstream(input.serverUrl, endpoint, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify(payload)
                });

                if(response.status === 404) {
                        continue;
                }

                if(!response.ok) {
                        throw await buildAuthError(response, endpoint);
                }

                const payloadJsonRaw = await parseJsonBody(response);
                if(!payloadJsonRaw || typeof payloadJsonRaw !== "object") {
                        throw new BffHttpError({
                                code: "BFF_UPSTREAM_AUTH_INVALID",
                                status: 502,
                                message: "The upstream auth response was not valid JSON."
                        });
                }

                const payloadJson = payloadJsonRaw as UpstreamAuthPayload;
                const accessToken = payloadJson.accessToken ?? payloadJson.access_token ?? payloadJson.token;
                if(!accessToken) {
                        throw new BffHttpError({
                                code: "BFF_UPSTREAM_AUTH_INVALID",
                                status: 502,
                                message: "The upstream auth response did not include an access token."
                        });
                }

                const socketGuid = normalizeString(
                        payloadJson.socketGuid
                        ?? payloadJson.socket_guid
                        ?? payloadJson.guid
                        ?? payloadJson.guidAuthKey
                        ?? payloadJson.guid_auth_key
                        ?? input.password
                );
                const refreshToken = normalizeString(payloadJson.refreshToken ?? payloadJson.refresh_token);
                const expiresAt = computeExpiresAt(payloadJson);

                return {
                        accessToken,
                        socketGuid,
                        refreshToken,
                        expiresAt
                };
        }

        return undefined;
}

async function probeLegacyAuth(serverUrl: string, password: string, deviceName?: string): Promise<boolean> {
        const endpoints = ["/api/v1/ping", "/api/v1/server/info"];
        for(const endpoint of endpoints) {
                const params = new URLSearchParams();
                params.set("password", password);
                if(deviceName) {
                        params.set("device", deviceName);
                }
                const path = `${endpoint}?${params.toString()}`;

                const response = await fetchUpstream(serverUrl, path, {
                        method: "GET"
                });

                if(response.status === 404) {
                        continue;
                }

                if(response.ok) {
                        return true;
                }

                throw await buildAuthError(response, endpoint);
        }

        return false;
}

async function fetchUpstream(serverUrl: string, path: string, init: RequestInit): Promise<Response> {
        const url = buildUpstreamUrl(serverUrl, path);
        try {
                return await fetch(url.toString(), init);
        } catch(error) {
                throw new BffHttpError({
                        code: "BFF_UPSTREAM_UNREACHABLE",
                        status: 502,
                        message: error instanceof Error ? error.message : "Failed to reach upstream server.",
                        retriable: true
                });
        }
}

async function buildAuthError(response: Response, endpoint: string): Promise<BffHttpError> {
        const payload = await parseJsonBody(response) as UpstreamErrorPayload | undefined;
        const upstreamMessage = readUpstreamErrorMessage(payload);
        const message = upstreamMessage ?? `Upstream auth request ${endpoint} failed with status ${response.status}.`;

        const status = response.status === 401 || response.status === 403 ? 401 : 502;
        return new BffHttpError({
                code: "BFF_UPSTREAM_AUTH_FAILED",
                status,
                message,
                retriable: status >= 500,
                details: payload
        });
}

async function parseJsonBody(response: Response): Promise<unknown | undefined> {
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

function normalizeString(value: unknown): string | undefined {
        if(typeof value !== "string") return undefined;
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : undefined;
}

function computeExpiresAt(payload: UpstreamAuthPayload): number | undefined {
        const explicit = payload.expiresAt ?? payload.expires_at;
        if(typeof explicit === "number" && Number.isFinite(explicit)) {
                return explicit;
        }

        const expiresIn = payload.expiresIn ?? payload.expires_in;
        if(typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
                return Date.now() + expiresIn * 1000;
        }

        return undefined;
}
