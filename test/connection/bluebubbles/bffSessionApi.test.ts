describe("bluebubbles bff session api", () => {
        const originalFetch = globalThis.fetch;

        afterEach(() => {
                if(originalFetch) {
                        (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = originalFetch;
                } else {
                        const globalAny = globalThis as Record<string, unknown>;
                        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                        delete globalAny.fetch;
                }
                jest.resetModules();
        });

        test("logs in through bff session route", async () => {
                const fetchMock = jest.fn().mockResolvedValue({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        json: jest.fn().mockResolvedValue({
                                data: {
                                        authenticated: true,
                                        serverUrl: "https://example.com",
                                        deviceName: "web",
                                        authMode: "legacy-guid"
                                }
                        })
                } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {loginBffSession} = await import("../../../src/connection/bluebubbles/bff/sessionApi");
                const result = await loginBffSession({
                        serverUrl: "https://example.com",
                        password: "secret",
                        deviceName: "web"
                });

                expect(result.authenticated).toBe(true);
                expect(result.serverUrl).toBe("https://example.com");
                expect(fetchMock).toHaveBeenCalledWith("/bff/session/login", expect.objectContaining({
                        credentials: "include",
                        method: "POST"
                }));
        });

        test("reads bff session status", async () => {
                const fetchMock = jest.fn().mockResolvedValue({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        json: jest.fn().mockResolvedValue({
                                data: {
                                        authenticated: false
                                }
                        })
                } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {fetchBffSessionStatus} = await import("../../../src/connection/bluebubbles/bff/sessionApi");
                const result = await fetchBffSessionStatus();

                expect(result.authenticated).toBe(false);
                expect(fetchMock).toHaveBeenCalledWith("/bff/session/status", expect.objectContaining({
                        credentials: "include",
                        method: "GET"
                }));
        });
});
