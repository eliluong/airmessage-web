import * as ConnectionManager from "shared/connection/connectionManager";
import type {ThreadFetchMetadata} from "shared/connection/communicationsManager";
import type {ConversationAttachmentEntry} from "shared/data/attachment";
import type {ConversationItem, MessageItem} from "shared/data/blocks";
import {ConversationItemType} from "shared/data/stateCodes";
import type UnsubscribeCallback from "shared/data/unsubscribeCallback";
import EventEmitter from "shared/util/eventEmitter";

export interface ConversationMediaCacheEntry {
        items: ConversationAttachmentEntry[];
        metadata?: ThreadFetchMetadata;
        hasMore: boolean;
        error?: string;
        loaded: boolean;
        fetchedAt?: number;
        stale?: boolean;
}

const mediaCache = new Map<string, ConversationMediaCacheEntry>();
let cacheScopeKey: string | undefined;
const expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();

const staleEmitter = new EventEmitter<string>();
const STALE_DEBOUNCE_MS = 250;
const pendingStaleChats = new Set<string>();
let staleDebounceHandle: ReturnType<typeof setTimeout> | null = null;

export const MEDIA_CACHE_TTL_MS = 10 * 60 * 1000;

export function getConversationMediaCacheScopeKey(): string {
        const proxyType = ConnectionManager.getActiveProxyType();
        if(proxyType === "BlueBubbles") {
                const auth = ConnectionManager.getBlueBubblesAuth();
                if(auth) {
                        const accountKey = [
                                auth.serverUrl,
                                auth.accessToken,
                                auth.refreshToken ?? "",
                                auth.deviceName ?? "",
                                auth.legacyPasswordAuth ? "legacy" : "modern"
                        ].join("|");
                        return `${proxyType}:${accountKey}`;
                }
                return `${proxyType}:no-auth`;
        }
        return proxyType;
}

function resetCacheForScopeChange() {
        for(const [chatGuid] of mediaCache) {
                clearExpirationTimer(chatGuid);
        }
        mediaCache.clear();
}

function ensureCacheScope() {
        const key = getConversationMediaCacheScopeKey();
        if(cacheScopeKey !== key) {
                resetCacheForScopeChange();
                cacheScopeKey = key;
        }
}

export function ensureConversationMediaCacheScope(): void {
        ensureCacheScope();
}

function scheduleExpiration(chatGuid: string, entry: ConversationMediaCacheEntry): void {
        clearExpirationTimer(chatGuid);
        if(!entry.loaded || !entry.fetchedAt) return;
        const now = Date.now();
        const elapsed = now - entry.fetchedAt;
        const remaining = MEDIA_CACHE_TTL_MS - elapsed;
        if(remaining <= 0) {
                markConversationMediaCacheEntryStale(chatGuid);
                return;
        }
        const handle = setTimeout(() => {
                expirationTimers.delete(chatGuid);
                markConversationMediaCacheEntryStale(chatGuid);
        }, remaining);
        expirationTimers.set(chatGuid, handle);
}

function clearExpirationTimer(chatGuid: string): void {
        const handle = expirationTimers.get(chatGuid);
        if(handle !== undefined) {
                clearTimeout(handle);
                expirationTimers.delete(chatGuid);
        }
}

function persistCacheEntry(chatGuid: string, entry: ConversationMediaCacheEntry): void {
        mediaCache.set(chatGuid, entry);
        scheduleExpiration(chatGuid, entry);
}

export function getConversationMediaCacheEntry(chatGuid: string): ConversationMediaCacheEntry | undefined {
        ensureCacheScope();
        return mediaCache.get(chatGuid);
}

export function updateConversationMediaCacheEntry(
        chatGuid: string,
        partial: Partial<ConversationMediaCacheEntry>
): ConversationMediaCacheEntry {
        ensureCacheScope();
        const existing: ConversationMediaCacheEntry = mediaCache.get(chatGuid) ?? {
                items: [],
                metadata: undefined,
                hasMore: false,
                error: undefined,
                loaded: false,
                fetchedAt: undefined,
                stale: false
        };
        const next: ConversationMediaCacheEntry = {...existing};
        if("items" in partial) {
                next.items = partial.items ?? [];
        }
        if("metadata" in partial) {
                next.metadata = partial.metadata;
        }
        if("hasMore" in partial) {
                next.hasMore = partial.hasMore ?? false;
        }
        if("error" in partial) {
                next.error = partial.error;
        }
        if("loaded" in partial) {
                next.loaded = partial.loaded ?? false;
        }
        if("fetchedAt" in partial) {
                next.fetchedAt = partial.fetchedAt;
        }
        if("stale" in partial) {
                next.stale = partial.stale;
        }
        persistCacheEntry(chatGuid, next);
        return next;
}

export function setConversationMediaCacheEntry(chatGuid: string, entry: ConversationMediaCacheEntry): void {
        ensureCacheScope();
        persistCacheEntry(chatGuid, entry);
}

export function deleteConversationMediaCacheEntry(chatGuid: string): void {
        ensureCacheScope();
        mediaCache.delete(chatGuid);
        clearExpirationTimer(chatGuid);
}

export function markConversationMediaCacheEntryStale(chatGuid: string): void {
        ensureCacheScope();
        const existing = mediaCache.get(chatGuid);
        if(!existing || existing.stale) return;
        clearExpirationTimer(chatGuid);
        mediaCache.set(chatGuid, {...existing, stale: true});
        staleEmitter.notify(chatGuid);
}

export function isConversationMediaCacheEntryFresh(
        entry: ConversationMediaCacheEntry | undefined,
        ttl: number = MEDIA_CACHE_TTL_MS
): boolean {
        if(!entry) return false;
        if(entry.stale) return false;
        if(!entry.fetchedAt) return false;
        return Date.now() - entry.fetchedAt < ttl;
}

export function clearConversationMediaCache(): void {
        for(const [chatGuid] of mediaCache) {
                clearExpirationTimer(chatGuid);
        }
        mediaCache.clear();
        cacheScopeKey = undefined;
}

export function subscribeToConversationMediaCacheStale(listener: (chatGuid: string) => void): UnsubscribeCallback {
        return staleEmitter.subscribe(listener);
}

function enqueueStaleChat(chatGuid: string): void {
        if(!chatGuid) return;
        pendingStaleChats.add(chatGuid);
        if(staleDebounceHandle !== null) return;
        staleDebounceHandle = setTimeout(() => {
                staleDebounceHandle = null;
                for(const pending of pendingStaleChats) {
                        markConversationMediaCacheEntryStale(pending);
                }
                pendingStaleChats.clear();
        }, STALE_DEBOUNCE_MS);
}

function handleMessageUpdates(items: ConversationItem[]): void {
        for(const item of items) {
                        if(item.itemType !== ConversationItemType.Message) continue;
                        const message = item as MessageItem;
                        if(typeof message.chatGuid !== "string") continue;
                        if(message.attachments.length === 0) continue;
                        const hasImageAttachment = message.attachments.some((attachment) => {
                                const type = attachment.type?.toLowerCase();
                                return typeof type === "string" && type.startsWith("image/");
                        });
                        if(!hasImageAttachment) continue;
                        enqueueStaleChat(message.chatGuid);
        }
}

ConnectionManager.messageUpdateEmitter.subscribe(handleMessageUpdates);
