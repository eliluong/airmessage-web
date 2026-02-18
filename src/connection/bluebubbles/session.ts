export interface BlueBubblesAuthState {
        serverUrl: string;
        accessToken: string;
        socketGuid?: string;
        refreshToken?: string;
        legacyPasswordAuth?: boolean;
        deviceName?: string;
}
