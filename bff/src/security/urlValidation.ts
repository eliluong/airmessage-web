import {BffHttpError} from "../errors";

export function normalizeServerUrl(rawServerUrl: string): string {
        const trimmed = rawServerUrl.trim();
        if(trimmed.length === 0) {
                throw new BffHttpError({
                        code: "BFF_INVALID_SERVER_URL",
                        status: 400,
                        message: "A server URL is required."
                });
        }

        let parsed: URL;
        try {
                parsed = new URL(trimmed);
        } catch {
                throw new BffHttpError({
                        code: "BFF_INVALID_SERVER_URL",
                        status: 400,
                        message: "The server URL must be a valid HTTP or HTTPS URL."
                });
        }

        if(parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                throw new BffHttpError({
                        code: "BFF_INVALID_SERVER_URL",
                        status: 400,
                        message: "The server URL must start with http:// or https://."
                });
        }

        parsed.hash = "";
        parsed.search = "";
        return parsed.toString().replace(/\/$/, "");
}

export function buildUpstreamUrl(serverUrl: string, path: string): URL {
        const normalizedServer = normalizeServerUrl(serverUrl);
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        return new URL(`${normalizedServer}${normalizedPath}`);
}
