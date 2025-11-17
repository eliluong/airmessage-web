import type {MessageSearchHit} from "shared/data/blocks";
import type {MessageSearchMetadata, MessageSearchOptions} from "shared/connection/messageSearch";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {ConversationItem, MessageModifier} from "shared/data/blocks";

interface SearchCacheViewState {
        scrollTop?: number;
}

interface SearchCacheEntry {
        key: string;
        options: MessageSearchOptions;
        results: MessageSearchHit[];
        metadata?: MessageSearchMetadata;
        createdAt: number;
        expiresAt: number;
        stale: boolean;
        viewState?: SearchCacheViewState;
}

interface PutPayload {
        options: MessageSearchOptions;
        results: MessageSearchHit[];
        metadata?: MessageSearchMetadata;
}

const MAX_ENTRIES = 8;
const TTL_MS = 10 * 60 * 1000;

function normalizeValue(value: unknown): unknown {
        if(value instanceof Date) {
                return value.toISOString();
        }
        if(Array.isArray(value)) {
                return value.map(normalizeValue);
        }
        if(value && typeof value === "object") {
                const normalized: Record<string, unknown> = {};
                for(const key of Object.keys(value).sort()) {
                        normalized[key] = normalizeValue((value as Record<string, unknown>)[key]);
                }
                return normalized;
        }
        return value;
}

class SearchCache {
        private readonly map = new Map<string, SearchCacheEntry>();

        public makeKey(options: MessageSearchOptions): string {
                return JSON.stringify(normalizeValue(options));
        }

        public get(key: string): SearchCacheEntry | undefined {
                const entry = this.map.get(key);
                if(!entry) return undefined;

                if(entry.expiresAt <= Date.now()) {
                        entry.stale = true;
                }

                this.touch(key, entry);
                return entry;
        }

        public put(key: string, payload: PutPayload) {
                const now = Date.now();
                const existing = this.map.get(key);
                const entry: SearchCacheEntry = {
                        key,
                        options: payload.options,
                        results: payload.results,
                        metadata: payload.metadata,
                        createdAt: now,
                        expiresAt: now + TTL_MS,
                        stale: false,
                        viewState: existing?.viewState
                };
                this.touch(key, entry);
        }

        public updateViewState(key: string, viewState: SearchCacheViewState | undefined) {
                const entry = this.map.get(key);
                if(!entry) return;
                entry.viewState = {...entry.viewState, ...viewState};
                this.touch(key, entry);
        }

        public getViewState(key: string): SearchCacheViewState | undefined {
                return this.map.get(key)?.viewState;
        }

        public markPossiblyStale(predicate: (entry: SearchCacheEntry) => boolean) {
                let changed = false;
                for(const entry of this.map.values()) {
                        if(predicate(entry)) {
                                entry.stale = true;
                                changed = true;
                        }
                }
                if(changed) {
                        //Re-apply insertion order by re-setting items.
                        const entries = Array.from(this.map.entries());
                        this.map.clear();
                        for(const [key, entry] of entries) {
                                this.map.set(key, entry);
                        }
                }
        }

        public markAllStale() {
                this.markPossiblyStale(() => true);
        }

        public clear() {
                this.map.clear();
        }

        private touch(key: string, entry: SearchCacheEntry) {
                if(this.map.has(key)) {
                        this.map.delete(key);
                }
                this.map.set(key, entry);
                while(this.map.size > MAX_ENTRIES) {
                        const firstKey = this.map.keys().next().value;
                        if(firstKey === undefined) break;
                        this.map.delete(firstKey);
                }
        }
}

export const searchCache = new SearchCache();

function deriveGuidsFromItems(items: ConversationItem[]): Set<string> {
        const guids = new Set<string>();
        for(const item of items) {
                if(item.chatGuid) {
                        guids.add(item.chatGuid);
                }
        }
        return guids;
}

ConnectionManager.messageUpdateEmitter.subscribe((items: ConversationItem[]) => {
        if(items.length === 0) return;
        const affectedGuids = deriveGuidsFromItems(items);
        if(affectedGuids.size === 0) {
                searchCache.markAllStale();
                return;
        }
        searchCache.markPossiblyStale((entry) => {
                const scopedGuids = entry.options.chatGuids;
                if(!scopedGuids || scopedGuids.length === 0) return true;
                return scopedGuids.some((guid) => affectedGuids.has(guid));
        });
});

ConnectionManager.modifierUpdateEmitter.subscribe((_: MessageModifier[]) => {
        searchCache.markAllStale();
});
