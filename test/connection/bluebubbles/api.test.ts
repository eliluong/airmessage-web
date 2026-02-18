import type {BlueBubblesAuthState} from "../../../src/connection/bluebubbles/session";

describe("bluebubbles api metadata normalization", () => {
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

        test("normalizes wrapped server info and features payloads", async () => {
                const fetchMock = jest.fn()
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn().mockResolvedValue({
                                        data: {
                                                computerId: "computer",
                                                osVersion: "14.4",
                                                serverVersion: "1.6.2",
                                                privateApi: true,
                                                helperConnected: true,
                                                proxyService: "none",
                                                detectedIcloud: "icloud@example.com",
                                                detectedImessage: "enabled",
                                                macosTimeSync: null,
                                                localIpv4s: ["192.168.1.20"],
                                                localIpv6s: ["fe80::1"]
                                        }
                                })
                        } as unknown as Response)
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn().mockResolvedValue({
                                        data: {
                                                privateApi: true,
                                                helperConnected: true,
                                                deliveredReceipts: true,
                                                readReceipts: true,
                                                reactions: true
                                        }
                                })
                        } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {fetchServerMetadata} = await import("../../../src/connection/bluebubbles/api");
                const auth: BlueBubblesAuthState = {
                        serverUrl: "https://example.com",
                        accessToken: "token"
                };

                const metadata = await fetchServerMetadata(auth);
                expect(metadata.server_version).toBe("1.6.2");
                expect(metadata.os_version).toBe("14.4");
                expect(metadata.computer_id).toBe("computer");
                expect(metadata.private_api).toBe(true);
                expect(metadata.helper_connected).toBe(true);
                expect(metadata.features?.delivered_receipts).toBe(true);
                expect(metadata.features?.read_receipts).toBe(true);

                expect(fetchMock).toHaveBeenCalledTimes(2);
                expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/api/v1/server/info");
                expect(fetchMock.mock.calls[1][0]).toBe("https://example.com/api/v1/server/features");
        });

        test("falls back to info flags when features endpoint is unavailable", async () => {
                const fetchMock = jest.fn()
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn().mockResolvedValue({
                                        data: {
                                                computer_id: "computer",
                                                os_version: "13.6",
                                                server_version: "1.5.9",
                                                private_api: false,
                                                helper_connected: false,
                                                proxy_service: "none",
                                                detected_icloud: "",
                                                detected_imessage: "",
                                                macos_time_sync: null,
                                                local_ipv4s: [],
                                                local_ipv6s: []
                                        }
                                })
                        } as unknown as Response)
                        .mockResolvedValueOnce({
                                ok: false,
                                status: 404,
                                statusText: "Not Found",
                                json: jest.fn().mockResolvedValue({message: "missing"})
                        } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {fetchServerMetadata} = await import("../../../src/connection/bluebubbles/api");
                const auth: BlueBubblesAuthState = {
                        serverUrl: "https://example.com",
                        accessToken: "token"
                };

                const metadata = await fetchServerMetadata(auth);
                expect(metadata.server_version).toBe("1.5.9");
                expect(metadata.private_api).toBe(false);
                expect(metadata.helper_connected).toBe(false);
                expect(metadata.features).toBeUndefined();
        });
});
