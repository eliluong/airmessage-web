import {
        BffSessionStatusData,
        BffSessionStatusResponse,
        BFF_SESSION_ROUTES
} from "./contracts";
import {requestBffJson} from "./api";
import {setBffCsrfToken} from "./csrf";

export const BFF_SESSION_ACCESS_TOKEN_PLACEHOLDER = "__bff_session__";

export interface BffSessionLoginPayload {
        serverUrl: string;
        password: string;
        deviceName?: string;
        action?: "login" | "register";
}

export async function loginBffSession(payload: BffSessionLoginPayload): Promise<BffSessionStatusData> {
        const response = await requestBffJson<BffSessionStatusResponse>(BFF_SESSION_ROUTES.login, {
                method: "POST",
                body: JSON.stringify(payload)
        });
        setBffCsrfToken(response.data.authenticated ? response.data.csrfToken : undefined);
        return response.data;
}

export async function fetchBffSessionStatus(): Promise<BffSessionStatusData> {
        const response = await requestBffJson<BffSessionStatusResponse>(BFF_SESSION_ROUTES.status, {
                method: "GET"
        });
        setBffCsrfToken(response.data.authenticated ? response.data.csrfToken : undefined);
        return response.data;
}

export async function logoutBffSession(): Promise<void> {
        try {
                await requestBffJson<{data: {success: boolean;};}>(BFF_SESSION_ROUTES.logout, {
                        method: "POST",
                        includeCsrfToken: true
                });
        } finally {
                setBffCsrfToken(undefined);
        }
}
