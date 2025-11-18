import {getConversationMediaCacheScopeKey} from "shared/state/mediaCache";

export interface MediaThumbnailCacheEntry {
	readonly url: string;
	readonly byteSize: number;
	readonly createdAt: number;
}

const MAX_CACHE_SIZE_BYTES = 15 * 1024 * 1024;
const thumbnailCache = new Map<string, MediaThumbnailCacheEntry>();
let scopeKey: string | undefined;
let totalBytes = 0;

function revokeEntry(entry: MediaThumbnailCacheEntry | undefined) {
	if(entry) {
		URL.revokeObjectURL(entry.url);
	}
}

function clearInternal() {
	thumbnailCache.forEach((entry) => revokeEntry(entry));
	thumbnailCache.clear();
	totalBytes = 0;
}

function ensureScope() {
	const key = getConversationMediaCacheScopeKey();
	if(scopeKey !== key) {
		clearInternal();
		scopeKey = key;
	}
}

function evictIfNeeded() {
	while(totalBytes > MAX_CACHE_SIZE_BYTES && thumbnailCache.size > 0) {
		const iterator = thumbnailCache.keys().next();
		if(iterator.done) break;
		const guid = iterator.value;
		const entry = thumbnailCache.get(guid);
		if(!entry) {
			thumbnailCache.delete(guid);
			continue;
		}
		thumbnailCache.delete(guid);
		totalBytes = Math.max(0, totalBytes - entry.byteSize);
		revokeEntry(entry);
	}
}

function setEntry(guid: string, entry: MediaThumbnailCacheEntry) {
	const existing = thumbnailCache.get(guid);
	if(existing) {
		thumbnailCache.delete(guid);
		totalBytes = Math.max(0, totalBytes - existing.byteSize);
		revokeEntry(existing);
	}
thumbnailCache.set(guid, entry);
totalBytes += entry.byteSize;
	evictIfNeeded();
}

export function storeMediaThumbnailBlob(guid: string, blob: Blob): string {
	ensureScope();
	const url = URL.createObjectURL(blob);
	const entry: MediaThumbnailCacheEntry = {url, byteSize: blob.size, createdAt: Date.now()};
	setEntry(guid, entry);
	return url;
}

export function setMediaThumbnailCacheEntry(guid: string, url: string, byteSize: number): void {
	ensureScope();
	setEntry(guid, {url, byteSize, createdAt: Date.now()});
}

export function getMediaThumbnailCacheUrl(guid: string): string | undefined {
	ensureScope();
	const entry = thumbnailCache.get(guid);
	if(!entry) return undefined;
	thumbnailCache.delete(guid);
	thumbnailCache.set(guid, {...entry, createdAt: Date.now()});
	return entry.url;
}

export function hasMediaThumbnailCacheEntry(guid: string): boolean {
	ensureScope();
	return thumbnailCache.has(guid);
}

export function deleteMediaThumbnailCacheEntry(guid: string): void {
	ensureScope();
	const entry = thumbnailCache.get(guid);
	if(entry) {
		thumbnailCache.delete(guid);
		totalBytes = Math.max(0, totalBytes - entry.byteSize);
		revokeEntry(entry);
	}
}

export function clearMediaThumbnailCache(): void {
	clearInternal();
	scopeKey = undefined;
}

export function getMediaThumbnailCacheSizeBytes(): number {
	return totalBytes;
}
