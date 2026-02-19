import type {UpstreamHostPolicy} from "./security/urlValidation";
import {assertValidUpstreamHostPolicy} from "./security/urlValidation";

export type SessionStoreMode = "memory" | "redis";

export interface BffConfig {
        port: number;
        sessionSecret: string;
        sessionCookieName: string;
        sessionMaxAgeMs: number;
        sessionStoreMode: SessionStoreMode;
        sessionStoreTtlSeconds: number;
        redisUrl?: string;
        redisKeyPrefix: string;
        cookieSecure: boolean;
        trustProxy: boolean;
        requestBodyLimit: string;
        allowedOrigins: string[] | undefined;
        upstreamHostPolicy: UpstreamHostPolicy;
        rateLimitEnabled: boolean;
        proxyRateLimitWindowMs: number;
        proxyRateLimitMaxRequests: number;
        authRateLimitWindowMs: number;
        authRateLimitMaxRequests: number;
        metricsEnabled: boolean;
        metricsBearerToken?: string;
}

function readRequiredString(name: string): string {
        const value = process.env[name]?.trim();
        if(!value) {
                throw new Error(`Missing required environment variable ${name}`);
        }
        return value;
}

function readOptionalString(name: string): string | undefined {
        const value = process.env[name]?.trim();
        if(!value) return undefined;
        return value;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
        const raw = readOptionalString(name);
        if(raw === undefined) return defaultValue;
        const normalized = raw.toLowerCase();
        if(normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
        if(normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
        throw new Error(`Invalid boolean value for ${name}: ${raw}`);
}

function readPositiveInteger(name: string, defaultValue: number): number {
        const raw = readOptionalString(name);
        if(raw === undefined) return defaultValue;
        const parsed = Number.parseInt(raw, 10);
        if(!Number.isFinite(parsed) || parsed < 1) {
                throw new Error(`Invalid positive integer for ${name}: ${raw}`);
        }
        return parsed;
}

function readStringList(name: string): string[] {
        const raw = readOptionalString(name);
        if(raw === undefined) return [];
        return raw
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
}

function readAllowedOrigins(): string[] | undefined {
        const origins = readStringList("BFF_ALLOWED_ORIGINS");
        return origins.length > 0 ? origins : undefined;
}

function readSessionStoreMode(): SessionStoreMode {
        const rawValue = readOptionalString("BFF_SESSION_STORE_MODE")?.toLowerCase() ?? "memory";
        if(rawValue === "memory" || rawValue === "redis") {
                return rawValue;
        }
        throw new Error(`Invalid BFF_SESSION_STORE_MODE: ${rawValue}`);
}

function readUpstreamHostPolicy(): UpstreamHostPolicy {
        const policy: UpstreamHostPolicy = {
                enforceAllowlist: readBoolean("BFF_UPSTREAM_ALLOWLIST_ENFORCED", process.env.NODE_ENV === "production"),
                allowedHosts: readStringList("BFF_UPSTREAM_ALLOWED_HOSTS"),
                allowedCidrs: readStringList("BFF_UPSTREAM_ALLOWED_CIDRS")
        };
        assertValidUpstreamHostPolicy(policy);
        return policy;
}

export function loadConfig(): BffConfig {
        const sessionSecret = readRequiredString("BFF_SESSION_SECRET");
        const port = readPositiveInteger("PORT", 3100);
        const sessionCookieName = readOptionalString("BFF_SESSION_COOKIE_NAME") ?? "bff_session";
        const sessionMaxAgeMs = readPositiveInteger("BFF_SESSION_MAX_AGE_MS", 24 * 60 * 60 * 1000);
        const sessionStoreMode = readSessionStoreMode();
        const sessionStoreTtlSeconds = readPositiveInteger(
                "BFF_SESSION_TTL_SECONDS",
                Math.max(1, Math.ceil(sessionMaxAgeMs / 1000))
        );
        const redisUrl = readOptionalString("BFF_REDIS_URL");
        const redisKeyPrefix = readOptionalString("BFF_REDIS_KEY_PREFIX") ?? "airmessage:bff:sess:";
        const cookieSecure = readBoolean("BFF_COOKIE_SECURE", process.env.NODE_ENV === "production");
        const trustProxy = readBoolean("BFF_TRUST_PROXY", false);
        const requestBodyLimit = readOptionalString("BFF_REQUEST_BODY_LIMIT") ?? "256kb";
        const allowedOrigins = readAllowedOrigins();
        const upstreamHostPolicy = readUpstreamHostPolicy();
        const rateLimitEnabled = readBoolean("BFF_RATE_LIMIT_ENABLED", true);
        const proxyRateLimitWindowMs = readPositiveInteger("BFF_RATE_LIMIT_PROXY_WINDOW_MS", 60_000);
        const proxyRateLimitMaxRequests = readPositiveInteger("BFF_RATE_LIMIT_PROXY_MAX_REQUESTS", 300);
        const authRateLimitWindowMs = readPositiveInteger("BFF_RATE_LIMIT_AUTH_WINDOW_MS", 60_000);
        const authRateLimitMaxRequests = readPositiveInteger("BFF_RATE_LIMIT_AUTH_MAX_REQUESTS", 20);
        const metricsEnabled = readBoolean("BFF_METRICS_ENABLED", true);
        const metricsBearerToken = readOptionalString("BFF_METRICS_BEARER_TOKEN");

        if(sessionStoreMode === "redis" && !redisUrl) {
                throw new Error("BFF_REDIS_URL is required when BFF_SESSION_STORE_MODE=redis.");
        }

        return {
                port,
                sessionSecret,
                sessionCookieName,
                sessionMaxAgeMs,
                sessionStoreMode,
                sessionStoreTtlSeconds,
                redisUrl,
                redisKeyPrefix,
                cookieSecure,
                trustProxy,
                requestBodyLimit,
                allowedOrigins,
                upstreamHostPolicy,
                rateLimitEnabled,
                proxyRateLimitWindowMs,
                proxyRateLimitMaxRequests,
                authRateLimitWindowMs,
                authRateLimitMaxRequests,
                metricsEnabled,
                metricsBearerToken
        };
}
