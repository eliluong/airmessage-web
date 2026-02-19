export const BFF_SOCKET_PATH = "/bff/socket";
export const BFF_REALTIME_STATE_EVENT = "bff-realtime-state";

export type BffRealtimeState = "connecting" | "connected" | "disconnected" | "error";

export interface BffRealtimeStatePayload {
        state: BffRealtimeState;
        details?: unknown;
}
