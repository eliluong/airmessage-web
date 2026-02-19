/** @jest-environment node */
import {Writable} from "node:stream";
import {createLogger} from "../../../bff/src/observability/logger";

describe("bff logger redaction", () => {
        it("redacts sensitive fields in structured payloads", async () => {
                const lines: string[] = [];
                const destination = new Writable({
                        write(chunk, _encoding, callback) {
                                lines.push(chunk.toString("utf8"));
                                callback();
                        }
                });

                const testLogger = createLogger(destination);
                testLogger.info({
                        password: "plain-password",
                        guid: "plain-guid",
                        req: {
                                headers: {
                                        authorization: "Bearer top-secret",
                                        cookie: "session=sensitive"
                                },
                                query: {
                                        password: "query-secret"
                                }
                        }
                }, "redaction-check");

                await new Promise((resolve) => setImmediate(resolve));

                expect(lines.length).toBeGreaterThan(0);
                const payload = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

                expect(payload.password).toBe("[REDACTED]");
                expect(payload.guid).toBe("[REDACTED]");
                expect(payload.req).toEqual(expect.objectContaining({
                        headers: expect.objectContaining({
                                authorization: "[REDACTED]",
                                cookie: "[REDACTED]"
                        }),
                        query: expect.objectContaining({
                                password: "[REDACTED]"
                        })
                }));
        });
});
