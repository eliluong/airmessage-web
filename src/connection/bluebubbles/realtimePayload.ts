import SparkMD5 from "spark-md5";
import {decodeBase64} from "../../util/encodingUtils";
import {MessageResponse} from "./types";

const OPENSSL_SALTED_PREFIX_BYTES = new Uint8Array([83, 97, 108, 116, 101, 100, 95, 95]);
const AES_KEY_LENGTH_BYTES = 32;
const AES_IV_LENGTH_BYTES = 16;
const AES_KEY_AND_IV_LENGTH_BYTES = AES_KEY_LENGTH_BYTES + AES_IV_LENGTH_BYTES;
const MD5_OUTPUT_LENGTH_BYTES = 16;

export type BlueBubblesRealtimePayloadEncoding = "JSON_OBJECT" | "JSON_STRING" | "BASE64";

interface BlueBubblesRealtimePayloadEnvelope {
	data?: unknown;
	encrypted?: unknown;
	partial?: unknown;
	encoding?: unknown;
	type?: unknown;
	subtype?: unknown;
	encryptionType?: unknown;
}

export interface ParsedBlueBubblesRealtimePayload {
	messages: Partial<MessageResponse>[];
	partial: boolean;
	encrypted: boolean;
	source: "raw" | "envelope";
	encoding: BlueBubblesRealtimePayloadEncoding;
}

export async function parseBlueBubblesRealtimePayload(
	payload: unknown,
	passphrase: string
): Promise<ParsedBlueBubblesRealtimePayload> {
	const envelope = isRealtimePayloadEnvelope(payload) ? payload : undefined;
	let partial = envelope?.partial === true;
	let encrypted = envelope?.encrypted === true;
	let encoding = normalizePayloadEncoding(envelope?.encoding);
	let source: "raw" | "envelope" = envelope ? "envelope" : "raw";
	let data: unknown = envelope?.data ?? payload;

	if(encrypted) {
		if(typeof data !== "string") {
			throw new Error("BlueBubbles realtime payload flagged encrypted but data is not a string");
		}
		data = await decryptAESCryptoJS(data, passphrase);
		encoding = "JSON_STRING";
	}

	data = decodeByEncoding(data, encoding);

	// Some server deployments wrap payload metadata inside an outer envelope.
	if(isRealtimePayloadEnvelope(data)) {
		source = "envelope";
		partial = partial || data.partial === true;
		encrypted = encrypted || data.encrypted === true;
		encoding = normalizePayloadEncoding(data.encoding);
		if(data.encrypted === true) {
			throw new Error("Nested encrypted realtime payload envelope is not supported");
		}
		data = decodeByEncoding(data.data ?? data, encoding);
	}

	const messages = normalizeRealtimeMessageCandidates(data);
	return {messages, partial, encrypted, source, encoding};
}

export function needsRealtimeHydration(message: Partial<MessageResponse>, envelopePartial: boolean): boolean {
	if(envelopePartial) return true;

	return !(
		typeof message.guid === "string"
		&& message.guid.trim().length > 0
		&& typeof message.originalROWID === "number"
		&& Number.isFinite(message.originalROWID)
		&& typeof message.dateCreated === "number"
		&& Number.isFinite(message.dateCreated)
		&& typeof message.isFromMe === "boolean"
		&& typeof message.isArchived === "boolean"
		&& typeof message.itemType === "number"
		&& typeof message.groupActionType === "number"
		&& typeof message.error === "number"
	);
}

async function decryptAESCryptoJS(encryptedPayload: string, passphrase: string): Promise<string> {
	if(passphrase.length === 0) {
		throw new Error("Cannot decrypt realtime payload without a non-empty passphrase");
	}

	const encryptedBytes = new Uint8Array(decodeBase64(encryptedPayload));
	if(encryptedBytes.length <= OPENSSL_SALTED_PREFIX_BYTES.length + 8) {
		throw new Error("Encrypted realtime payload is too short");
	}

	const prefix = encryptedBytes.subarray(0, OPENSSL_SALTED_PREFIX_BYTES.length);
	if(!byteArraysEqual(prefix, OPENSSL_SALTED_PREFIX_BYTES)) {
		throw new Error("Encrypted realtime payload is missing the OpenSSL salt prefix");
	}

	const salt = encryptedBytes.subarray(OPENSSL_SALTED_PREFIX_BYTES.length, OPENSSL_SALTED_PREFIX_BYTES.length + 8);
	const ciphertext = encryptedBytes.subarray(OPENSSL_SALTED_PREFIX_BYTES.length + 8);
	const {key, iv} = deriveCryptoJsKeyAndIv(passphrase, salt);

	const subtle = globalThis.crypto?.subtle;
	if(!subtle) {
		throw new Error("WebCrypto AES-CBC support is unavailable");
	}

	const cryptoKey = await subtle.importKey("raw", key, {name: "AES-CBC"}, false, ["decrypt"]);
	const decrypted = await subtle.decrypt({name: "AES-CBC", iv}, cryptoKey, ciphertext);
	return decodeUtf8(decrypted);
}

function deriveCryptoJsKeyAndIv(passphrase: string, salt: Uint8Array): {key: Uint8Array; iv: Uint8Array;} {
	const passphraseBytes = encodeUtf8(passphrase);
	const keyMaterial = new Uint8Array(AES_KEY_AND_IV_LENGTH_BYTES);
	let previousDigest = new Uint8Array(0);
	let bytesWritten = 0;

	while(bytesWritten < AES_KEY_AND_IV_LENGTH_BYTES) {
		const hashInput = concatByteArrays(previousDigest, passphraseBytes, salt);
		const digest = hexToBytes(SparkMD5.ArrayBuffer.hash(asArrayBuffer(hashInput)));
		const bytesToCopy = Math.min(digest.length, AES_KEY_AND_IV_LENGTH_BYTES - bytesWritten);
		keyMaterial.set(digest.subarray(0, bytesToCopy), bytesWritten);
		bytesWritten += bytesToCopy;
		previousDigest = digest;
	}

	return {
		key: keyMaterial.subarray(0, AES_KEY_LENGTH_BYTES),
		iv: keyMaterial.subarray(AES_KEY_LENGTH_BYTES, AES_KEY_AND_IV_LENGTH_BYTES)
	};
}

function decodeByEncoding(value: unknown, encoding: BlueBubblesRealtimePayloadEncoding): unknown {
	switch(encoding) {
		case "JSON_OBJECT":
			return parsePayloadJsonIfString(value);
		case "JSON_STRING":
			if(typeof value !== "string") {
				throw new Error("Realtime payload encoding JSON_STRING expects a string payload");
			}
			return parseJson(value);
		case "BASE64":
			if(typeof value !== "string") {
				throw new Error("Realtime payload encoding BASE64 expects a string payload");
			}
			return parseJson(decodeUtf8(new Uint8Array(decodeBase64(value))));
		default:
			return value;
	}
}

function parsePayloadJsonIfString(value: unknown): unknown {
	if(typeof value !== "string") return value;
	return parseJson(value);
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch(error) {
		throw new Error(`Failed to parse BlueBubbles realtime payload JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function normalizeRealtimeMessageCandidates(payload: unknown): Partial<MessageResponse>[] {
	const entries = Array.isArray(payload) ? payload : [payload];
	const messages: Partial<MessageResponse>[] = [];

	for(const entry of entries) {
		const normalized = parsePayloadJsonIfString(entry);
		if(!isObjectRecord(normalized)) {
			throw new Error("Realtime payload entry is not an object");
		}
		messages.push(normalized as Partial<MessageResponse>);
	}

	if(messages.length === 0) {
		throw new Error("Realtime payload did not include any message entries");
	}

	return messages;
}

function normalizePayloadEncoding(value: unknown): BlueBubblesRealtimePayloadEncoding {
	if(typeof value !== "string") {
		return "JSON_OBJECT";
	}

	switch(value.toUpperCase()) {
		case "JSON_STRING":
			return "JSON_STRING";
		case "BASE64":
			return "BASE64";
		default:
			return "JSON_OBJECT";
	}
}

function isRealtimePayloadEnvelope(value: unknown): value is BlueBubblesRealtimePayloadEnvelope {
	if(!isObjectRecord(value)) return false;
	return ("data" in value)
		|| ("partial" in value)
		|| ("encrypted" in value)
		|| ("encoding" in value)
		|| ("type" in value)
		|| ("subtype" in value)
		|| ("encryptionType" in value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function concatByteArrays(...parts: Uint8Array[]): Uint8Array {
	const totalLength = parts.reduce((total, part) => total + part.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for(const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function hexToBytes(value: string): Uint8Array {
	if(value.length % 2 !== 0) {
		throw new Error("Invalid hex digest length");
	}
	const result = new Uint8Array(value.length / 2);
	for(let index = 0; index < value.length; index += 2) {
		const pair = value.slice(index, index + 2);
		const parsed = Number.parseInt(pair, 16);
		if(Number.isNaN(parsed)) {
			throw new Error("Invalid hex digest value");
		}
		result[index / 2] = parsed;
	}
	if(result.length !== MD5_OUTPUT_LENGTH_BYTES) {
		throw new Error(`Unexpected MD5 digest size: ${result.length}`);
	}
	return result;
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
	if(left.length !== right.length) return false;
	for(let index = 0; index < left.length; index += 1) {
		if(left[index] !== right[index]) return false;
	}
	return true;
}

function encodeUtf8(value: string): Uint8Array {
	if(typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(value);
	}

	const bytes: number[] = [];
	const encoded = encodeURIComponent(value);
	for(let index = 0; index < encoded.length; index += 1) {
		const char = encoded[index];
		if(char === "%") {
			const byte = Number.parseInt(encoded.slice(index + 1, index + 3), 16);
			if(Number.isNaN(byte)) {
				throw new Error("Failed to UTF-8 encode string");
			}
			bytes.push(byte);
			index += 2;
		} else {
			bytes.push(char.charCodeAt(0));
		}
	}
	return new Uint8Array(bytes);
}

function decodeUtf8(value: ArrayBuffer | Uint8Array): string {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	if(typeof TextDecoder !== "undefined") {
		return new TextDecoder().decode(bytes);
	}

	let encoded = "";
	for(const byte of bytes) {
		encoded += `%${byte.toString(16).padStart(2, "0")}`;
	}
	return decodeURIComponent(encoded);
}
