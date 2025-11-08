export interface BlueBubblesAuthState {
        serverUrl: string;
        accessToken: string;
        refreshToken?: string;
        legacyPasswordAuth?: boolean;
        deviceName?: string;
}
