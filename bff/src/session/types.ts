export type UpstreamAuthMode = "modern-token" | "legacy-guid";

export interface BffSessionRecord {
        id: string;
        createdAt: number;
        updatedAt: number;
        serverUrl: string;
        deviceName?: string;
        authMode: UpstreamAuthMode;
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        socketGuid?: string;
        legacyPasswordGuid?: string;
}

export interface SessionStatusPayload {
        authenticated: boolean;
        serverUrl?: string;
        deviceName?: string;
        authMode?: UpstreamAuthMode;
}
