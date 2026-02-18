import {createCipheriv, createHash, webcrypto} from "crypto";
import {
	parseBlueBubblesRealtimePayload,
	needsRealtimeHydration
} from "../../../src/connection/bluebubbles/realtimePayload";

describe("realtime payload parsing", () => {
	const passphrase = "guid-token";

	beforeAll(() => {
		if(!globalThis.crypto?.subtle) {
			Object.defineProperty(globalThis, "crypto", {
				value: webcrypto,
				configurable: true
			});
		}
	});

	it("parses raw realtime payload objects", async () => {
		const parsed = await parseBlueBubblesRealtimePayload({
			guid: "message-1",
			originalROWID: 1,
			dateCreated: 1000,
			isFromMe: false,
			isArchived: false,
			itemType: 0,
			groupActionType: 0,
			error: 0
		}, passphrase);

		expect(parsed.source).toBe("raw");
		expect(parsed.messages).toHaveLength(1);
		expect(parsed.messages[0]).toEqual(expect.objectContaining({guid: "message-1"}));
	});

	it("parses envelope payloads with JSON_STRING encoding", async () => {
		const parsed = await parseBlueBubblesRealtimePayload({
			data: JSON.stringify({
				guid: "message-2",
				originalROWID: 2,
				dateCreated: 2000,
				isFromMe: false,
				isArchived: false,
				itemType: 0,
				groupActionType: 0,
				error: 0
			}),
			encoding: "JSON_STRING"
		}, passphrase);

		expect(parsed.source).toBe("envelope");
		expect(parsed.encoding).toBe("JSON_STRING");
		expect(parsed.messages[0]).toEqual(expect.objectContaining({guid: "message-2"}));
	});

	it("decrypts encrypted realtime envelopes that use CryptoJS/OpenSSL salt format", async () => {
		const plaintext = JSON.stringify({
			guid: "message-3",
			originalROWID: 3,
			dateCreated: 3000,
			isFromMe: false,
			isArchived: false,
			itemType: 0,
			groupActionType: 0,
			error: 0
		});
		const encryptedPayload = encryptAESCryptoJS(plaintext, passphrase);
		const parsed = await parseBlueBubblesRealtimePayload({
			data: encryptedPayload,
			encrypted: true
		}, passphrase);

		expect(parsed.encrypted).toBe(true);
		expect(parsed.messages[0]).toEqual(expect.objectContaining({guid: "message-3"}));
	});

	it("requires hydration for partial or incomplete messages", () => {
		expect(needsRealtimeHydration({guid: "message-4"}, true)).toBe(true);
		expect(needsRealtimeHydration({
			guid: "message-4",
			originalROWID: 4,
			dateCreated: 4000,
			isFromMe: false,
			isArchived: false,
			itemType: 0,
			groupActionType: 0,
			error: 0
		}, false)).toBe(false);
	});
});

function encryptAESCryptoJS(plaintext: string, passphrase: string): string {
	const salt = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
	const {key, iv} = deriveCryptoJsKeyAndIv(passphrase, salt);
	const cipher = createCipheriv("aes-256-cbc", key, iv);
	const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
	return Buffer.concat([Buffer.from("Salted__", "utf8"), salt, ciphertext]).toString("base64");
}

function deriveCryptoJsKeyAndIv(passphrase: string, salt: Buffer): {key: Buffer; iv: Buffer;} {
	let digest = Buffer.alloc(0);
	let result = Buffer.alloc(0);
	const passphraseBytes = Buffer.from(passphrase, "utf8");

	while(result.length < 48) {
		const hash = createHash("md5");
		hash.update(digest);
		hash.update(passphraseBytes);
		hash.update(salt);
		digest = hash.digest();
		result = Buffer.concat([result, digest]);
	}

	return {
		key: result.subarray(0, 32),
		iv: result.subarray(32, 48)
	};
}
