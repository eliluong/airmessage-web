import {IncomingMessage, Server as HttpServer, ServerResponse} from "node:http";
import {Server as SocketIOServer, Socket as BrowserSocket} from "socket.io";
import {Socket as UpstreamSocket} from "socket.io-client";
import {BffConfig} from "../config";
import {logger} from "../observability/logger";
import {recordRealtimeReconnect} from "../observability/metrics";
import {BffSessionMiddleware} from "../session/middleware";
import {BffSessionRecord} from "../session/types";
import {
        createUpstreamRealtimeSocket,
        normalizeUpstreamStateDetails,
        UPSTREAM_REALTIME_EVENTS,
        UpstreamRealtimeEventName
} from "../upstream/realtimeSocket";
import {
        BFF_REALTIME_STATE_EVENT,
        BFF_SOCKET_PATH,
        BffRealtimeState,
        BffRealtimeStatePayload
} from "./contracts";

const BROWSER_ACK_TIMEOUT_MS = 5000;
const BROWSER_ACK_TIMEOUT_CODE = "BFF_BROWSER_ACK_TIMEOUT";

interface SocketRequestWithSession {
        session?: {
                bffSession?: BffSessionRecord;
        };
}

export function attachRealtimeBridge(
        httpServer: HttpServer,
        config: BffConfig,
        sessionMiddleware: BffSessionMiddleware
): SocketIOServer {
        const allowedOrigins = config.allowedOrigins?.filter((origin) => origin.trim().length > 0);
        const io = new SocketIOServer(httpServer, {
                path: BFF_SOCKET_PATH,
                transports: ["websocket", "polling"],
                ...(allowedOrigins && allowedOrigins.length > 0
                        ? {
                                cors: {
                                        origin: allowedOrigins,
                                        credentials: true,
                                        methods: ["GET", "POST"]
                                }
                        }
                        : {})
        });

        io.engine.use((request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => {
                sessionMiddleware(request as never, response as never, next as never);
        });

        io.use((browserSocket, next) => {
                const sessionRecord = getSocketSessionRecord(browserSocket);
                if(!sessionRecord) {
                        next(new Error("Not signed in."));
                        return;
                }
                next();
        });

        io.on("connection", (browserSocket) => {
                const sessionRecord = getSocketSessionRecord(browserSocket);
                if(!sessionRecord) {
                        emitRealtimeState(browserSocket, "error", "Not signed in.");
                        return;
                }

                let upstreamSocket: UpstreamSocket;
                try {
                        upstreamSocket = createUpstreamRealtimeSocket(sessionRecord);
                } catch(error) {
                        const details = normalizeUpstreamStateDetails(error);
                        emitRealtimeState(browserSocket, "error", details);
                        logger.warn({
                                socketId: browserSocket.id,
                                sessionId: sessionRecord.id,
                                details
                        }, "Failed to initialize upstream realtime socket");
                        return;
                }

                emitRealtimeState(browserSocket, "connecting");
                bindUpstreamLifecycle(browserSocket, upstreamSocket, sessionRecord);
                upstreamSocket.connect();
        });

        return io;
}

function bindUpstreamLifecycle(
        browserSocket: BrowserSocket,
        upstreamSocket: UpstreamSocket,
        sessionRecord: BffSessionRecord
): void {
        let bridgeClosed = false;

        const closeBridge = (): void => {
                if(bridgeClosed) return;
                bridgeClosed = true;

                upstreamSocket.removeAllListeners();
                upstreamSocket.io.removeAllListeners();
                upstreamSocket.disconnect();
        };

        browserSocket.on("disconnect", closeBridge);

        upstreamSocket.on("connect", () => {
                emitRealtimeState(browserSocket, "connected");
        });

        upstreamSocket.on("disconnect", (reason) => {
                emitRealtimeState(browserSocket, "disconnected", normalizeUpstreamStateDetails(reason));
        });

        upstreamSocket.on("connect_error", (error) => {
                recordRealtimeReconnect("connect_error");
                const details = normalizeUpstreamStateDetails(error);
                emitRealtimeState(browserSocket, "error", details);
                logger.warn({
                        socketId: browserSocket.id,
                        sessionId: sessionRecord.id,
                        details
                }, "Upstream realtime socket connect error");
        });

        upstreamSocket.on("error", (error) => {
                recordRealtimeReconnect("error");
                const details = normalizeUpstreamStateDetails(error);
                emitRealtimeState(browserSocket, "error", details);
                logger.warn({
                        socketId: browserSocket.id,
                        sessionId: sessionRecord.id,
                        details
                }, "Upstream realtime socket error");
        });

        upstreamSocket.io.on("reconnect_attempt", (attempt) => {
                recordRealtimeReconnect("reconnect_attempt");
                emitRealtimeState(browserSocket, "connecting", normalizeUpstreamStateDetails(attempt));
        });

        upstreamSocket.io.on("reconnect", (attempt) => {
                recordRealtimeReconnect("reconnect");
                emitRealtimeState(browserSocket, "connected", normalizeUpstreamStateDetails(attempt));
        });

        upstreamSocket.io.on("reconnect_error", (error) => {
                recordRealtimeReconnect("reconnect_error");
                const details = normalizeUpstreamStateDetails(error);
                emitRealtimeState(browserSocket, "error", details);
                logger.warn({
                        socketId: browserSocket.id,
                        sessionId: sessionRecord.id,
                        details
                }, "Upstream realtime socket reconnect error");
        });

        upstreamSocket.io.on("reconnect_failed", () => {
                recordRealtimeReconnect("reconnect_failed");
                emitRealtimeState(browserSocket, "error", "reconnect_failed");
                logger.warn({
                        socketId: browserSocket.id,
                        sessionId: sessionRecord.id
                }, "Upstream realtime socket reconnect failed");
        });

        for(const eventName of UPSTREAM_REALTIME_EVENTS) {
                upstreamSocket.on(eventName, (...eventArgs: unknown[]) => {
                        forwardEventToBrowser(browserSocket, eventName, eventArgs);
                });
        }
}

function forwardEventToBrowser(
        browserSocket: BrowserSocket,
        eventName: UpstreamRealtimeEventName,
        eventArgs: unknown[]
): void {
        const maybeAck = eventArgs.length > 0 ? eventArgs[eventArgs.length - 1] : undefined;
        if(typeof maybeAck !== "function") {
                browserSocket.emit(eventName, ...eventArgs);
                return;
        }

        const upstreamAck = maybeAck as (...args: unknown[]) => void;
        const payloadArgs = eventArgs.slice(0, -1);

        browserSocket.timeout(BROWSER_ACK_TIMEOUT_MS).emit(eventName, ...payloadArgs, (error: Error | null, ...ackArgs: unknown[]) => {
                if(error) {
                        logger.warn({
                                socketId: browserSocket.id,
                                eventName
                        }, "Timed out waiting for browser realtime event acknowledgement");
                        upstreamAck({error: BROWSER_ACK_TIMEOUT_CODE});
                        return;
                }
                upstreamAck(...ackArgs);
        });
}

function emitRealtimeState(
        browserSocket: BrowserSocket,
        state: BffRealtimeState,
        details?: unknown
): void {
        const payload: BffRealtimeStatePayload = details === undefined ? {state} : {state, details};
        browserSocket.emit(BFF_REALTIME_STATE_EVENT, payload);
}

function getSocketSessionRecord(browserSocket: BrowserSocket): BffSessionRecord | undefined {
        const requestWithSession = browserSocket.request as SocketRequestWithSession;
        return requestWithSession.session?.bffSession;
}
