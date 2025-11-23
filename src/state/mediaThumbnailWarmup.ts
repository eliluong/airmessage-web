import * as ConnectionManager from "shared/connection/connectionManager";
import {ConversationAttachmentEntry} from "shared/data/attachment";
import {isImageAttachmentPreviewable} from "shared/util/conversationUtils";
import {
        hasMediaThumbnailCacheEntry,
        storeMediaThumbnailBlob
} from "shared/state/mediaThumbnailCache";

const DEFAULT_WARM_LIMIT = 10;
const MAX_CONCURRENT_WARM_DOWNLOADS = 3;

export interface WarmThumbnailsOptions {
        signal?: AbortSignal;
        limit?: number;
}

function isAbortError(error: unknown): boolean {
        return error instanceof DOMException && error.name === "AbortError";
}

export async function warmConversationMediaThumbnails(
        items: ConversationAttachmentEntry[],
        options: WarmThumbnailsOptions = {}
): Promise<void> {
        if(items.length === 0) return;
        const limit = Math.max(0, options.limit ?? DEFAULT_WARM_LIMIT);
        if(limit === 0) return;

        const toWarm: string[] = [];
        const seen = new Set<string>();
        for(const item of items) {
                const guid = item.guid;
                if(!guid) continue;
                if(!isImageAttachmentPreviewable(item.mimeType)) continue;
                if(seen.has(guid)) continue;
                if(hasMediaThumbnailCacheEntry(guid)) continue;
                seen.add(guid);
                toWarm.push(guid);
                if(toWarm.length >= limit) break;
        }

        if(toWarm.length === 0) return;
        const concurrency = Math.min(MAX_CONCURRENT_WARM_DOWNLOADS, toWarm.length);
        const queue = toWarm.slice();

        const worker = async () => {
                while(queue.length > 0) {
                        if(options.signal?.aborted) return;
                        const nextGuid = queue.shift();
                        if(!nextGuid) return;
                        try {
                                const blob = await ConnectionManager.fetchAttachmentThumbnail(nextGuid, options.signal);
                                if(options.signal?.aborted) return;
                                storeMediaThumbnailBlob(nextGuid, blob);
                        } catch(error) {
                                if(options.signal?.aborted || isAbortError(error)) {
                                        return;
                                }
                                console.warn("Failed to warm attachment thumbnail", error);
                        }
                }
        };

        await Promise.all(new Array(concurrency).fill(null).map(() => worker()));
}
