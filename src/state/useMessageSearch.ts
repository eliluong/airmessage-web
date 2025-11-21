import {useCallback, useEffect, useRef, useState} from "react";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {MessageSearchOptions, MessageSearchResult, MessageSearchMetadata} from "shared/connection/messageSearch";
import type {MessageSearchHit} from "shared/data/blocks";
import {searchCache} from "shared/state/searchCache";

interface UseMessageSearchConfig {
        debounceMs?: number;
}

interface UseMessageSearchState {
        results: MessageSearchHit[];
        metadata?: MessageSearchMetadata;
        loading: boolean;
        error: Error | undefined;
        cacheKey?: string;
        options?: MessageSearchOptions;
        fromCache: boolean;
        stale: boolean;
        search: (options: MessageSearchOptions | undefined, immediate?: boolean) => void;
        cancel: () => void;
}

function normalizeError(error: unknown): Error {
        if(error instanceof Error) return error;
        return new Error(String(error));
}

export default function useMessageSearch(config: UseMessageSearchConfig = {}): UseMessageSearchState {
        const {debounceMs = 250} = config;
        const [results, setResults] = useState<MessageSearchHit[]>([]);
        const [metadata, setMetadata] = useState<MessageSearchMetadata | undefined>(undefined);
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState<Error | undefined>(undefined);
        const [fromCache, setFromCache] = useState(false);
        const [stale, setStale] = useState(false);
        const [activeOptions, setActiveOptions] = useState<MessageSearchOptions | undefined>(undefined);
        const [cacheKey, setCacheKey] = useState<string | undefined>(undefined);
        const [pendingOptions, setPendingOptions] = useState<MessageSearchOptions | undefined>(undefined);
        const [requestSequence, setRequestSequence] = useState(0);
        const debounceHandleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
        const activeRequestRef = useRef(0);
        const pendingImmediateRef = useRef(false);

        const clearPendingTimeout = useCallback(() => {
                if(debounceHandleRef.current !== undefined) {
                        clearTimeout(debounceHandleRef.current);
                        debounceHandleRef.current = undefined;
                }
        }, []);

        const cancel = useCallback(() => {
                clearPendingTimeout();
                activeRequestRef.current += 1;
                setLoading(false);
        }, [clearPendingTimeout]);

        const search = useCallback((options: MessageSearchOptions | undefined, immediate = false) => {
                pendingImmediateRef.current = immediate;
                setPendingOptions(options);
                setRequestSequence((current) => current + 1);
        }, []);

        useEffect(() => {
                clearPendingTimeout();

                const options = pendingOptions;
                const immediate = pendingImmediateRef.current;
                pendingImmediateRef.current = false;
                setActiveOptions(options);

                if(!options || options.term.trim().length === 0) {
                        activeRequestRef.current += 1;
                        setLoading(false);
                        setError(undefined);
                        setResults([]);
                        setMetadata(undefined);
                        setFromCache(false);
                        setStale(false);
                        setCacheKey(undefined);
                        return;
                }

                const key = searchCache.makeKey(options);
                setCacheKey(key);

                const requestId = activeRequestRef.current + 1;
                activeRequestRef.current = requestId;

                setError(undefined);

                const cachedResult = searchCache.get(key);
                const shouldRefresh = !cachedResult || cachedResult.stale;

                if(cachedResult) {
                        setResults(cachedResult.results);
                        setMetadata(cachedResult.metadata);
                        setFromCache(true);
                        setStale(!!cachedResult.stale);
                        setLoading(false);
                } else {
                        setFromCache(false);
                        setStale(false);
                        setLoading(true);
                }

                if(!shouldRefresh) {
                        return;
                }

                const performSearch = () => {
                        if(activeRequestRef.current !== requestId) return;

                        ConnectionManager.searchMessages(options)
                                .then((result: MessageSearchResult) => {
                                        if(activeRequestRef.current !== requestId) return;
                                        searchCache.put(key, {options, results: result.items, metadata: result.metadata});
                                        setResults(result.items);
                                        setMetadata(result.metadata);
                                        setError(undefined);
                                        setFromCache(false);
                                        setStale(false);
                                })
                                .catch((err) => {
                                        if(activeRequestRef.current !== requestId) return;
                                        setError(normalizeError(err));
                                        if(!cachedResult) {
                                                setResults([]);
                                                setMetadata(undefined);
                                                setFromCache(false);
                                        } else {
                                                setFromCache(true);
                                                setStale(true);
                                        }
                                })
                                .finally(() => {
                                        if(activeRequestRef.current === requestId) {
                                                setLoading(false);
                                        }
                                });
                };

                if(immediate || debounceMs <= 0) {
                        performSearch();
                } else {
                        debounceHandleRef.current = setTimeout(performSearch, debounceMs);
                }

                return () => {
                        clearPendingTimeout();
                };
        }, [pendingOptions, requestSequence, debounceMs, clearPendingTimeout]);

        useEffect(() => () => {
                clearPendingTimeout();
                activeRequestRef.current += 1;
        }, [clearPendingTimeout]);

        return {
                results,
                metadata,
                loading,
                error,
                cacheKey,
                options: activeOptions,
                fromCache,
                stale,
                search,
                cancel
        };
}
