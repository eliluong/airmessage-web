import {useCallback, useEffect, useMemo, useState} from "react";
import * as ConnectionManager from "shared/connection/connectionManager";
import {getConversationMediaCacheScopeKey} from "shared/state/useConversationMedia";

const MAX_CONCURRENT_REQUESTS = 4;

export type AttachmentThumbnailStatus = "idle" | "loading" | "loaded" | "error";

export interface AttachmentThumbnailState {
        status: AttachmentThumbnailStatus;
        url?: string;
        error?: string;
}

interface ThumbnailCacheEntry extends AttachmentThumbnailState {
        controller?: AbortController;
}

const thumbnailCache = new Map<string, ThumbnailCacheEntry>();
const listeners = new Set<() => void>();
const requestQueue: Array<() => void> = [];
let activeRequests = 0;
let cacheScopeKey: string | undefined;

function notifyListeners() {
        listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
                listeners.delete(listener);
        };
}

function revokeUrl(entry: ThumbnailCacheEntry | undefined) {
        if(entry?.url) {
                URL.revokeObjectURL(entry.url);
        }
}

function resetCacheForScopeChange() {
        requestQueue.length = 0;
        activeRequests = 0;
        thumbnailCache.forEach((entry) => {
                entry.controller?.abort();
                revokeUrl(entry);
        });
        thumbnailCache.clear();
        notifyListeners();
}

function ensureScope() {
        const scopeKey = getConversationMediaCacheScopeKey();
        if(cacheScopeKey !== scopeKey) {
                resetCacheForScopeChange();
                cacheScopeKey = scopeKey;
        }
}

function scheduleNext() {
        if(activeRequests >= MAX_CONCURRENT_REQUESTS) return;
        const task = requestQueue.shift();
        if(!task) return;
        task();
}

async function performDownload(guid: string, controller: AbortController) {
        try {
                const blob = await ConnectionManager.fetchAttachmentThumbnail(guid, controller.signal);
                if(controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const url = URL.createObjectURL(blob);
                const current = thumbnailCache.get(guid);
                if(!current) return;
                revokeUrl(current);
                thumbnailCache.set(guid, {status: "loaded", url});
        } catch(error) {
                if(controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
                        const current = thumbnailCache.get(guid);
                        if(current?.url) {
                                thumbnailCache.set(guid, {status: "loaded", url: current.url});
                        } else {
                                thumbnailCache.set(guid, {status: "idle"});
                        }
                } else {
                        console.warn("Failed to fetch attachment thumbnail", error);
                        const message = error instanceof Error && error.message ? error.message : "Failed to load thumbnail.";
                        thumbnailCache.set(guid, {status: "error", error: message});
                }
        } finally {
                const current = thumbnailCache.get(guid);
                if(current && current.controller === controller) {
                        delete current.controller;
                }
                activeRequests = Math.max(0, activeRequests - 1);
                notifyListeners();
                scheduleNext();
        }
}

function enqueueDownload(guid: string, controller: AbortController) {
        const entry = thumbnailCache.get(guid) ?? {status: "idle"};
        entry.status = "loading";
        entry.error = undefined;
        entry.controller = controller;
        thumbnailCache.set(guid, entry);
        notifyListeners();

        requestQueue.push(() => {
                activeRequests++;
                void performDownload(guid, controller);
        });
        scheduleNext();
}

function requestThumbnail(guid: string, abortSignal?: AbortSignal) {
        if(!guid) return;
        ensureScope();
        const existing = thumbnailCache.get(guid);
        if(existing?.status === "loaded") return;
        if(existing?.status === "loading") {
                if(abortSignal) {
                        if(abortSignal.aborted) existing.controller?.abort();
                        else if(existing.controller) {
                                abortSignal.addEventListener("abort", () => existing.controller?.abort(), {once: true});
                        }
                }
                return;
        }

        const controller = new AbortController();
        if(abortSignal) {
                if(abortSignal.aborted) controller.abort();
                else abortSignal.addEventListener("abort", () => controller.abort(), {once: true});
        }
        enqueueDownload(guid, controller);
}

function cancelActiveDownloads() {
        requestQueue.length = 0;
        thumbnailCache.forEach((entry, guid) => {
                if(entry.controller) {
                        entry.controller.abort();
                        const nextStatus: AttachmentThumbnailStatus = entry.url ? "loaded" : "idle";
                        thumbnailCache.set(guid, {status: nextStatus, url: entry.url});
                }
        });
        activeRequests = 0;
        notifyListeners();
}

function snapshotCache(): Map<string, AttachmentThumbnailState> {
        ensureScope();
        const snapshot = new Map<string, AttachmentThumbnailState>();
        thumbnailCache.forEach((entry, guid) => {
                const {status, url, error} = entry;
                snapshot.set(guid, {status, url, error});
        });
        return snapshot;
}

export interface UseAttachmentThumbnailsResult {
        thumbnails: Map<string, AttachmentThumbnailState>;
        loadThumbnail: (guid: string, abortSignal?: AbortSignal) => void;
        loadThumbnails: (guids: Iterable<string>, abortSignal?: AbortSignal) => void;
        cancelActive: () => void;
}

export default function useAttachmentThumbnails(open: boolean): UseAttachmentThumbnailsResult {
        const [version, setVersion] = useState(0);

        useEffect(() => {
                ensureScope();
                const unsubscribe = subscribe(() => setVersion((value) => value + 1));
                return () => {
                        unsubscribe();
                };
        }, []);

        useEffect(() => {
                if(!open) {
                        cancelActiveDownloads();
                }
        }, [open]);

        const loadThumbnail = useCallback((guid: string, abortSignal?: AbortSignal) => {
                requestThumbnail(guid, abortSignal);
        }, []);

        const loadThumbnails = useCallback((guids: Iterable<string>, abortSignal?: AbortSignal) => {
                for(const guid of guids) {
                        requestThumbnail(guid, abortSignal);
                }
        }, []);

        const cancelActive = useCallback(() => {
                cancelActiveDownloads();
        }, []);

        const thumbnails = useMemo(() => snapshotCache(), [version]);

        return {thumbnails, loadThumbnail, loadThumbnails, cancelActive};
}
