import BffRealtimeChannel from "../../../src/connection/bluebubbles/bff/realtimeChannel";

describe("BffRealtimeChannel", () => {
        it("transitions to disconnected and remains unhealthy in phase 1", () => {
                const stateSpy = jest.fn();
                const channel = new BffRealtimeChannel({onStateChange: stateSpy});

                channel.connect();

                expect(stateSpy).toHaveBeenNthCalledWith(1, "connecting", undefined);
                expect(stateSpy).toHaveBeenNthCalledWith(2, "disconnected", "BFF realtime bridge is not implemented in Phase 1.");
                expect(channel.state).toBe("disconnected");
                expect(channel.isHealthy()).toBe(false);
        });

        it("allows subscribing and unsubscribing listeners", () => {
                const listener = jest.fn();
                const channel = new BffRealtimeChannel();

                const unsubscribe = channel.subscribe("new-message", listener);
                unsubscribe();

                expect(listener).not.toHaveBeenCalled();
        });
});
