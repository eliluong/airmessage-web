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
}

export type BlueBubblesRealtimeListener = (payload: unknown) => void;

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

                const connectionOptions: Partial<ManagerOptions & SocketOptions> = {
                        autoConnect: false,
                        transports: SOCKET_TRANSPORTS,
                        reconnection: true,
                        reconnectionDelay: this.options.reconnectionDelayMs ?? BLUEBUBBLES_REALTIME_MIN_RECONNECTION_DELAY_MS,
                        reconnectionDelayMax: this.options.reconnectionDelayMaxMs ?? BLUEBUBBLES_REALTIME_MAX_RECONNECTION_DELAY_MS,
                        query: {
                                guid: this.auth.accessToken
                        }
                };
                if(this.options.maxReconnectAttempts !== undefined) {
                        connectionOptions.reconnectionAttempts = Math.max(1, Math.floor(this.options.maxReconnectAttempts));
                }

                const socket = io(this.auth.serverUrl, connectionOptions);
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
