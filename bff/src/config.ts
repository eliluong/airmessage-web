export interface BffConfig {
        port: number;
        sessionSecret: string;
        sessionCookieName: string;
        sessionMaxAgeMs: number;
        cookieSecure: boolean;
        trustProxy: boolean;
        requestBodyLimit: string;
        allowedOrigins: string[] | undefined;
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

function readAllowedOrigins(): string[] | undefined {
        const raw = readOptionalString("BFF_ALLOWED_ORIGINS");
        if(raw === undefined) return undefined;
        const origins = raw
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
        return origins.length > 0 ? origins : undefined;
}

export function loadConfig(): BffConfig {
        const sessionSecret = readRequiredString("BFF_SESSION_SECRET");
        const port = readPositiveInteger("PORT", 3100);
        const sessionCookieName = readOptionalString("BFF_SESSION_COOKIE_NAME") ?? "bff_session";
        const sessionMaxAgeMs = readPositiveInteger("BFF_SESSION_MAX_AGE_MS", 24 * 60 * 60 * 1000);
        const cookieSecure = readBoolean("BFF_COOKIE_SECURE", process.env.NODE_ENV === "production");
        const trustProxy = readBoolean("BFF_TRUST_PROXY", false);
        const requestBodyLimit = readOptionalString("BFF_REQUEST_BODY_LIMIT") ?? "256kb";
        const allowedOrigins = readAllowedOrigins();

        return {
                port,
                sessionSecret,
                sessionCookieName,
                sessionMaxAgeMs,
                cookieSecure,
                trustProxy,
                requestBodyLimit,
                allowedOrigins
        };
}
