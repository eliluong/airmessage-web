import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {ConversationMediaFetchResult} from "shared/connection/connectionManager";
import type {ThreadFetchMetadata} from "shared/connection/communicationsManager";
import {ConversationAttachmentEntry, mergeConversationAttachments} from "shared/data/attachment";

const PAGE_SIZE = 30;

interface ConversationMediaCacheEntry {
        items: ConversationAttachmentEntry[];
        metadata?: ThreadFetchMetadata;
        hasMore: boolean;
        error?: string;
        loaded: boolean;
}

const mediaCache = new Map<string, ConversationMediaCacheEntry>();
let cacheScopeKey: string | undefined;

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

function ensureCacheScope() {
        const key = getConversationMediaCacheScopeKey();
        if(cacheScopeKey !== key) {
                mediaCache.clear();
                cacheScopeKey = key;
        }
}

function updateCacheEntry(guid: string, partial: Partial<ConversationMediaCacheEntry>): ConversationMediaCacheEntry {
        const existing = mediaCache.get(guid) ?? {items: [], metadata: undefined, hasMore: false, error: undefined, loaded: false};
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
        mediaCache.set(guid, next);
        return next;
}

function mergeMetadata(base: ThreadFetchMetadata | undefined, incoming: ThreadFetchMetadata | undefined): ThreadFetchMetadata | undefined {
        if(!incoming) return base;
        if(!base) return {...incoming};
        const merged: ThreadFetchMetadata = {...base};
        if(incoming.oldestServerID !== undefined && (merged.oldestServerID === undefined || incoming.oldestServerID < merged.oldestServerID)) {
                merged.oldestServerID = incoming.oldestServerID;
        }
        if(incoming.newestServerID !== undefined && (merged.newestServerID === undefined || incoming.newestServerID > merged.newestServerID)) {
                merged.newestServerID = incoming.newestServerID;
        }
        return merged;
}

function computeMetadataFromAttachments(items: ConversationAttachmentEntry[]): ThreadFetchMetadata | undefined {
        let oldest: number | undefined;
        let newest: number | undefined;
        for(const item of items) {
                const serverID = item.messageServerID;
                if(serverID === undefined) continue;
                if(oldest === undefined || serverID < oldest) oldest = serverID;
                if(newest === undefined || serverID > newest) newest = serverID;
        }
        if(oldest === undefined && newest === undefined) return undefined;
        return {oldestServerID: oldest, newestServerID: newest};
}

function mergeResultMetadata(previous: ThreadFetchMetadata | undefined, result: ConversationMediaFetchResult): ThreadFetchMetadata | undefined {
        const combined = mergeMetadata(result.metadata, computeMetadataFromAttachments(result.items));
        return mergeMetadata(previous, combined);
}

export interface ConversationMediaState {
        items: ConversationAttachmentEntry[];
        isLoading: boolean;
        isLoadingMore: boolean;
        error?: string;
        hasMore: boolean;
        loadMore: () => Promise<void>;
        reload: () => Promise<void>;
}

export default function useConversationMedia(chatGuid: string | undefined, open: boolean): ConversationMediaState {
        ensureCacheScope();
        const [items, setItems] = useState<ConversationAttachmentEntry[]>(() => (chatGuid ? mediaCache.get(chatGuid)?.items ?? [] : []));
        const [error, setError] = useState<string | undefined>(() => (chatGuid ? mediaCache.get(chatGuid)?.error : undefined));
        const [hasMore, setHasMore] = useState<boolean>(() => (chatGuid ? mediaCache.get(chatGuid)?.hasMore ?? false : false));
        const [isLoading, setIsLoading] = useState(false);
        const [isLoadingMore, setIsLoadingMore] = useState(false);
        const metadataRef = useRef<ThreadFetchMetadata | undefined>(chatGuid ? mediaCache.get(chatGuid)?.metadata : undefined);
        const mountedRef = useRef(true);

        useEffect(() => {
                mountedRef.current = true;
                return () => {
                        mountedRef.current = false;
                };
        }, []);

        useEffect(() => {
                ensureCacheScope();
                if(!chatGuid) {
                        setItems([]);
                        setHasMore(false);
                        setError(open ? "Media is unavailable for unsynced conversations." : undefined);
                        metadataRef.current = undefined;
                        return;
                }
                const cached = mediaCache.get(chatGuid);
                setItems(cached?.items ?? []);
                setHasMore(cached?.hasMore ?? false);
                setError(cached?.error);
                metadataRef.current = cached?.metadata;
        }, [chatGuid, open]);

        const loadInitial = useCallback(async (force: boolean = false) => {
                if(!chatGuid) {
                        setItems([]);
                        setHasMore(false);
                        setError("Media is unavailable for unsynced conversations.");
                        metadataRef.current = undefined;
                        return;
                }

                ensureCacheScope();

                const cached = mediaCache.get(chatGuid);
                if(!force && cached?.loaded) {
                        setItems(cached.items);
                        setHasMore(cached.hasMore);
                        setError(cached.error);
                        metadataRef.current = cached.metadata;
                        return;
                }

                if(ConnectionManager.getActiveProxyType() !== "BlueBubbles") {
                        const message = "Media is only available when connected to BlueBubbles.";
                        setItems([]);
                        setHasMore(false);
                        setError(message);
                        metadataRef.current = undefined;
                        updateCacheEntry(chatGuid, {items: [], metadata: undefined, hasMore: false, error: message, loaded: true});
                        return;
                }

                setIsLoading(true);
                setError(undefined);
                try {
                        const result = await ConnectionManager.fetchConversationMedia(chatGuid, {limit: PAGE_SIZE});
                        if(!mountedRef.current) return;
                        const attachments = result.items;
                        const metadata = mergeResultMetadata(undefined, result);
                        metadataRef.current = metadata;
                        const moreAvailable = attachments.length >= PAGE_SIZE && (metadata?.oldestServerID !== undefined);
                        setItems(attachments);
                        setHasMore(moreAvailable);
                        setError(undefined);
                        updateCacheEntry(chatGuid, {items: attachments, metadata, hasMore: moreAvailable, error: undefined, loaded: true});
                } catch(error) {
                        if(!mountedRef.current) return;
                        const message = "Unable to load media for this conversation.";
                        setItems([]);
                        setHasMore(false);
                        setError(message);
                        metadataRef.current = undefined;
                        updateCacheEntry(chatGuid, {items: [], metadata: undefined, hasMore: false, error: message, loaded: true});
                } finally {
                        if(mountedRef.current) {
                                setIsLoading(false);
                        }
                }
        }, [chatGuid]);

        useEffect(() => {
                if(!open) return;
                if(!chatGuid) {
                        setItems([]);
                        setHasMore(false);
                        setError("Media is unavailable for unsynced conversations.");
                        metadataRef.current = undefined;
                        return;
                }

                const cached = mediaCache.get(chatGuid);
                if(!cached || !cached.loaded) {
                        void loadInitial();
                }
        }, [open, chatGuid, loadInitial]);

        const loadMore = useCallback(async () => {
                if(!chatGuid || isLoading || isLoadingMore) return;

                ensureCacheScope();
                const oldest = metadataRef.current?.oldestServerID;
                if(oldest === undefined) {
                        setHasMore(false);
                        updateCacheEntry(chatGuid, {hasMore: false, metadata: metadataRef.current, loaded: true});
                        return;
                }

                setIsLoadingMore(true);
                try {
                        const result = await ConnectionManager.fetchConversationMedia(chatGuid, {
                                anchorMessageID: oldest,
                                direction: "before",
                                limit: PAGE_SIZE
                        });
                        if(!mountedRef.current) return;

                        const attachments = result.items;
                        const previousMetadata = metadataRef.current;
                        const mergedMetadata = mergeResultMetadata(previousMetadata, result);
                        metadataRef.current = mergedMetadata;

                        const previousOldest = previousMetadata?.oldestServerID;
                        const mergedOldest = mergedMetadata?.oldestServerID;
                        const moreAvailable = !(result.items.length === 0 || mergedOldest === previousOldest) && result.items.length >= PAGE_SIZE;
                        setHasMore(moreAvailable);
                        setItems((current) => {
                                const merged = mergeConversationAttachments(current, attachments);
                                updateCacheEntry(chatGuid, {
                                        items: merged,
                                        metadata: mergedMetadata,
                                        hasMore: moreAvailable,
                                        error: undefined,
                                        loaded: true
                                });
                                return merged;
                        });
                        if(attachments.length === 0 && !moreAvailable) {
                                updateCacheEntry(chatGuid, {metadata: mergedMetadata, hasMore: false, loaded: true});
                        }
                } catch(error) {
                        if(!mountedRef.current) return;
                        throw error;
                } finally {
                        if(mountedRef.current) {
                                setIsLoadingMore(false);
                        }
                }
        }, [chatGuid, isLoading, isLoadingMore]);

        const reload = useCallback(async () => {
                if(!chatGuid) return;
                ensureCacheScope();
                mediaCache.delete(chatGuid);
                metadataRef.current = undefined;
                await loadInitial(true);
        }, [chatGuid, loadInitial]);

        return useMemo(() => ({
                items,
                isLoading,
                isLoadingMore,
                error,
                hasMore,
                loadMore,
                reload
        }), [items, isLoading, isLoadingMore, error, hasMore, loadMore, reload]);
}
