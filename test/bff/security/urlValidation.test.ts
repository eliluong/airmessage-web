/** @jest-environment node */
import {BffHttpError} from "../../../bff/src/errors";
import {
        assertValidUpstreamHostPolicy,
        normalizeServerUrl,
        UpstreamHostPolicy
} from "../../../bff/src/security/urlValidation";

describe("bff upstream url validation", () => {
        it("accepts upstream URLs that match explicit hosts", () => {
                const policy: UpstreamHostPolicy = {
                        enforceAllowlist: true,
                        allowedHosts: ["bb.internal.example.com"],
                        allowedCidrs: []
                };

                const normalized = normalizeServerUrl("https://bb.internal.example.com", policy);
                expect(normalized).toBe("https://bb.internal.example.com");
        });

        it("accepts upstream URLs that match wildcard host entries", () => {
                const policy: UpstreamHostPolicy = {
                        enforceAllowlist: true,
                        allowedHosts: ["*.internal.example.com"],
                        allowedCidrs: []
                };

                const normalized = normalizeServerUrl("https://chat.internal.example.com/path", policy);
                expect(normalized).toBe("https://chat.internal.example.com/path");
        });

        it("accepts upstream URLs that match allowlisted CIDR ranges", () => {
                const policy: UpstreamHostPolicy = {
                        enforceAllowlist: true,
                        allowedHosts: [],
                        allowedCidrs: ["10.0.0.0/8"]
                };

                const normalized = normalizeServerUrl("http://10.1.2.3:1234", policy);
                expect(normalized).toBe("http://10.1.2.3:1234");
        });

        it("rejects upstream URLs that miss the allowlist", () => {
                const policy: UpstreamHostPolicy = {
                        enforceAllowlist: true,
                        allowedHosts: ["bb.internal.example.com"],
                        allowedCidrs: []
                };

                expect(() => normalizeServerUrl("https://evil.example.com", policy)).toThrow(BffHttpError);

                try {
                        normalizeServerUrl("https://evil.example.com", policy);
                        throw new Error("Expected allowlist rejection");
                } catch(error) {
                        expect(error).toBeInstanceOf(BffHttpError);
                        expect((error as BffHttpError).code).toBe("BFF_UPSTREAM_HOST_NOT_ALLOWED");
                }
        });

        it("fails fast for malformed allowlist policy entries", () => {
                expect(() => assertValidUpstreamHostPolicy({
                        enforceAllowlist: true,
                        allowedHosts: [],
                        allowedCidrs: []
                })).toThrow("At least one upstream allowlist host or CIDR is required");

                expect(() => assertValidUpstreamHostPolicy({
                        enforceAllowlist: false,
                        allowedHosts: ["*evil.example.com"],
                        allowedCidrs: []
                })).toThrow("Invalid upstream host allowlist pattern");

                expect(() => assertValidUpstreamHostPolicy({
                        enforceAllowlist: false,
                        allowedHosts: [],
                        allowedCidrs: ["10.0.0.0/99"]
                })).toThrow("Invalid upstream CIDR allowlist value");
        });
});
