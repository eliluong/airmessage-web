import type {BlueBubblesAuthState} from "../../src/connection/bluebubbles/session";

describe("legacy BlueBubbles authentication", () => {
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

        test("login falls back to legacy password probing when auth endpoints are missing", async () => {
                const fetchMock = jest.fn().mockResolvedValueOnce({
                        ok: false,
                        status: 404,
                        statusText: "Not Found",
                        json: jest.fn().mockResolvedValue({message: "missing"})
                } as unknown as Response)
                        .mockResolvedValueOnce({
                                ok: false,
                                status: 404,
                                statusText: "Not Found",
                                json: jest.fn().mockResolvedValue({message: "missing"})
                        } as unknown as Response)
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn()
                        } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {loginBlueBubblesDevice} = await import("../../src/util/bluebubblesAuth");
                const result = await loginBlueBubblesDevice({
                        serverUrl: "https://example.com",
                        password: "secret",
                        deviceName: "device-guid"
                });

                expect(result).toEqual(expect.objectContaining({
                        accessToken: "secret",
                        legacyPasswordAuth: true
                }));
                expect(fetchMock).toHaveBeenCalledTimes(3);
                expect(fetchMock.mock.calls[2][0]).toBe("https://example.com/api/v1/ping?password=secret&device=device-guid");
        });

        test("legacy sessions append the password and device name as query parameters", async () => {
                const fetchMock = jest.fn().mockResolvedValue({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        json: jest.fn().mockResolvedValue({chats: []})
                } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {fetchChats} = await import("../../src/connection/bluebubbles/api");
                await fetchChats({
                        serverUrl: "https://example.com",
                        accessToken: "secret",
                        legacyPasswordAuth: true,
                        deviceName: "device-guid"
                } as BlueBubblesAuthState);

                expect(fetchMock).toHaveBeenCalledTimes(1);
                const requestUrl = fetchMock.mock.calls[0][0] as string;
                const parsed = new URL(requestUrl);
                expect(parsed.searchParams.get("password")).toBe("secret");
                expect(parsed.searchParams.get("device")).toBe("device-guid");
        });

        test("legacy tokens never trigger refresh", async () => {
                const {shouldRefreshToken} = await import("../../src/util/bluebubblesAuth");
                expect(shouldRefreshToken({
                        accessToken: "secret",
                        legacyPasswordAuth: true
                })).toBe(false);
        });
});
