import {
        getConfiguredBlueBubblesTransportMode,
        isBffTransportEnabled,
        isDirectBlueBubblesTransportEnabled
} from "../../../src/connection/bluebubbles/transport";

type RuntimeWpEnv = {
        BFF_ENABLED?: boolean;
        BFF_DIRECT_MODE_ENABLED?: boolean;
};

const globalWithWpEnv = globalThis as typeof globalThis & {WPEnv?: RuntimeWpEnv;};
const originalWpEnv = globalWithWpEnv.WPEnv;

function setWpEnv(overrides: RuntimeWpEnv): void {
        globalWithWpEnv.WPEnv = {
                BFF_ENABLED: true,
                BFF_DIRECT_MODE_ENABLED: false,
                ...overrides
        };
}

describe("bluebubbles transport configuration", () => {
        afterEach(() => {
                if(originalWpEnv === undefined) {
                        delete globalWithWpEnv.WPEnv;
                } else {
                        globalWithWpEnv.WPEnv = originalWpEnv;
                }
        });

        test("defaults to bff mode when WPEnv is unavailable", () => {
                delete globalWithWpEnv.WPEnv;

                expect(getConfiguredBlueBubblesTransportMode()).toBe("bff");
                expect(isBffTransportEnabled()).toBe(true);
        });

        test("uses direct mode only when bff is disabled and direct mode is explicitly enabled", () => {
                setWpEnv({
                        BFF_ENABLED: false,
                        BFF_DIRECT_MODE_ENABLED: true
                });

                expect(getConfiguredBlueBubblesTransportMode()).toBe("direct");
                expect(isDirectBlueBubblesTransportEnabled()).toBe(true);
        });

        test("fails closed when both bff and direct mode are disabled", () => {
                setWpEnv({
                        BFF_ENABLED: false,
                        BFF_DIRECT_MODE_ENABLED: false
                });

                expect(() => getConfiguredBlueBubblesTransportMode()).toThrow(
                        "Invalid BlueBubbles transport configuration: BFF is disabled and direct mode is not enabled."
                );
        });

        test("rejects direct mode when bff remains enabled", () => {
                setWpEnv({
                        BFF_ENABLED: true,
                        BFF_DIRECT_MODE_ENABLED: true
                });

                expect(() => getConfiguredBlueBubblesTransportMode()).toThrow(
                        "Invalid BlueBubbles transport configuration: direct mode requires BFF_ENABLED=false."
                );
        });
});
