import {
        BffSessionStatusData,
        BffSessionStatusResponse,
        BFF_SESSION_ROUTES
} from "./contracts";
import {requestBffJson} from "./api";

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
        return response.data;
}

export async function fetchBffSessionStatus(): Promise<BffSessionStatusData> {
        const response = await requestBffJson<BffSessionStatusResponse>(BFF_SESSION_ROUTES.status, {
                method: "GET"
        });
        return response.data;
}

export async function logoutBffSession(): Promise<void> {
        await requestBffJson<{data: {success: boolean;};}>(BFF_SESSION_ROUTES.logout, {
                method: "POST"
        });
}
