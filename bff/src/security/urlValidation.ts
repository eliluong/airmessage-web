import * as ipaddr from "ipaddr.js";
import {BffHttpError} from "../errors";

export interface UpstreamHostPolicy {
        enforceAllowlist: boolean;
        allowedHosts: string[];
        allowedCidrs: string[];
}

export function assertValidUpstreamHostPolicy(policy: UpstreamHostPolicy): void {
        if(policy.enforceAllowlist && policy.allowedHosts.length === 0 && policy.allowedCidrs.length === 0) {
                throw new Error("At least one upstream allowlist host or CIDR is required when enforcement is enabled.");
        }

        for(const hostPattern of policy.allowedHosts) {
                if(hostPattern.includes("*") && !hostPattern.startsWith("*.")) {
                        throw new Error(`Invalid upstream host allowlist pattern "${hostPattern}". Only prefix wildcards (*.example.com) are supported.`);
                }
        }

        for(const cidr of policy.allowedCidrs) {
                try {
                        ipaddr.parseCIDR(cidr);
                } catch {
                        throw new Error(`Invalid upstream CIDR allowlist value "${cidr}".`);
                }
        }
}

export function normalizeServerUrl(rawServerUrl: string, hostPolicy?: UpstreamHostPolicy): string {
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

        enforceHostPolicy(parsed, hostPolicy);

        parsed.hash = "";
        parsed.search = "";
        return parsed.toString().replace(/\/$/, "");
}

export function buildUpstreamUrl(serverUrl: string, path: string, hostPolicy?: UpstreamHostPolicy): URL {
        const normalizedServer = normalizeServerUrl(serverUrl, hostPolicy);
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        return new URL(`${normalizedServer}${normalizedPath}`);
}

function enforceHostPolicy(parsed: URL, hostPolicy?: UpstreamHostPolicy): void {
        if(!hostPolicy) {
                return;
        }

        const hasAllowlistEntries = hostPolicy.allowedHosts.length > 0 || hostPolicy.allowedCidrs.length > 0;
        if(!hostPolicy.enforceAllowlist && !hasAllowlistEntries) {
                return;
        }

        const hostname = parsed.hostname.toLowerCase();
        if(hostMatchesAllowlist(hostname, hostPolicy.allowedHosts)) {
                return;
        }
        if(ipMatchesAllowlist(hostname, hostPolicy.allowedCidrs)) {
                return;
        }

        throw new BffHttpError({
                code: "BFF_UPSTREAM_HOST_NOT_ALLOWED",
                status: 403,
                message: "The requested upstream host is not in the BFF allowlist."
        });
}

function hostMatchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
        for(const patternRaw of allowedHosts) {
                const pattern = patternRaw.toLowerCase();
                if(pattern.startsWith("*.")) {
                        const suffix = pattern.slice(2);
                        if(!suffix) continue;
                        if(hostname === suffix) continue;
                        if(hostname.endsWith(`.${suffix}`)) {
                                return true;
                        }
                        continue;
                }

                if(hostname === pattern) {
                        return true;
                }
        }
        return false;
}

function ipMatchesAllowlist(hostname: string, allowedCidrs: string[]): boolean {
        if(!ipaddr.isValid(hostname)) {
                return false;
        }

        const address = ipaddr.parse(hostname);
        for(const cidr of allowedCidrs) {
                try {
                        const [rangeAddress, prefixLength] = ipaddr.parseCIDR(cidr);
                        if(address.kind() !== rangeAddress.kind()) {
                                continue;
                        }
                        if(address.match([rangeAddress, prefixLength])) {
                                return true;
                        }
                } catch {
                        continue;
                }
        }
        return false;
}
