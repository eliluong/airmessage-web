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
                                        authMode: "legacy-guid",
                                        csrfToken: "csrf-login-token"
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

        test("sends csrf token for bff logout once authenticated", async () => {
                const fetchMock = jest.fn()
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn().mockResolvedValue({
                                        data: {
                                                authenticated: true,
                                                serverUrl: "https://example.com",
                                                deviceName: "web",
                                                authMode: "legacy-guid",
                                                csrfToken: "csrf-logout-token"
                                        }
                                })
                        } as unknown as Response)
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn().mockResolvedValue({
                                        data: {success: true}
                                })
                        } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {loginBffSession, logoutBffSession} = await import("../../../src/connection/bluebubbles/bff/sessionApi");
                await loginBffSession({
                        serverUrl: "https://example.com",
                        password: "secret",
                        deviceName: "web"
                });
                await logoutBffSession();

                expect(fetchMock).toHaveBeenCalledTimes(2);
                expect(fetchMock.mock.calls[1][0]).toBe("/bff/session/logout");
                expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
                        credentials: "include",
                        method: "POST"
                }));

                const headers = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
                expect(headers.get("X-CSRF-Token")).toBe("csrf-logout-token");
        });
});
