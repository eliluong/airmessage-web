import {
        BLUEBUBBLES_REALTIME_MAX_RECONNECTION_DELAY_MS,
        BLUEBUBBLES_REALTIME_MIN_RECONNECTION_DELAY_MS,
        BlueBubblesRealtimeChannelOptions,
        BlueBubblesRealtimeConnectionState,
        BlueBubblesRealtimeEventName,
        BlueBubblesRealtimeListener
} from "../realtimeChannel";
import {io, ManagerOptions, Socket, SocketOptions} from "socket.io-client";
import {BFF_REALTIME_STATE_EVENT, BffRealtimeStatePayload, BFF_SOCKET_ROUTE} from "./contracts";

const SOCKET_TRANSPORTS: Array<"websocket" | "polling"> = ["websocket", "polling"];

type BlueBubblesSocketIoOptions = Partial<ManagerOptions & SocketOptions> & {
        allowEIO3?: boolean;
};

export default class BffRealtimeChannel {
        private socket: Socket | undefined;
        private connectionState: BlueBubblesRealtimeConnectionState = "idle";
        private isIntentionalDisconnect = false;
        private readonly listeners = new Map<BlueBubblesRealtimeEventName, Set<BlueBubblesRealtimeListener>>([
                ["new-message", new Set<BlueBubblesRealtimeListener>()],
                ["updated-message", new Set<BlueBubblesRealtimeListener>()]
        ]);

        constructor(private readonly options: BlueBubblesRealtimeChannelOptions = {}) {}

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

                const connectionOptions: BlueBubblesSocketIoOptions = {
                        autoConnect: false,
                        transports: SOCKET_TRANSPORTS,
                        reconnection: true,
                        withCredentials: true,
                        path: BFF_SOCKET_ROUTE,
                        timeout: this.options.connectTimeoutMs ?? 10000,
                        reconnectionDelay: this.options.reconnectionDelayMs ?? BLUEBUBBLES_REALTIME_MIN_RECONNECTION_DELAY_MS,
                        reconnectionDelayMax: this.options.reconnectionDelayMaxMs ?? BLUEBUBBLES_REALTIME_MAX_RECONNECTION_DELAY_MS
                };
                if(this.options.maxReconnectAttempts !== undefined) {
                        connectionOptions.reconnectionAttempts = Math.max(1, Math.floor(this.options.maxReconnectAttempts));
                }

                const socket = io(undefined, connectionOptions as Partial<ManagerOptions & SocketOptions>);
                this.bindSocketListeners(socket);
                this.socket = socket;
                return socket;
        }

        private bindSocketListeners(socket: Socket): void {
                socket.on("connect", () => {
                        // Browser-to-BFF connect succeeded; wait for upstream state before declaring healthy.
                        this.setState("connecting", "bff-connected");
                });

                socket.on("disconnect", (reason) => {
                        this.setState("disconnected", reason);
                });

                socket.on("connect_error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("BFF realtime socket connect error", error);
                });

                socket.on("error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("BFF realtime socket error", error);
                });

                socket.io.on("reconnect_attempt", (attempt: unknown) => {
                        this.setState("connecting", attempt);
                });

                socket.io.on("reconnect", (attempt: unknown) => {
                        this.setState("connecting", attempt);
                });

                socket.io.on("reconnect_error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("BFF realtime socket reconnect error", error);
                });

                socket.io.on("error", (error: unknown) => {
                        this.setState("error", error);
                        this.emitError("BFF realtime socket manager error", error);
                });

                socket.io.on("reconnect_failed", () => {
                        this.setState("error", "reconnect_failed");
                        this.emitError("BFF realtime socket reconnect failed");
                });

                socket.on(BFF_REALTIME_STATE_EVENT, (payload: unknown) => {
                        const statePayload = parseRealtimeStatePayload(payload);
                        if(!statePayload) {
                                this.setState("error", "invalid-realtime-state-payload");
                                this.emitError("BFF realtime state payload was invalid", payload);
                                return;
                        }
                        if(statePayload.state === "error") {
                                this.emitError("BFF upstream realtime error", statePayload.details);
                        }
                        this.setState(statePayload.state, statePayload.details);
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

function parseRealtimeStatePayload(value: unknown): BffRealtimeStatePayload | undefined {
        if(!value || typeof value !== "object") return undefined;
        const rawState = (value as {state?: unknown}).state;
        if(rawState !== "connecting" && rawState !== "connected" && rawState !== "disconnected" && rawState !== "error") {
                return undefined;
        }

        return {
                state: rawState,
                ...(Object.prototype.hasOwnProperty.call(value, "details")
                        ? {details: (value as {details?: unknown}).details}
                        : {})
        };
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
