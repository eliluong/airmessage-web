import {RequestHandler} from "express";
import "express-session";
import {ipKeyGenerator, rateLimit} from "express-rate-limit";
import {BffConfig} from "../config";
import {BffHttpError, buildErrorBody} from "../errors";

export interface BffRateLimiters {
        readonly auth: RequestHandler;
        readonly proxy: RequestHandler;
}

export function createRateLimiters(config: BffConfig): BffRateLimiters {
        if(!config.rateLimitEnabled) {
                return {
                        auth: passthroughMiddleware,
                        proxy: passthroughMiddleware
                };
        }

        return {
                auth: rateLimit({
                        windowMs: config.authRateLimitWindowMs,
                        limit: config.authRateLimitMaxRequests,
                        standardHeaders: "draft-8",
                        legacyHeaders: false,
                        keyGenerator: buildRateLimitKey,
                        handler: buildRateLimitHandler("BFF_AUTH_RATE_LIMITED", "Too many login attempts. Try again soon.")
                }),
                proxy: rateLimit({
                        windowMs: config.proxyRateLimitWindowMs,
                        limit: config.proxyRateLimitMaxRequests,
                        standardHeaders: "draft-8",
                        legacyHeaders: false,
                        keyGenerator: buildRateLimitKey,
                        handler: buildRateLimitHandler("BFF_PROXY_RATE_LIMITED", "Too many requests. Slow down and retry.")
                })
        };
}

const passthroughMiddleware: RequestHandler = (_req, _res, next) => {
        next();
};

function buildRateLimitHandler(code: string, message: string): RequestHandler {
        return (_req, res) => {
                const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : undefined;
                const error = new BffHttpError({
                        code,
                        status: 429,
                        message,
                        retriable: true
                });

                res.status(429).json(buildErrorBody(error, requestId));
        };
}

function buildRateLimitKey(req: Parameters<RequestHandler>[0]): string {
        const rawIpAddress = req.ip || req.socket.remoteAddress || "unknown";
        const ipAddress = ipKeyGenerator(rawIpAddress);
        const sessionId = req.session?.id;
        if(typeof sessionId === "string" && sessionId.trim().length > 0) {
                return `${ipAddress}:${sessionId}`;
        }
        return ipAddress;
}
