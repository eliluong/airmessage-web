describe("bluebubbles bff api", () => {
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

        test("normalizes wrapped server info and features payloads from bff routes", async () => {
                const fetchMock = jest.fn()
                        .mockResolvedValueOnce({
                                ok: true,
                                status: 200,
                                statusText: "OK",
                                json: jest.fn().mockResolvedValue({
                                        data: {
                                                computerId: "computer",
                                                osVersion: "14.4",
                                                serverVersion: "1.9.7",
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

                const {fetchServerMetadata} = await import("../../../src/connection/bluebubbles/bff/api");
                const metadata = await fetchServerMetadata();

                expect(metadata.server_version).toBe("1.9.7");
                expect(metadata.os_version).toBe("14.4");
                expect(metadata.computer_id).toBe("computer");
                expect(metadata.private_api).toBe(true);
                expect(metadata.helper_connected).toBe(true);
                expect(metadata.features?.delivered_receipts).toBe(true);
                expect(metadata.features?.read_receipts).toBe(true);

                expect(fetchMock).toHaveBeenCalledTimes(2);
                expect(fetchMock.mock.calls[0][0]).toBe("/bff/server/info");
                expect(fetchMock.mock.calls[1][0]).toBe("/bff/server/features");
                expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
                        credentials: "include",
                        method: "GET"
                }));
        });

        test("surfaces bff error envelopes with status and code", async () => {
                const fetchMock = jest.fn().mockResolvedValue({
                        ok: false,
                        status: 401,
                        statusText: "Unauthorized",
                        json: jest.fn().mockResolvedValue({
                                error: {
                                        code: "BFF_SESSION_MISSING",
                                        message: "Not signed in.",
                                        requestId: "req-123"
                                }
                        })
                } as unknown as Response);
                (globalThis as typeof globalThis & {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

                const {fetchChats, BffApiError} = await import("../../../src/connection/bluebubbles/bff/api");

                await expect(fetchChats()).rejects.toEqual(expect.objectContaining({
                        name: "BffApiError",
                        status: 401,
                        code: "BFF_SESSION_MISSING",
                        requestId: "req-123",
                        message: "Not signed in."
                } as Partial<InstanceType<typeof BffApiError>>));
        });
});
