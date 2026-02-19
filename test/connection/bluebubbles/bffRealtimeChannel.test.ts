import {io} from "socket.io-client";
import BffRealtimeChannel from "../../../src/connection/bluebubbles/bff/realtimeChannel";

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

describe("BffRealtimeChannel", () => {
        beforeEach(() => {
                jest.clearAllMocks();
        });

        it("connects to /bff/socket and becomes healthy after upstream connected state", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const stateSpy = jest.fn();
                const channel = new BffRealtimeChannel({onStateChange: stateSpy});

                channel.connect();

                expect(mockedIo).toHaveBeenCalledWith(undefined, expect.objectContaining({
                        autoConnect: false,
                        path: "/bff/socket",
                        transports: ["websocket", "polling"],
                        withCredentials: true,
                        timeout: 10000,
                        reconnection: true
                }));
                expect(stateSpy).toHaveBeenCalledWith("connecting", undefined);
                expect(fakeSocket.connect).toHaveBeenCalledTimes(1);

                fakeSocket.emitSocket("connect");
                expect(stateSpy).toHaveBeenCalledWith("connecting", "bff-connected");

                fakeSocket.emitSocket("bff-realtime-state", {state: "connected"});
                expect(channel.state).toBe("connected");
                expect(channel.isHealthy()).toBe(true);

                channel.disconnect();
                expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
                expect(fakeSocket.removeAllListeners).toHaveBeenCalledTimes(1);
                expect(channel.state).toBe("disconnected");
        });

        it("forwards message events and supports unsubscribe", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const listener = jest.fn();
                const channel = new BffRealtimeChannel();
                const unsubscribe = channel.subscribe("new-message", listener);
                channel.connect();

                fakeSocket.emitSocket("new-message", {guid: "message-guid"});
                expect(listener).toHaveBeenCalledTimes(1);

                unsubscribe();
                fakeSocket.emitSocket("new-message", {guid: "message-guid-2"});
                expect(listener).toHaveBeenCalledTimes(1);
        });

        it("surfaces upstream error state details", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const errorSpy = jest.fn();
                const stateSpy = jest.fn();
                const channel = new BffRealtimeChannel({
                        onError: errorSpy,
                        onStateChange: stateSpy
                });
                channel.connect();

                fakeSocket.emitSocket("bff-realtime-state", {
                        state: "error",
                        details: "upstream-connect-failed"
                });

                expect(channel.state).toBe("error");
                expect(stateSpy).toHaveBeenCalledWith("error", "upstream-connect-failed");
                expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
                        message: "BFF upstream realtime error: upstream-connect-failed"
                }));
        });

        it("treats invalid realtime state payloads as errors", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const errorSpy = jest.fn();
                const channel = new BffRealtimeChannel({onError: errorSpy});
                channel.connect();

                fakeSocket.emitSocket("bff-realtime-state", {state: "not-a-real-state"});

                expect(channel.state).toBe("error");
                expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
                        message: expect.stringContaining("BFF realtime state payload was invalid")
                }));
        });

        it("updates to connecting on socket manager reconnect attempts", () => {
                const fakeSocket = new FakeSocket();
                const mockedIo = io as unknown as jest.Mock;
                mockedIo.mockReturnValue(fakeSocket);

                const stateSpy = jest.fn();
                const channel = new BffRealtimeChannel({onStateChange: stateSpy});
                channel.connect();

                fakeSocket.emitManager("reconnect_attempt", 2);

                expect(channel.state).toBe("connecting");
                expect(stateSpy).toHaveBeenCalledWith("connecting", 2);
        });
});
