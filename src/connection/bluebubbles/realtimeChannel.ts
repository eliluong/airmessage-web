import {io, ManagerOptions, Socket, SocketOptions} from "socket.io-client";
import {BlueBubblesAuthState} from "./session";

const SOCKET_TRANSPORTS: Array<"websocket" | "polling"> = ["websocket", "polling"];

export const BLUEBUBBLES_REALTIME_MIN_RECONNECTION_DELAY_MS = 1000;
export const BLUEBUBBLES_REALTIME_MAX_RECONNECTION_DELAY_MS = 5000;

export type BlueBubblesRealtimeEventName = "new-message" | "updated-message";
export type BlueBubblesRealtimeConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface BlueBubblesRealtimeChannelOptions {
        onStateChange?: (state: BlueBubblesRealtimeConnectionState, details?: unknown) => void;
        onError?: (error: Error) => void;
        reconnectionDelayMs?: number;
        reconnectionDelayMaxMs?: number;
        maxReconnectAttempts?: number;
        connectTimeoutMs?: number;
}

export type BlueBubblesRealtimeListener = (payload: unknown) => void;

interface BlueBubblesRealtimeSocketTarget {
        origin: string;
        path: string;
}

type BlueBubblesSocketIoOptions = Partial<ManagerOptions & SocketOptions> & {
        allowEIO3?: boolean;
};

export default class BlueBubblesRealtimeChannel {
        private socket: Socket | undefined;
        private connectionState: BlueBubblesRealtimeConnectionState = "idle";
        private isIntentionalDisconnect = false;
        private readonly listeners = new Map<BlueBubblesRealtimeEventName, Set<BlueBubblesRealtimeListener>>([
                ["new-message", new Set<BlueBubblesRealtimeListener>()],
                ["updated-message", new Set<BlueBubblesRealtimeListener>()]
        ]);

        constructor(private readonly auth: BlueBubblesAuthState, private readonly options: BlueBubblesRealtimeChannelOptions = {}) {}

        public connect(): void {
                this.isIntentionalDisconnect = false;
                const socket = this.ensureSocket();
                this.setState("connecting");
                socket.connect();
        }

        public disconnect(): void {
                this.isIntentionalDisconnect = true;

                if(this.socket) {
                        this.socket.disconnect();
                        this.socket.removeAllListeners();
                        this.socket = undefined;
                }

                this.setState("disconnected");
        }

        public subscribe(eventName: BlueBubblesRealtimeEventName, listener: BlueBubblesRealtimeListener): () => void {
                const listeners = this.listeners.get(eventName);
                if(!listeners) {
                        throw new Error(`Unsupported realtime event: ${eventName}`);
                }

                listeners.add(listener);
                return () => listeners.delete(listener);
        }

        public get state(): BlueBubblesRealtimeConnectionState {
                return this.connectionState;
        }

        public isHealthy(): boolean {
                return this.connectionState === "connected";
        }

        private ensureSocket(): Socket {
                if(this.socket) {
                        return this.socket;
                }

                const socketTarget = resolveSocketTarget(this.auth.serverUrl);
                const socketGuid = normalizeSocketGuid(this.auth.socketGuid) ?? normalizeSocketGuid(this.auth.accessToken);
                if(!socketGuid) {
                        throw new Error("Missing socket guid credential for BlueBubbles realtime connection");
                }

                const connectionOptions: BlueBubblesSocketIoOptions = {
                        autoConnect: false,
                        transports: SOCKET_TRANSPORTS,
                        // Some BlueBubbles deployments still front older Socket.IO/Engine.IO stacks.
                        // Allowing EIO3 avoids silent "stuck connecting" behavior in those environments.
                        allowEIO3: true,
                        reconnection: true,
                        path: socketTarget.path,
                        timeout: this.options.connectTimeoutMs ?? 10000,
                        reconnectionDelay: this.options.reconnectionDelayMs ?? BLUEBUBBLES_REALTIME_MIN_RECONNECTION_DELAY_MS,
                        reconnectionDelayMax: this.options.reconnectionDelayMaxMs ?? BLUEBUBBLES_REALTIME_MAX_RECONNECTION_DELAY_MS,
                        query: {
                                guid: socketGuid
                        }
                };
                if(this.options.maxReconnectAttempts !== undefined) {
                        connectionOptions.reconnectionAttempts = Math.max(1, Math.floor(this.options.maxReconnectAttempts));
                }

                const socket = io(socketTarget.origin, connectionOptions as Partial<ManagerOptions & SocketOptions>);
                this.bindSocketListeners(socket);
                this.socket = socket;
                return socket;
        }

        private bindSocketListeners(socket: Socket): void {
                socket.on("connect", () => {
                        this.setState("connected");
                });

                socket.on("disconnect", (reason) => {
                        this.setState("disconnected", reason);
                });

                socket.on("connect_error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("Socket connect error", error);
                });

                socket.on("error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("Socket error", error);
                });

                socket.io.on("reconnect_attempt", (attempt: unknown) => {
                        this.setState("connecting", attempt);
                });

                socket.io.on("reconnect", (attempt: unknown) => {
                        this.setState("connected", attempt);
                });

                socket.io.on("reconnect_error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("Socket reconnect error", error);
                });

                socket.io.on("error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("Socket manager error", error);
                });

                socket.io.on("reconnect_failed", () => {
                        this.setState("error", "reconnect_failed");
                        this.emitError("Socket reconnect failed");
                });

                for(const eventName of this.listeners.keys()) {
                        socket.on(eventName, (payload: unknown) => {
                                const listeners = this.listeners.get(eventName);
                                if(!listeners || listeners.size === 0) return;
                                for(const listener of listeners) {
                                        listener(payload);
                                }
                        });
                }
        }

        private setState(state: BlueBubblesRealtimeConnectionState, details?: unknown): void {
                if(this.connectionState === state && details === undefined) {
                        return;
                }
                this.connectionState = state;

                if(this.isIntentionalDisconnect && state === "disconnected") {
                        this.options.onStateChange?.(state, "intentional");
                        return;
                }
                this.options.onStateChange?.(state, details);
        }

        private emitError(prefix: string, rawError?: unknown): void {
                const suffix = normalizeErrorSuffix(rawError);
                const message = suffix ? `${prefix}: ${suffix}` : prefix;
                this.options.onError?.(new Error(message));
        }
}

function normalizeErrorSuffix(rawError: unknown): string | undefined {
        if(rawError instanceof Error) return rawError.message;
        if(typeof rawError === "string") return rawError;
        if(rawError && typeof rawError === "object" && "message" in rawError) {
                const value = (rawError as {message?: unknown}).message;
                if(typeof value === "string") return value;
        }
        if(rawError === undefined || rawError === null) return undefined;
        try {
                return JSON.stringify(rawError);
        } catch {
                return String(rawError);
        }
}

function resolveSocketTarget(serverUrl: string): BlueBubblesRealtimeSocketTarget {
        const parsedUrl = new URL(serverUrl);
        const normalizedBasePath = parsedUrl.pathname.replace(/\/+$/, "");
        const pathPrefix = normalizedBasePath.length > 0 ? normalizedBasePath : "";
        const socketPath = `${pathPrefix}/socket.io`.replace(/\/{2,}/g, "/");

        return {
                origin: parsedUrl.origin,
                path: socketPath.startsWith("/") ? socketPath : `/${socketPath}`
        };
}

function normalizeSocketGuid(value: string | undefined): string | undefined {
        const normalized = value?.trim();
        return normalized && normalized.length > 0 ? normalized : undefined;
}
