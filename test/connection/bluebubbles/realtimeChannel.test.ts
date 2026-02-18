import {io} from "socket.io-client";
import BlueBubblesRealtimeChannel from "../../../src/connection/bluebubbles/realtimeChannel";
import {BlueBubblesAuthState} from "../../../src/connection/bluebubbles/session";

jest.mock("socket.io-client", () => ({
        io: jest.fn()
}));

type EventHandler = (...args: unknown[]) => void;

class FakeSocket {
        public connect = jest.fn();
        public disconnect = jest.fn();
        public removeAllListeners = jest.fn(() => {
                this.socketHandlers.clear();
                this.managerHandlers.clear();
        });
        public on = jest.fn((event: string, handler: EventHandler) => {
                const handlers = this.socketHandlers.get(event) ?? new Set<EventHandler>();
                handlers.add(handler);
                this.socketHandlers.set(event, handlers);
                return this;
        });
        public readonly io = {
                on: (event: string, handler: EventHandler) => {
                        const handlers = this.managerHandlers.get(event) ?? new Set<EventHandler>();
                        handlers.add(handler);
                        this.managerHandlers.set(event, handlers);
                        return this.io;
                }
        };

        private readonly socketHandlers = new Map<string, Set<EventHandler>>();
        private readonly managerHandlers = new Map<string, Set<EventHandler>>();

        public emitSocket(event: string, ...args: unknown[]): void {
                const handlers = this.socketHandlers.get(event);
                if(!handlers) return;
                for(const handler of handlers) {
                        handler(...args);
                }
        }

        public emitManager(event: string, ...args: unknown[]): void {
                const handlers = this.managerHandlers.get(event);
                if(!handlers) return;
                for(const handler of handlers) {
                        handler(...args);
                }
        }
}

describe("BlueBubblesRealtimeChannel", () => {
        const auth: BlueBubblesAuthState = {
                serverUrl: "http://localhost:1234",
                accessToken: "guid-token"
        };

        beforeEach(() => {
                jest.clearAllMocks();
        });

        it("connects with guid query auth and reports connection state", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const stateSpy = jest.fn();
                const channel = new BlueBubblesRealtimeChannel(auth, {onStateChange: stateSpy});
                channel.connect();

                expect(mockedIo).toHaveBeenCalledWith("http://localhost:1234", expect.objectContaining({
                        autoConnect: false,
                        path: "/socket.io",
                        transports: ["websocket", "polling"],
                        allowEIO3: true,
                        timeout: 10000,
                        reconnection: true,
                        query: {guid: auth.accessToken}
                }));
                expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
                expect(stateSpy).toHaveBeenCalledWith("connecting", undefined);

                fakeSocket.emitSocket("connect");
                expect(channel.isHealthy()).toBe(true);
                expect(stateSpy).toHaveBeenCalledWith("connected", undefined);

                channel.disconnect();
                expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
                expect(fakeSocket.removeAllListeners).toHaveBeenCalledTimes(1);
                expect(channel.state).toBe("disconnected");
        });

        it("uses socketGuid and preserves URL base path for socket.io routing", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const channel = new BlueBubblesRealtimeChannel({
                        serverUrl: "https://example.com/nested/path/",
                        accessToken: "access-token",
                        socketGuid: "socket-guid"
                });
                channel.connect();

                expect(mockedIo).toHaveBeenCalledWith("https://example.com", expect.objectContaining({
                        path: "/nested/path/socket.io",
                        allowEIO3: true,
                        query: {guid: "socket-guid"}
                }));
        });

        it("supports overriding socket connect timeout", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const channel = new BlueBubblesRealtimeChannel(auth, {connectTimeoutMs: 25000});
                channel.connect();

                expect(mockedIo).toHaveBeenCalledWith("http://localhost:1234", expect.objectContaining({
                        timeout: 25000
                }));
        });

        it("subscribes and unsubscribes realtime message listeners", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const callback = jest.fn();
                const channel = new BlueBubblesRealtimeChannel(auth);
                const unsubscribe = channel.subscribe("new-message", callback);
                channel.connect();

                fakeSocket.emitSocket("new-message", {guid: "message-guid"});
                expect(callback).toHaveBeenCalledTimes(1);

                unsubscribe();
                fakeSocket.emitSocket("new-message", {guid: "message-guid-2"});
                expect(callback).toHaveBeenCalledTimes(1);
        });

        it("surfaces socket errors and reconnect state changes", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const errorSpy = jest.fn();
                const stateSpy = jest.fn();
                const channel = new BlueBubblesRealtimeChannel(auth, {
                        onError: errorSpy,
                        onStateChange: stateSpy
                });
                channel.connect();

                fakeSocket.emitSocket("connect_error", new Error("boom"));
                expect(channel.state).toBe("error");
                expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({message: "Socket connect error: boom"}));

                fakeSocket.emitManager("reconnect_attempt", 3);
                expect(channel.state).toBe("connecting");
                expect(stateSpy).toHaveBeenCalledWith("connecting", 3);
        });
});
