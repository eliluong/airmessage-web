/** @jest-environment node */
import {createRateLimiters} from "../../../bff/src/security/rateLimit";
import {BffConfig} from "../../../bff/src/config";

function buildConfig(overrides: Partial<BffConfig> = {}): BffConfig {
        return {
                port: 3100,
                sessionSecret: "secret",
                sessionCookieName: "bff_session",
                sessionMaxAgeMs: 24 * 60 * 60 * 1000,
                sessionStoreMode: "memory",
                sessionStoreTtlSeconds: 24 * 60 * 60,
                redisKeyPrefix: "airmessage:bff:sess:",
                cookieSecure: false,
                trustProxy: false,
                requestBodyLimit: "256kb",
                allowedOrigins: undefined,
                upstreamHostPolicy: {
                        enforceAllowlist: false,
                        allowedHosts: [],
                        allowedCidrs: []
                },
                rateLimitEnabled: true,
                proxyRateLimitWindowMs: 60_000,
                proxyRateLimitMaxRequests: 100,
                authRateLimitWindowMs: 60_000,
                authRateLimitMaxRequests: 1,
                metricsEnabled: false,
                ...overrides
        };
}

describe("bff rate limiting", () => {
        it("limits repeated login attempts", async () => {
                const limiters = createRateLimiters(buildConfig());

                const firstAttempt = await invokeMiddleware(limiters.auth as unknown as MiddlewareFn, {
                        ipAddress: "127.0.0.1",
                        sessionId: "session-1"
                });
                expect(firstAttempt.nextCalled).toBe(true);

                const secondAttempt = await invokeMiddleware(limiters.auth as unknown as MiddlewareFn, {
                        ipAddress: "127.0.0.1",
                        sessionId: "session-1"
                });
                expect(secondAttempt.statusCode).toBe(429);
                expect((secondAttempt.payload as {error?: {code?: string;};})?.error?.code).toBe("BFF_AUTH_RATE_LIMITED");
        });

        it("becomes a pass-through middleware when disabled", async () => {
                const limiters = createRateLimiters(buildConfig({rateLimitEnabled: false}));

                const attempts = await Promise.all([
                        invokeMiddleware(limiters.auth as unknown as MiddlewareFn, {ipAddress: "127.0.0.1", sessionId: "session-2"}),
                        invokeMiddleware(limiters.auth as unknown as MiddlewareFn, {ipAddress: "127.0.0.1", sessionId: "session-2"}),
                        invokeMiddleware(limiters.auth as unknown as MiddlewareFn, {ipAddress: "127.0.0.1", sessionId: "session-2"})
                ]);

                expect(attempts.every((entry) => entry.nextCalled)).toBe(true);
                expect(attempts.map((entry) => entry.statusCode)).toEqual([200, 200, 200]);
        });
});

interface MiddlewareInvocationOptions {
        ipAddress: string;
        sessionId?: string;
}

type MiddlewareFn = (req: unknown, res: unknown, next: (error?: unknown) => void) => unknown;

interface MiddlewareInvocationResult {
        nextCalled: boolean;
        statusCode: number;
        payload?: unknown;
}

function invokeMiddleware(
        middleware: MiddlewareFn,
        options: MiddlewareInvocationOptions
): Promise<MiddlewareInvocationResult> {
        return new Promise((resolve, reject) => {
                const result: MiddlewareInvocationResult = {
                        nextCalled: false,
                        statusCode: 200
                };
                let settled = false;

                const settle = (resolver: () => void): void => {
                        if(settled) return;
                        settled = true;
                        resolver();
                };

                const req = {
                        ip: options.ipAddress,
                        method: "POST",
                        originalUrl: "/bff/session/login",
                        path: "/bff/session/login",
                        socket: {
                                remoteAddress: options.ipAddress
                        },
                        app: {
                                get: () => undefined
                        },
                        session: options.sessionId ? {id: options.sessionId} : undefined
                };

                const res = {
                        locals: {},
                        setHeader: jest.fn(),
                        getHeader: jest.fn(),
                        append: jest.fn(function(this: unknown) {
                                return this;
                        }),
                        removeHeader: jest.fn(),
                        status: jest.fn(function(this: unknown, statusCode: number) {
                                result.statusCode = statusCode;
                                return this;
                        }),
                        json: jest.fn(function(this: unknown, payload: unknown) {
                                result.payload = payload;
                                settle(() => resolve(result));
                                return this;
                        }),
                        end: jest.fn(function(this: unknown) {
                                settle(() => resolve(result));
                                return this;
                        })
                } as const;

                const next = (error?: unknown) => {
                        if(error) {
                                settle(() => reject(error));
                                return;
                        }
                        result.nextCalled = true;
                        settle(() => resolve(result));
                };

                Promise.resolve(middleware(req, res, next))
                        .then(() => {
                                setImmediate(() => {
                                        settle(() => resolve(result));
                                });
                        })
                        .catch((error) => {
                                settle(() => reject(error));
                        });
        });
}
