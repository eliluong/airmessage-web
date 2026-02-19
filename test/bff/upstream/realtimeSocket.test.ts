import {
        createUpstreamRealtimeSocket,
        normalizeUpstreamStateDetails
} from "../../../bff/src/upstream/realtimeSocket";

describe("bff upstream realtime socket helper", () => {
        it("connects upstream socket with guid auth and base-path-aware socket.io route", () => {
                const result = createUpstreamRealtimeSocket({
                        id: "session-id",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        serverUrl: "https://example.com/nested/path",
                        authMode: "modern-token",
                        csrfToken: "csrf-token",
                        accessToken: "access-token",
                        socketGuid: "socket-guid"
                });

                expect((result as unknown as {io: {uri: string;};}).io.uri).toBe("https://example.com");
                expect((result as unknown as {_opts: Record<string, unknown>;})._opts).toEqual(expect.objectContaining({
                        autoConnect: false,
                        forceNew: true,
                        allowEIO3: true,
                        transports: ["websocket", "polling"],
                        path: "/nested/path/socket.io",
                        timeout: 10000,
                        query: {guid: "socket-guid"}
                }));
                result.disconnect();
        });

        it("falls back to access token when socket guid is absent", () => {
                const result = createUpstreamRealtimeSocket({
                        id: "session-id",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        serverUrl: "https://example.com",
                        authMode: "modern-token",
                        csrfToken: "csrf-token",
                        accessToken: "fallback-token"
                });

                expect((result as unknown as {_opts: Record<string, unknown>;})._opts).toEqual(expect.objectContaining({
                        query: {guid: "fallback-token"}
                }));
                result.disconnect();
        });

        it("throws when neither socket guid nor token is available", () => {
                expect(() => createUpstreamRealtimeSocket({
                        id: "session-id",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        serverUrl: "https://example.com",
                        authMode: "legacy-guid",
                        csrfToken: "csrf-token"
                })).toThrow("Session is missing socket guid credentials for realtime bridge.");
        });

        it("normalizes error-like state details", () => {
                expect(normalizeUpstreamStateDetails(new Error("boom"))).toBe("boom");
                expect(normalizeUpstreamStateDetails({message: "upstream-error"})).toBe("upstream-error");
        });
});
