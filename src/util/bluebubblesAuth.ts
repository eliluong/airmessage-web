export interface BlueBubblesAuthConfig {
        serverUrl: string;
        password: string;
        deviceName?: string;
}

export interface BlueBubblesAuthResult {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: number;
        legacyPasswordAuth?: boolean;
}

interface BlueBubblesRawError {
        error?: string | {message?: string; code?: string};
        message?: string;
        code?: string;
}

interface BlueBubblesRawAuthResponse {
        token?: string;
        accessToken?: string;
        access_token?: string;
        refreshToken?: string;
        refresh_token?: string;
        expiresIn?: number;
        expires_in?: number;
        expiresAt?: number;
        expires_at?: number;
}

export class BlueBubblesAuthError extends Error {
        readonly status?: number;
        readonly code?: string;
        constructor(message: string, options?: {status?: number; code?: string}) {
                super(message);
                this.name = "BlueBubblesAuthError";
                this.status = options?.status;
                this.code = options?.code;
        }
}

export class InvalidCertificateError extends BlueBubblesAuthError {
        constructor(message = "The server certificate could not be validated.") {
                super(message);
                this.name = "InvalidCertificateError";
        }
}

export class MissingPrivateApiError extends BlueBubblesAuthError {
        constructor(message = "The server does not have the required private API features enabled.") {
                super(message);
                this.name = "MissingPrivateApiError";
        }
}

function normalizeServerUrl(serverUrl: string): string {
        const trimmed = serverUrl.trim();
        if(trimmed.length === 0) {
                throw new BlueBubblesAuthError("A server URL is required.");
        }
        const url = new URL(trimmed);
        if(url.protocol !== "https:" && url.protocol !== "http:") {
                throw new BlueBubblesAuthError("The server URL must start with http:// or https://.");
        }
        if(url.protocol === "https:" && url.port) {
                const portNumber = Number(url.port);
                if(Number.isInteger(portNumber) && (portNumber === 80 || portNumber === 8080)) {
                        url.port = "";
                }
        }
        return url.toString().replace(/\/$/, "");
}

function buildEndpointUrl(serverUrl: string, path: string): string {
        const base = normalizeServerUrl(serverUrl);
        return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function isCertificateError(error: unknown): boolean {
        if(!(error instanceof TypeError)) return false;
        const message = error.message.toLowerCase();
        return message.includes("certificate") || message.includes("ssl") || message.includes("tls") || message.includes("failed to fetch");
}

async function parseError(response: Response): Promise<never> {
        let details: BlueBubblesRawError | undefined;
        try {
                details = await response.json() as BlueBubblesRawError;
        } catch {
                // Ignore parsing errors
        }

        const message =
                details?.error && typeof details.error === "string" ? details.error :
                        (details?.message ?? (typeof details?.error === "object" ? details.error.message : undefined)) ??
                        `Request failed with status ${response.status}`;

        const code = typeof details?.code === "string"
                ? details.code
                : (typeof details?.error === "object" ? details.error.code : undefined);

        if(code === "PRIVATE_API_REQUIRED" || message.toLowerCase().includes("private api")) {
                throw new MissingPrivateApiError();
        }

        throw new BlueBubblesAuthError(message, {status: response.status, code});
}

function parseAuthResponse(data: BlueBubblesRawAuthResponse): BlueBubblesAuthResult {
        const accessToken = data.accessToken ?? data.access_token ?? data.token;
        if(!accessToken) {
                throw new BlueBubblesAuthError("The server did not return an access token.");
        }

        const refreshToken = data.refreshToken ?? data.refresh_token;
        const expiresSeconds = data.expires_in ?? data.expiresIn;
        const expiresAt = data.expires_at ?? data.expiresAt ?? (expiresSeconds !== undefined ? Date.now() + expiresSeconds * 1000 : undefined);

        return {
                accessToken,
                refreshToken,
                expiresAt
        };
}

async function probeLegacyPasswordAuth(config: BlueBubblesAuthConfig): Promise<BlueBubblesAuthResult> {
        const params = new URLSearchParams();
        params.set("password", config.password);
        if(config.deviceName) {
                params.set("device", config.deviceName);
        }

        const endpoints = ["/api/v1/ping", "/api/v1/server/info"];
        let lastError: unknown;
        for(const endpoint of endpoints) {
                const query = params.toString();
                const url = `${endpoint}${query.length > 0 ? `?${query}` : ""}`;
                let response: Response;
                try {
                        response = await fetch(buildEndpointUrl(config.serverUrl, url), {method: "GET"});
                } catch(error) {
                        if(isCertificateError(error)) {
                                throw new InvalidCertificateError();
                        }
                        lastError = error;
                        continue;
                }

                if(response.status === 404) {
                        continue;
                }

                if(response.ok) {
                        return {
                                accessToken: config.password,
                                legacyPasswordAuth: true
                        };
                }

                try {
                        await parseError(response);
                } catch(error) {
                        lastError = error;
                        break;
                }
        }

        if(lastError instanceof Error) {
                throw lastError;
        }

        throw new BlueBubblesAuthError("The server did not support the authentication API.");
}

async function postAuth(serverUrl: string, path: string, payload: Record<string, unknown>): Promise<BlueBubblesAuthResult> {
        let response: Response;
        try {
                response = await fetch(buildEndpointUrl(serverUrl, path), {
                        method: "POST",
                        headers: {
                                "Content-Type": "application/json"
                        },
                        body: JSON.stringify(payload)
                });
        } catch(error) {
                if(isCertificateError(error)) {
                        throw new InvalidCertificateError();
                }
                throw new BlueBubblesAuthError((error as Error).message);
        }

        if(!response.ok) {
                await parseError(response);
        }

        let data: BlueBubblesRawAuthResponse;
        try {
                data = await response.json() as BlueBubblesRawAuthResponse;
        } catch(error) {
                throw new BlueBubblesAuthError("The server returned an invalid response.");
        }

        return parseAuthResponse(data);
}

export async function registerBlueBubblesDevice(config: BlueBubblesAuthConfig): Promise<BlueBubblesAuthResult> {
        const payload = {
                password: config.password,
                device: config.deviceName
        };

        // Prefer the auth namespace when available, but gracefully fall back.
        try {
                return await postAuth(config.serverUrl, "/api/v1/auth/register", payload);
        } catch(error) {
                if(error instanceof BlueBubblesAuthError && error.status === 404) {
                        return postAuth(config.serverUrl, "/api/v1/register", payload);
                }
                throw error;
        }
}

export async function loginBlueBubblesDevice(config: BlueBubblesAuthConfig): Promise<BlueBubblesAuthResult> {
        const payload = {
                password: config.password,
                device: config.deviceName
        };

        try {
                return await postAuth(config.serverUrl, "/api/v1/auth/login", payload);
        } catch(error) {
                if(error instanceof BlueBubblesAuthError && error.status === 404) {
                        try {
                                return await postAuth(config.serverUrl, "/api/v1/login", payload);
                        } catch(secondError) {
                                if(secondError instanceof BlueBubblesAuthError && secondError.status === 404) {
                                        return probeLegacyPasswordAuth(config);
                                }
                                throw secondError;
                        }
                }
                throw error;
        }
}

export async function refreshBlueBubblesToken(serverUrl: string, refreshToken: string): Promise<BlueBubblesAuthResult> {
        const payload = {refreshToken};

        try {
                return await postAuth(serverUrl, "/api/v1/auth/refresh", payload);
        } catch(error) {
                if(error instanceof BlueBubblesAuthError && error.status === 404) {
                        return postAuth(serverUrl, "/api/v1/refresh", payload);
                }
                throw error;
        }
}

export function shouldRefreshToken(token: BlueBubblesAuthResult): boolean {
        if(token.legacyPasswordAuth) return false;
        if(token.expiresAt === undefined) return false;
        // Refresh when within 2 minutes of expiry
        return token.expiresAt - Date.now() < 2 * 60 * 1000;
}
