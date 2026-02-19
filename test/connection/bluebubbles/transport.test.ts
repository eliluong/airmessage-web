import {setBffCsrfToken} from "../../../src/connection/bluebubbles/bff/csrf";
import {resolveAttachmentUploadTarget} from "../../../src/connection/bluebubbles/transport";
import type {BlueBubblesAuthState} from "../../../src/connection/bluebubbles/session";

describe("bluebubbles transport bff phase 2 routes", () => {
        const bffAuth: BlueBubblesAuthState = {
                serverUrl: "https://example.com",
                accessToken: "__bff_session__",
                transportMode: "bff"
        };

        afterEach(() => {
                setBffCsrfToken(undefined);
        });

        it("resolves bff attachment upload target with csrf header", () => {
                setBffCsrfToken("csrf-upload-token");

                const target = resolveAttachmentUploadTarget(bffAuth);

                expect(target.url).toBe("/bff/message/attachment");
                expect(target.headers).toEqual({
                        "X-CSRF-Token": "csrf-upload-token"
                });
                expect(target.withCredentials).toBe(true);
        });

        it("throws when bff upload target is requested without a csrf token", () => {
                expect(() => resolveAttachmentUploadTarget(bffAuth)).toThrow(
                        "Upload attachment failed: BFF CSRF token is missing."
                );
        });
});
