export interface LinkPreviewData {
        title: string;
        description: string;
        image: string;
        url: string;
}

export interface CachedLinkPreview {
        data: LinkPreviewData | null;
        error?: string;
        fetchedAt: number;
}

const CACHE_STORAGE_KEY = "linkPreviewCache";
export const LINK_PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const memoryCache = new Map<string, CachedLinkPreview>();
let storageLoaded = false;

function isExpired(entry: CachedLinkPreview): boolean {
        return Date.now() - entry.fetchedAt > LINK_PREVIEW_CACHE_TTL_MS;
}

function ensureStorageLoaded() {
        if (storageLoaded || typeof window === "undefined") {
                return;
        }

        storageLoaded = true;

        try {
                const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
                if (!raw) {
                        return;
                }

                const parsed = JSON.parse(raw) as Record<string, CachedLinkPreview>;
                Object.entries(parsed).forEach(([url, entry]) => {
                        if (entry && typeof entry.fetchedAt === "number" && !isExpired(entry)) {
                                memoryCache.set(url, entry);
                        }
                });
        } catch (error) {
                console.warn("Failed to load link preview cache", error);
        }
}

function persistCache() {
        if (typeof window === "undefined") {
                return;
        }

        const serializable: Record<string, CachedLinkPreview> = {};
        memoryCache.forEach((entry, url) => {
                if (!isExpired(entry)) {
                        serializable[url] = entry;
                }
        });

        try {
                window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(serializable));
        } catch (error) {
                console.warn("Failed to persist link preview cache", error);
        }
}

export function getCachedLinkPreview(url: string): CachedLinkPreview | undefined {
        ensureStorageLoaded();

        const entry = memoryCache.get(url);
        if (!entry) {
                return undefined;
        }

        if (isExpired(entry)) {
                memoryCache.delete(url);
                persistCache();
                return undefined;
        }

        return entry;
}

export function setCachedLinkPreview(url: string, entry: CachedLinkPreview): void {
        ensureStorageLoaded();

        memoryCache.set(url, entry);
        persistCache();
}

export function clearLinkPreviewCache(): void {
        memoryCache.clear();
        if (typeof window !== "undefined") {
                window.localStorage.removeItem(CACHE_STORAGE_KEY);
        }
}
