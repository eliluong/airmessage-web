export const BFF_API_PREFIX = "/bff";

export const BFF_SESSION_ROUTES = {
        login: `${BFF_API_PREFIX}/session/login`,
        status: `${BFF_API_PREFIX}/session/status`,
        logout: `${BFF_API_PREFIX}/session/logout`
} as const;

export const BFF_PROXY_ROUTES = {
        generalPing: `${BFF_API_PREFIX}/general/ping`,
        serverInfo: `${BFF_API_PREFIX}/server/info`,
        serverFeatures: `${BFF_API_PREFIX}/server/features`,
        chatQuery: `${BFF_API_PREFIX}/chat/query`,
        chatCount: `${BFF_API_PREFIX}/chat/count`,
        chatByGuid: `${BFF_API_PREFIX}/chat/:guid`,
        chatMessagesByGuid: `${BFF_API_PREFIX}/chat/:guid/message`,
        messageQuery: `${BFF_API_PREFIX}/message/query`,
        messageText: `${BFF_API_PREFIX}/message/text`,
        messageAttachment: `${BFF_API_PREFIX}/message/attachment`,
        attachmentDownloadByGuid: `${BFF_API_PREFIX}/attachment/:guid/download`
} as const;

export const BFF_SOCKET_ROUTE = `${BFF_API_PREFIX}/socket` as const;

export type BffSessionAuthMode = "modern-token" | "legacy-guid";

export interface BffSessionStatusData {
        authenticated: boolean;
        serverUrl?: string;
        deviceName?: string;
        authMode?: BffSessionAuthMode;
}

export interface BffSessionStatusResponse {
        data: BffSessionStatusData;
}

export interface BffErrorEnvelope {
        error: {
                code: string;
                message: string;
                requestId?: string;
                status?: number;
                retriable?: boolean;
        };
}
