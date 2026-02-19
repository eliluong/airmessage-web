import {randomBytes, timingSafeEqual} from "node:crypto";
import {BffSessionRecord} from "./types";

export const CSRF_HEADER_NAME = "x-csrf-token";

export function generateCsrfToken(): string {
        return randomBytes(32).toString("base64url");
}

export function ensureSessionCsrfToken(sessionRecord: BffSessionRecord): BffSessionRecord {
        const normalized = normalizeToken(sessionRecord.csrfToken);
        if(normalized) {
                if(normalized === sessionRecord.csrfToken) {
                        return sessionRecord;
                }
                return {
                        ...sessionRecord,
                        csrfToken: normalized
                };
        }

        return {
                ...sessionRecord,
                csrfToken: generateCsrfToken()
        };
}

export function isValidCsrfToken(expectedToken: string | undefined, providedToken: string | undefined): boolean {
        const expected = normalizeToken(expectedToken);
        const provided = normalizeToken(providedToken);
        if(!expected || !provided) return false;

        const expectedBuffer = Buffer.from(expected, "utf8");
        const providedBuffer = Buffer.from(provided, "utf8");
        if(expectedBuffer.length !== providedBuffer.length) {
                return false;
        }
        return timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeToken(value: string | undefined): string | undefined {
        if(typeof value !== "string") return undefined;
        const normalized = value.trim();
        if(normalized.length === 0) return undefined;
        return normalized;
}
