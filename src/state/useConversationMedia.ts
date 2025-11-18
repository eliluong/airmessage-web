import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {ConversationMediaFetchResult} from "shared/connection/connectionManager";
import type {ThreadFetchMetadata} from "shared/connection/communicationsManager";
import {ConversationAttachmentEntry, mergeConversationAttachments} from "shared/data/attachment";
import {
deleteConversationMediaCacheEntry,
ensureConversationMediaCacheScope,
getConversationMediaCacheEntry,
isConversationMediaCacheEntryFresh,
subscribeToConversationMediaCacheStale,
updateConversationMediaCacheEntry
} from "shared/state/mediaCache";
import {warmConversationMediaThumbnails} from "shared/state/mediaThumbnailWarmup";

const PAGE_SIZE = 30;
const PREFETCH_TIMEOUT_MS = 1000;
const THUMBNAIL_WARM_LIMIT = 10;

interface UseConversationMediaOptions {
        enabled?: boolean;
        visible?: boolean;
}

type CancelDeferredTask = () => void;

function scheduleDeferredTask(task: () => void): CancelDeferredTask {
        if(typeof window === "undefined") {
                const timeout = setTimeout(task, 0);
                return () => clearTimeout(timeout);
        }
        const win = window as typeof window & {
                requestIdleCallback?: (cb: () => void, options?: {timeout: number}) => number;
                cancelIdleCallback?: (handle: number) => void;
        };
        if(typeof win.requestIdleCallback === "function") {
                const handle = win.requestIdleCallback(task, {timeout: PREFETCH_TIMEOUT_MS});
                return () => {
                        if(typeof win.cancelIdleCallback === "function") {
                                win.cancelIdleCallback(handle);
                        }
                };
        }
        const timeout = window.setTimeout(task, 0);
        return () => window.clearTimeout(timeout);
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

export default function useConversationMedia(chatGuid: string | undefined, options?: UseConversationMediaOptions): ConversationMediaState {
        ensureConversationMediaCacheScope();
        const prefetchEnabled = options?.enabled ?? false;
        const visibilityEnabled = options?.visible ?? false;
        const effectiveEnabled = options?.enabled ?? options?.visible ?? false;
        const initialCache = chatGuid ? getConversationMediaCacheEntry(chatGuid) : undefined;
        const [items, setItems] = useState<ConversationAttachmentEntry[]>(() => initialCache?.items ?? []);
        const [error, setError] = useState<string | undefined>(() => initialCache?.error);
        const [hasMore, setHasMore] = useState<boolean>(() => initialCache?.hasMore ?? false);
        const [isLoading, setIsLoading] = useState(false);
        const [isLoadingMore, setIsLoadingMore] = useState(false);
        const metadataRef = useRef<ThreadFetchMetadata | undefined>(initialCache?.metadata);
        const mountedRef = useRef(true);
        const warmupAbortRef = useRef<AbortController | null>(null);

        useEffect(() => {
                mountedRef.current = true;
                return () => {
                        mountedRef.current = false;
                };
        }, []);

        useEffect(() => {
                return () => {
                        warmupAbortRef.current?.abort();
                        warmupAbortRef.current = null;
                };
        }, [chatGuid]);

        const maybeWarmThumbnails = useCallback((attachments: ConversationAttachmentEntry[]) => {
                if(!prefetchEnabled) return;
                if(attachments.length === 0) return;
                if(typeof navigator !== "undefined") {
                        const connection = (navigator as Navigator & {
                                connection?: {
                                        saveData?: boolean;
                                        effectiveType?: string;
                                };
                        }).connection;
                        if(connection?.saveData) return;
                        const effectiveType = connection?.effectiveType;
                        if(typeof effectiveType === "string" && /(^|-)2g/.test(effectiveType)) return;
                }
                if(typeof document !== "undefined" && document.visibilityState === "hidden") return;
                warmupAbortRef.current?.abort();
                const controller = new AbortController();
                warmupAbortRef.current = controller;
                void warmConversationMediaThumbnails(attachments, {signal: controller.signal, limit: THUMBNAIL_WARM_LIMIT});
        }, [prefetchEnabled]);

        useEffect(() => {
                ensureConversationMediaCacheScope();
                if(!chatGuid) {
                        setItems([]);
                        setHasMore(false);
                        setError(undefined);
                        metadataRef.current = undefined;
                        return;
                }
                const cached = getConversationMediaCacheEntry(chatGuid);
                if(cached) {
                        setItems(cached.items);
                        setHasMore(cached.hasMore);
                        setError(cached.error);
                        metadataRef.current = cached.metadata;
                } else {
                        setItems([]);
                        setHasMore(false);
                        setError(undefined);
                        metadataRef.current = undefined;
                }
        }, [chatGuid]);

	const loadInitial = useCallback(async (force: boolean = false) => {
		if(!chatGuid) {
			const message = "Media is unavailable for unsynced conversations.";
			setItems([]);
			setHasMore(false);
			setError(message);
			metadataRef.current = undefined;
			return;
		}

		ensureConversationMediaCacheScope();

		const cached = getConversationMediaCacheEntry(chatGuid);
		if(cached?.loaded) {
			setItems(cached.items);
			setHasMore(cached.hasMore);
			setError(cached.error);
			metadataRef.current = cached.metadata;
			maybeWarmThumbnails(cached.items);
		} else {
			setItems([]);
			setHasMore(false);
			setError(undefined);
			metadataRef.current = undefined;
		}

		const needsFetch = force || !cached?.loaded || !isConversationMediaCacheEntryFresh(cached);
		if(!needsFetch) return;

		if(ConnectionManager.getActiveProxyType() !== "BlueBubbles") {
			const message = "Media is only available when connected to BlueBubbles.";
			if(!cached?.loaded) {
				setItems([]);
				setHasMore(false);
				metadataRef.current = undefined;
			}
			setError(message);
			updateConversationMediaCacheEntry(chatGuid, {
				items: [],
				metadata: undefined,
				hasMore: false,
				error: message,
				loaded: true,
				fetchedAt: Date.now(),
				stale: false
			});
			return;
		}

		const backgroundFetch = Boolean(cached?.loaded) && !force;
		if(!backgroundFetch) {
			setIsLoading(true);
			setError(undefined);
		}
		try {
			const result = await ConnectionManager.fetchConversationMedia(chatGuid, {limit: PAGE_SIZE});
			if(!mountedRef.current) return;
			const attachments = result.items;
			const metadata = mergeResultMetadata(undefined, result);
			metadataRef.current = metadata;
			const moreAvailable = attachments.length >= PAGE_SIZE && metadata?.oldestServerID !== undefined;
			setItems(attachments);
			setHasMore(moreAvailable);
			setError(undefined);
			updateConversationMediaCacheEntry(chatGuid, {
				items: attachments,
				metadata,
				hasMore: moreAvailable,
				error: undefined,
				loaded: true,
				fetchedAt: Date.now(),
				stale: false
			});
			maybeWarmThumbnails(attachments);
		} catch(error) {
			if(!mountedRef.current) return;
			const message = "Unable to load media for this conversation.";
			if(!cached?.loaded) {
				setItems([]);
				setHasMore(false);
				metadataRef.current = undefined;
			}
			setError(message);
			updateConversationMediaCacheEntry(chatGuid, {
				items: cached?.loaded ? cached.items : [],
				metadata: cached?.loaded ? cached.metadata : undefined,
				hasMore: cached?.loaded ? cached.hasMore : false,
				error: message,
				loaded: true,
				fetchedAt: Date.now(),
				stale: false
			});
		} finally {
			if(!backgroundFetch && mountedRef.current) {
				setIsLoading(false);
			}
		}
	}, [chatGuid, maybeWarmThumbnails]);


        useEffect(() => {
                if(!effectiveEnabled) return;
                const cancel = scheduleDeferredTask(() => {
                        void loadInitial();
                });
                return () => cancel();
        }, [effectiveEnabled, loadInitial]);

        useEffect(() => {
                if(!chatGuid) return;
                return subscribeToConversationMediaCacheStale((staleChatGuid) => {
                        if(staleChatGuid !== chatGuid) return;
                        if(!prefetchEnabled && !visibilityEnabled) return;
                        void loadInitial();
                });
        }, [chatGuid, loadInitial, prefetchEnabled, visibilityEnabled]);

        const loadMore = useCallback(async () => {
                if(!chatGuid || isLoading || isLoadingMore) return;

                ensureConversationMediaCacheScope();
                const oldest = metadataRef.current?.oldestServerID;
                if(oldest === undefined) {
                        setHasMore(false);
                        updateConversationMediaCacheEntry(chatGuid, {hasMore: false, metadata: metadataRef.current, loaded: true, fetchedAt: Date.now(), stale: false});
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
                                updateConversationMediaCacheEntry(chatGuid, {
                                        items: merged,
                                        metadata: mergedMetadata,
                                        hasMore: moreAvailable,
                                        error: undefined,
                                        loaded: true,
                                        fetchedAt: Date.now(),
                                        stale: false
                                });
                                return merged;
                        });
                        if(attachments.length === 0 && !moreAvailable) {
                                updateConversationMediaCacheEntry(chatGuid, {
                                        metadata: mergedMetadata,
                                        hasMore: false,
                                        loaded: true,
                                        fetchedAt: Date.now(),
                                        stale: false
                                });
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
                ensureConversationMediaCacheScope();
                deleteConversationMediaCacheEntry(chatGuid);
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
