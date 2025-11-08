import {SecureStorageKey} from "../../src/util/secureStorageUtils";

describe("secureStorageUtils", () => {
        beforeEach(() => {
                localStorage.clear();
                jest.resetModules();
                // Ensure globals from previous tests are removed before re-importing the module
                delete (globalThis as {crypto?: Crypto}).crypto;
                delete (globalThis as {isSecureContext?: boolean}).isSecureContext;
        });

        it("falls back to plaintext storage when crypto is unavailable", async () => {
                const {SecureStorageKey, setSecureLS, getSecureLS} = await import("../../src/util/secureStorageUtils");

                await setSecureLS(SecureStorageKey.ServerPassword, "plain-value");

                expect(localStorage.getItem(SecureStorageKey.ServerPassword)).toBe("plain-value");
                await expect(getSecureLS(SecureStorageKey.ServerPassword)).resolves.toBe("plain-value");

                await setSecureLS(SecureStorageKey.ServerPassword, undefined);
                expect(localStorage.getItem(SecureStorageKey.ServerPassword)).toBeNull();
        });

        it("encrypts and decrypts values when crypto is available", async () => {
                const {webcrypto} = await import("crypto");
                (globalThis as {crypto?: Crypto}).crypto = webcrypto as unknown as Crypto;
                (globalThis as {isSecureContext?: boolean}).isSecureContext = true;
                const {TextEncoder, TextDecoder} = await import("util");
                (globalThis as {TextEncoder?: typeof TextEncoder}).TextEncoder = TextEncoder;
                (globalThis as {TextDecoder?: typeof TextDecoder}).TextDecoder = TextDecoder;

                const {SecureStorageKey, setSecureLS, getSecureLS} = await import("../../src/util/secureStorageUtils");

                await setSecureLS(SecureStorageKey.ServerPassword, "secret-value");

                expect(localStorage.getItem(SecureStorageKey.ServerPassword)).toBeNull();
                expect(localStorage.length).toBe(1);

                await expect(getSecureLS(SecureStorageKey.ServerPassword)).resolves.toBe("secret-value");
        });
});
