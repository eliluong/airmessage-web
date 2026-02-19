/** @jest-environment node */
import {BffConfig} from "../../../bff/src/config";
import {attachRealtimeBridge} from "../../../bff/src/realtime/bridge";
import {BFF_REALTIME_STATE_EVENT, BFF_SOCKET_PATH} from "../../../bff/src/realtime/contracts";
import {BffSessionMiddleware} from "../../../bff/src/session/middleware";
import {BffSessionRecord} from "../../../bff/src/session/types";
import {createUpstreamRealtimeSocket} from "../../../bff/src/upstream/realtimeSocket";

type EngineMiddleware = (request: unknown, response: unknown, next: (error?: Error) => void) => void;
type AuthMiddleware = (socket: unknown, next: (error?: Error) => void) => void;
type ConnectionHandler = (socket: unknown) => void;
type SocketEventHandler = (...args: unknown[]) => void;

interface MockIoServerInstance {
        engine: {
                use: jest.Mock<void, [EngineMiddleware]>;
        };
        use: jest.Mock<MockIoServerInstance, [AuthMiddleware]>;
        on: jest.Mock<MockIoServerInstance, [string, ConnectionHandler]>;
        __engineMiddleware?: EngineMiddleware;
        __authMiddleware?: AuthMiddleware;
        __connectionHandler?: ConnectionHandler;
}

jest.mock(
        "socket.io",
        () => ({
                Server: jest.fn().mockImplementation(() => {
                        const instance: MockIoServerInstance = {
                                engine: {
                                        use: jest.fn((middleware: EngineMiddleware) => {
                                                instance.__engineMiddleware = middleware;
                                        })
                                },
                                use: jest.fn((middleware: AuthMiddleware) => {
                                        instance.__authMiddleware = middleware;
                                        return instance;
                                }),
                                on: jest.fn((eventName: string, handler: ConnectionHandler) => {
                                        if(eventName === "connection") {
                                                instance.__connectionHandler = handler;
                                        }
                                        return instance;
                                })
                        };
                        return instance;
                })
        }),
        {virtual: true}
);

jest.mock("../../../bff/src/upstream/realtimeSocket", () => {
        const actual = jest.requireActual("../../../bff/src/upstream/realtimeSocket");
        return {
                ...actual,
                createUpstreamRealtimeSocket: jest.fn()
        };
});

class FakeBrowserSocket {
        public id = "browser-socket-id";
        public request: {session?: {bffSession?: BffSessionRecord;};} = {};
        public emit = jest.fn<void, [string, ...unknown[]]>();
        public on = jest.fn((eventName: string, handler: SocketEventHandler) => {
                const handlers = this.handlers.get(eventName) ?? new Set<SocketEventHandler>();
                handlers.add(handler);
                this.handlers.set(eventName, handlers);
                return this;
        });
        public timeout = jest.fn((_timeoutMs: number) => ({
                emit: (eventName: string, ...args: unknown[]) => {
                        const ack = args[args.length - 1];
                        if(typeof ack === "function") {
                                (ack as (error: Error | null, response: unknown) => void)(null, this.nextAckPayload);
                        }
                        this.emit(eventName, ...args);
                }
        }));

        private readonly handlers = new Map<string, Set<SocketEventHandler>>();
        private nextAckPayload: unknown = {ok: true};

        public trigger(eventName: string, ...args: unknown[]): void {
                const handlers = this.handlers.get(eventName);
                if(!handlers) return;
                for(const handler of handlers) {
                        handler(...args);
                }
        }

        public setNextAckPayload(payload: unknown): void {
                this.nextAckPayload = payload;
        }
}

class FakeUpstreamSocket {
        public readonly connect = jest.fn();
        public readonly disconnect = jest.fn();
        public readonly removeAllListeners = jest.fn(() => {
                this.socketHandlers.clear();
                this.managerHandlers.clear();
        });
        public readonly on = jest.fn((eventName: string, handler: SocketEventHandler) => {
                const handlers = this.socketHandlers.get(eventName) ?? new Set<SocketEventHandler>();
                handlers.add(handler);
                this.socketHandlers.set(eventName, handlers);
                return this;
        });
        public readonly io = {
                on: (eventName: string, handler: SocketEventHandler) => {
                        const handlers = this.managerHandlers.get(eventName) ?? new Set<SocketEventHandler>();
                        handlers.add(handler);
                        this.managerHandlers.set(eventName, handlers);
                        return this.io;
                },
                removeAllListeners: () => {
                        this.managerHandlers.clear();
                }
        };

        private readonly socketHandlers = new Map<string, Set<SocketEventHandler>>();
        private readonly managerHandlers = new Map<string, Set<SocketEventHandler>>();

        public emitSocket(eventName: string, ...args: unknown[]): void {
                const handlers = this.socketHandlers.get(eventName);
                if(!handlers) return;
                for(const handler of handlers) {
                        handler(...args);
                }
        }
}

describe("BFF realtime bridge", () => {
        const mockedCreateUpstreamSocket = createUpstreamRealtimeSocket as unknown as jest.Mock;

        const config: BffConfig = {
                port: 3100,
                sessionSecret: "secret",
                sessionCookieName: "bff_session",
                sessionMaxAgeMs: 24 * 60 * 60 * 1000,
                sessionStoreMode: "memory",
                sessionStoreTtlSeconds: 24 * 60 * 60,
                redisKeyPrefix: "airmessage:bff:sess:",
                cookieSecure: false,
                trustProxy: false,
                requestBodyLimit: "256kb",
                allowedOrigins: undefined,
                upstreamHostPolicy: {
                        enforceAllowlist: false,
                        allowedHosts: [],
                        allowedCidrs: []
                },
                rateLimitEnabled: true,
                proxyRateLimitWindowMs: 60_000,
                proxyRateLimitMaxRequests: 300,
                authRateLimitWindowMs: 60_000,
                authRateLimitMaxRequests: 20,
                metricsEnabled: true
        };

        beforeEach(() => {
                mockedCreateUpstreamSocket.mockReset();
                getSocketIoServerConstructor().mockClear();
        });

        it("wires socket.io at /bff/socket and routes engine requests through session middleware", () => {
                const sessionMiddleware = jest.fn() as unknown as BffSessionMiddleware;

                attachRealtimeBridge({} as never, config, sessionMiddleware);

                expect(getSocketIoServerConstructor()).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                        path: BFF_SOCKET_PATH,
                        transports: ["websocket", "polling"]
                }));

                const ioInstance = getLatestIoServerInstance();
                expect(ioInstance.engine.use).toHaveBeenCalledTimes(1);

                const next = jest.fn();
                ioInstance.__engineMiddleware?.({} as never, {} as never, next);
                expect(sessionMiddleware).toHaveBeenCalledTimes(1);
                expect(next).not.toHaveBeenCalled();
        });

        it("rejects socket connections without a BFF session", () => {
                const sessionMiddleware = jest.fn() as unknown as BffSessionMiddleware;
                attachRealtimeBridge({} as never, config, sessionMiddleware);
                const ioInstance = getLatestIoServerInstance();

                const browserSocket = new FakeBrowserSocket();
                const next = jest.fn();
                ioInstance.__authMiddleware?.(browserSocket as never, next);

                expect(next).toHaveBeenCalledTimes(1);
                expect(next.mock.calls[0][0]).toEqual(expect.any(Error));
                expect((next.mock.calls[0][0] as Error).message).toBe("Not signed in.");
                expect(mockedCreateUpstreamSocket).not.toHaveBeenCalled();
        });

        it("forwards upstream realtime states/events and cleans up on browser disconnect", () => {
                const sessionMiddleware = jest.fn() as unknown as BffSessionMiddleware;
                const upstreamSocket = new FakeUpstreamSocket();
                mockedCreateUpstreamSocket.mockReturnValue(upstreamSocket);
                attachRealtimeBridge({} as never, config, sessionMiddleware);
                const ioInstance = getLatestIoServerInstance();

                const now = Date.now();
                const sessionRecord: BffSessionRecord = {
                        id: "session-id",
                        createdAt: now,
                        updatedAt: now,
                        serverUrl: "https://example.com",
                        deviceName: "web-client",
                        authMode: "legacy-guid",
                        csrfToken: "csrf-token",
                        legacyPasswordGuid: "legacy-guid",
                        socketGuid: "socket-guid"
                };
                const browserSocket = new FakeBrowserSocket();
                browserSocket.request.session = {bffSession: sessionRecord};

                const authNext = jest.fn();
                ioInstance.__authMiddleware?.(browserSocket as never, authNext);
                expect(authNext).toHaveBeenCalledWith();

                ioInstance.__connectionHandler?.(browserSocket as never);

                expect(mockedCreateUpstreamSocket).toHaveBeenCalledWith(sessionRecord);
                expect(upstreamSocket.connect).toHaveBeenCalledTimes(1);
                expect(browserSocket.emit).toHaveBeenCalledWith(BFF_REALTIME_STATE_EVENT, {state: "connecting"});

                upstreamSocket.emitSocket("connect");
                expect(browserSocket.emit).toHaveBeenCalledWith(BFF_REALTIME_STATE_EVENT, {state: "connected"});

                const messagePayload = {guid: "message-guid"};
                upstreamSocket.emitSocket("new-message", messagePayload);
                expect(browserSocket.emit).toHaveBeenCalledWith("new-message", messagePayload);

                const updatedPayload = {guid: "updated-guid"};
                const upstreamAck = jest.fn();
                browserSocket.setNextAckPayload({ok: true});
                upstreamSocket.emitSocket("updated-message", updatedPayload, upstreamAck);
                expect(browserSocket.timeout).toHaveBeenCalledWith(5000);
                expect(upstreamAck).toHaveBeenCalledWith({ok: true});

                upstreamSocket.emitSocket("disconnect", "transport close");
                expect(browserSocket.emit).toHaveBeenCalledWith(BFF_REALTIME_STATE_EVENT, {
                        state: "disconnected",
                        details: "transport close"
                });

                browserSocket.trigger("disconnect");
                expect(upstreamSocket.removeAllListeners).toHaveBeenCalledTimes(1);
                expect(upstreamSocket.disconnect).toHaveBeenCalledTimes(1);
        });
});

function getLatestIoServerInstance(): MockIoServerInstance {
        const constructorMock = getSocketIoServerConstructor();
        const results = constructorMock.mock.results;
        if(results.length === 0) {
            throw new Error("SocketIOServer was not instantiated.");
        }
        return results[results.length - 1].value as MockIoServerInstance;
}

function getSocketIoServerConstructor(): jest.Mock {
        return (jest.requireMock("socket.io") as {Server: jest.Mock;}).Server;
}
