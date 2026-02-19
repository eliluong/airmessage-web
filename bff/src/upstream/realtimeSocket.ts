import {io, ManagerOptions, Socket, SocketOptions} from "socket.io-client";
import {BffSessionRecord} from "../session/types";

export type UpstreamRealtimeEventName = "new-message" | "updated-message";
export type UpstreamRealtimeState = "connecting" | "connected" | "disconnected" | "error";

export interface UpstreamRealtimeStatePayload {
        state: UpstreamRealtimeState;
        details?: unknown;
}

interface UpstreamSocketTarget {
        origin: string;
        path: string;
}

type BlueBubblesSocketIoOptions = Partial<ManagerOptions & SocketOptions> & {
        allowEIO3?: boolean;
};

const UPSTREAM_SOCKET_CONNECT_TIMEOUT_MS = 10000;

export const UPSTREAM_REALTIME_EVENTS: UpstreamRealtimeEventName[] = ["new-message", "updated-message"];

export function createUpstreamRealtimeSocket(sessionRecord: BffSessionRecord): Socket {
        const socketTarget = resolveSocketTarget(sessionRecord.serverUrl);
        const socketGuid = normalizeSocketGuid(sessionRecord.socketGuid) ?? normalizeSocketGuid(sessionRecord.accessToken);
        if(!socketGuid) {
                throw new Error("Session is missing socket guid credentials for realtime bridge.");
        }

        const connectionOptions: BlueBubblesSocketIoOptions = {
                autoConnect: false,
                forceNew: true,
                transports: ["websocket", "polling"],
                allowEIO3: true,
                reconnection: true,
                timeout: UPSTREAM_SOCKET_CONNECT_TIMEOUT_MS,
                path: socketTarget.path,
                query: {
                        guid: socketGuid
                }
        };

        return io(socketTarget.origin, connectionOptions as Partial<ManagerOptions & SocketOptions>);
}

export function resolveSocketTarget(serverUrl: string): UpstreamSocketTarget {
        const parsedUrl = new URL(serverUrl);
        const normalizedBasePath = parsedUrl.pathname.replace(/\/+$/, "");
        const pathPrefix = normalizedBasePath.length > 0 ? normalizedBasePath : "";
        const socketPath = `${pathPrefix}/socket.io`.replace(/\/{2,}/g, "/");

        return {
                origin: parsedUrl.origin,
                path: socketPath.startsWith("/") ? socketPath : `/${socketPath}`
        };
}

export function normalizeUpstreamStateDetails(rawValue: unknown): unknown {
        if(rawValue instanceof Error) {
                return rawValue.message;
        }
        if(rawValue && typeof rawValue === "object" && "message" in rawValue) {
                const messageValue = (rawValue as {message?: unknown;}).message;
                if(typeof messageValue === "string") {
                        return messageValue;
                }
        }
        if(rawValue === undefined || rawValue === null) {
                return undefined;
        }
        if(typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
                return rawValue;
        }

        try {
                return JSON.parse(JSON.stringify(rawValue));
        } catch {
                return String(rawValue);
        }
}

function normalizeSocketGuid(value: string | undefined): string | undefined {
        const normalized = value?.trim();
        return normalized && normalized.length > 0 ? normalized : undefined;
}
