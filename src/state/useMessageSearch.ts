import {useCallback, useEffect, useRef, useState} from "react";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {MessageSearchOptions, MessageSearchResult, MessageSearchMetadata} from "shared/connection/messageSearch";
import type {MessageSearchHit} from "shared/data/blocks";

interface UseMessageSearchConfig {
        debounceMs?: number;
}

interface UseMessageSearchState {
        results: MessageSearchHit[];
        metadata?: MessageSearchMetadata;
        loading: boolean;
        error: Error | undefined;
        search: (options: MessageSearchOptions | undefined) => void;
        cancel: () => void;
}

function normalizeError(error: unknown): Error {
        if(error instanceof Error) return error;
        return new Error(String(error));
}

export default function useMessageSearch(config: UseMessageSearchConfig = {}): UseMessageSearchState {
        const {debounceMs = 300} = config;
        const [results, setResults] = useState<MessageSearchHit[]>([]);
        const [metadata, setMetadata] = useState<MessageSearchMetadata | undefined>(undefined);
        const [loading, setLoading] = useState(false);
        const [error, setError] = useState<Error | undefined>(undefined);
        const [pendingOptions, setPendingOptions] = useState<MessageSearchOptions | undefined>(undefined);
        const [requestSequence, setRequestSequence] = useState(0);
        const debounceHandleRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
        const activeRequestRef = useRef(0);

        const clearPendingTimeout = useCallback(() => {
                if(debounceHandleRef.current !== undefined) {
                        window.clearTimeout(debounceHandleRef.current);
                        debounceHandleRef.current = undefined;
                }
        }, []);

        const cancel = useCallback(() => {
                clearPendingTimeout();
                activeRequestRef.current += 1;
                setLoading(false);
        }, [clearPendingTimeout]);

        const search = useCallback((options: MessageSearchOptions | undefined) => {
                setPendingOptions(options);
                setRequestSequence((current) => current + 1);
        }, []);

        useEffect(() => {
                clearPendingTimeout();

                const options = pendingOptions;
                if(!options || options.term.trim().length === 0) {
                        activeRequestRef.current += 1;
                        setLoading(false);
                        setError(undefined);
                        setResults([]);
                        setMetadata(undefined);
                        return;
                }

                const requestId = activeRequestRef.current + 1;
                activeRequestRef.current = requestId;
                setLoading(true);
                setError(undefined);

                debounceHandleRef.current = window.setTimeout(() => {
                        if(activeRequestRef.current !== requestId) return;

                        ConnectionManager.searchMessages(options)
                                .then((result: MessageSearchResult) => {
                                        if(activeRequestRef.current !== requestId) return;
                                        setResults(result.items);
                                        setMetadata(result.metadata);
                                        setError(undefined);
                                })
                                .catch((err) => {
                                        if(activeRequestRef.current !== requestId) return;
                                        setError(normalizeError(err));
                                        setResults([]);
                                        setMetadata(undefined);
                                })
                                .finally(() => {
                                        if(activeRequestRef.current === requestId) {
                                                setLoading(false);
                                        }
                                });
                }, debounceMs);

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
                search,
                cancel
        };
}
