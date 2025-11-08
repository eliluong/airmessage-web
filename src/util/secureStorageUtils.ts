import {decodeBase64, encodeBase64} from "shared/util/encodingUtils";

const ivLen = 12;

const jwkLocalEncryption: JsonWebKey = {
        kty: "oct",
        k: "s9lDeHtl0rh-3FpBDZwQvw",
        alg: "A128GCM"
};

let cachedCryptoKey: Promise<CryptoKey | undefined> | undefined;

function isSecureCryptoAvailable(): boolean {
        if(typeof globalThis === "undefined") {
                return false;
        }

        const cryptoObj = globalThis.crypto;
        const hasSubtle = Boolean(cryptoObj?.subtle);
        const secureContext = (globalThis as typeof globalThis & {isSecureContext?: boolean}).isSecureContext;

        return hasSubtle && secureContext !== false;
}

async function getCryptoKey(): Promise<CryptoKey | undefined> {
        if(!cachedCryptoKey) {
                if(!isSecureCryptoAvailable()) {
                        cachedCryptoKey = Promise.resolve(undefined);
                } else {
                        cachedCryptoKey = globalThis.crypto.subtle.importKey(
                                "jwk",
                                jwkLocalEncryption,
                                "AES-GCM",
                                false,
                                ["encrypt", "decrypt"]
                        ).catch(() => undefined);
                }
        }

        return cachedCryptoKey;
}

function getRandomValues(length: number): Uint8Array {
        const output = new Uint8Array(length);

        const cryptoObj = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
        if(cryptoObj?.getRandomValues) {
                return cryptoObj.getRandomValues(output);
        }

        for(let i = 0; i < length; i++) {
                output[i] = Math.floor(Math.random() * 256);
        }

        return output;
}

export enum SecureStorageKey {
        ServerPassword = "serverPassword",
        BlueBubblesServerUrl = "blueBubblesServerUrl",
        BlueBubblesToken = "blueBubblesToken",
        BlueBubblesRefreshToken = "blueBubblesRefreshToken",
        BlueBubblesDeviceName = "blueBubblesDeviceName",
        BlueBubblesTokenExpiry = "blueBubblesTokenExpiry"
}

function concatBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer {
        const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        tmp.set(new Uint8Array(buffer1), 0);
        tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
        return tmp;
}

async function encrypt(inData: ArrayBuffer, generateIV: boolean): Promise<ArrayBuffer | undefined> {
        const cryptoKey = await getCryptoKey();
        if(!cryptoKey) {
                return undefined;
        }

        const subtle = globalThis.crypto?.subtle;
        if(!subtle) {
                return undefined;
        }

        if(generateIV) {
                const iv = getRandomValues(ivLen);
                const encrypted = await subtle.encrypt({name: "AES-GCM", iv: iv}, cryptoKey, inData);
                return concatBuffers(iv, encrypted);
        } else {
                return subtle.encrypt({name: "AES-GCM", iv: new Uint8Array(ivLen)}, cryptoKey, inData);
        }
}

async function decrypt(inData: ArrayBuffer, useIV: boolean): Promise<ArrayBuffer | undefined> {
        const cryptoKey = await getCryptoKey();
        if(!cryptoKey) {
                return undefined;
        }

        const subtle = globalThis.crypto?.subtle;
        if(!subtle) {
                return undefined;
        }

        if(useIV) {
                const iv = inData.slice(0, ivLen);
                const data = inData.slice(ivLen);
                return subtle.decrypt({name: "AES-GCM", iv: iv}, cryptoKey, data);
        } else {
                return subtle.decrypt({name: "AES-GCM", iv: new Int8Array(ivLen)}, cryptoKey, inData);
        }
}

/**
 * Encrypts a string and returns it in base64 form
 */
async function encryptString(value: string, generateIV: boolean): Promise<string | undefined> {
        if(!await getCryptoKey()) {
                return undefined;
        }

        const encrypted = await encrypt(new TextEncoder().encode(value), generateIV);
        return encrypted ? encodeBase64(encrypted) : undefined;
}

/**
 * Decrypts a string from its base64 form
 */
async function decryptString(value: string, useIV: boolean): Promise<string | undefined> {
        if(!await getCryptoKey()) {
                return undefined;
        }

        const decrypted = await decrypt(decodeBase64(value), useIV);
        return decrypted ? new TextDecoder().decode(decrypted) : undefined;
}

/**
 * Stores a value in secure storage
 * @param key The storage key to use
 * @param value The value to use, or undefined to remove
 */
export async function setSecureLS(key: SecureStorageKey, value: string | undefined) {
        const encryptedKey = await encryptString(key, false);

        if(!encryptedKey) {
                if(value === undefined) {
                        localStorage.removeItem(key);
                } else {
                        localStorage.setItem(key, value);
                }
                return;
        }

        if(value === undefined) {
                localStorage.removeItem(encryptedKey);
        } else {
                const encryptedValue = await encryptString(value, true);
                if(encryptedValue) {
                        localStorage.setItem(encryptedKey, encryptedValue);
                }
        }
}

/**
 * Reads a value from secure storage
 * @param key The storage key to read from
 */
export async function getSecureLS(key: SecureStorageKey): Promise<string | undefined> {
        const encryptedKey = await encryptString(key, false);
        if(!encryptedKey) {
                const value = localStorage.getItem(key);
                return value ?? undefined;
        }

        const value = localStorage.getItem(encryptedKey);
        if(value === null) {
                return undefined;
        }

        try {
                return await decryptString(value, true);
        } catch {
                return undefined;
        }
}
