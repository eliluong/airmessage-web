import {useCallback, useEffect, useMemo, useState} from "react";
import {find} from "linkifyjs";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {ConversationLinkScanCursor} from "shared/connection/communicationsManager";
import {ConversationItem, MessageItem} from "shared/data/blocks";
import {ConversationItemType} from "shared/data/stateCodes";

export interface ConversationLinkEntry {
	readonly normalizedUrl: string;
	readonly originalUrl: string;
	readonly domain: string;
	readonly messageGuid?: string;
	readonly messageLocalID?: number;
	readonly messageServerID?: number;
	readonly sender?: string;
	readonly date: Date;
}

interface UseConversationLinksOptions {
	targetInitialCount?: number;
	backfillPageSize?: number;
	maxBackfillPages?: number;
	enabled?: boolean;
}

interface LinkCacheEntry {
	signature: string;
	localLinkKeys: Set<string>;
	links: ConversationLinkEntry[];
	cursor?: ConversationLinkScanCursor;
	completed: boolean;
	error?: string;
}

const linkCache = new Map<string, LinkCacheEntry>();

const DEFAULT_TARGET_INITIAL_COUNT = 20;
const DEFAULT_BACKFILL_PAGE_SIZE = 10;
const DEFAULT_MAX_BACKFILL_PAGES = 8;

function normalizeUrl(raw: string): string | undefined {
	try {
	    const prefixed = raw.startsWith("http") ? raw : `https://${raw}`;
	    const parsed = new URL(prefixed);
	    if(parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
	    parsed.hash = "";
	    return parsed.toString();
	} catch(error) {
	    console.warn("Failed to normalize conversation link", error);
	    return undefined;
	}
}

export function extractLinksFromMessages(messages: MessageItem[]): ConversationLinkEntry[] {
	const linksByUrl = new Map<string, ConversationLinkEntry>();

	for(const message of messages) {
		if(!message.text) continue;
		const matches = find(message.text, "url");
		for(const match of matches) {
			if(typeof match.href !== "string") continue;
			const normalized = normalizeUrl(match.href);
			if(!normalized || linksByUrl.has(normalized)) continue;
			let domain: string;
			try {
				domain = new URL(normalized).hostname;
			} catch {
				domain = normalized;
			}
			linksByUrl.set(normalized, {
				normalizedUrl: normalized,
				originalUrl: match.href,
				domain,
				messageGuid: message.guid,
				messageLocalID: message.localID,
				messageServerID: message.serverID,
				sender: message.sender,
				date: message.date
			});
		}
	}

	return Array.from(linksByUrl.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
}

function computeSignature(messages: MessageItem[]): string {
	return messages
		.map((message) => `${message.guid ?? message.localID ?? message.serverID ?? "unknown"}:${message.date.getTime()}:${message.text?.length ?? 0}`)
		.join("|");
}

function buildLinkKey(entry: ConversationLinkEntry): string {
	const identifier =
		entry.messageGuid ??
		(entry.messageServerID !== undefined ? `server:${entry.messageServerID}` : undefined) ??
		(entry.messageLocalID !== undefined ? `local:${entry.messageLocalID}` : undefined) ??
		entry.originalUrl;
	return `${entry.normalizedUrl}|${identifier}`;
}

function areSetsEqual(first: Set<string>, second: Set<string>): boolean {
	if(first.size !== second.size) return false;
	for(const value of first) {
		if(!second.has(value)) return false;
	}
	return true;
}

function mergeLinkCollections(
	existing: ConversationLinkEntry[],
	incoming: ConversationLinkEntry[]
): {links: ConversationLinkEntry[]; added: number} {
	if(incoming.length === 0) {
		return {links: existing, added: 0};
	}

	const map = new Map<string, ConversationLinkEntry>();
	for(const entry of existing) {
		map.set(buildLinkKey(entry), entry);
	}

	let added = 0;
	for(const entry of incoming) {
		const key = buildLinkKey(entry);
		if(!map.has(key)) {
			map.set(key, entry);
			added += 1;
		} else {
			const current = map.get(key)!;
			if(entry.date.getTime() > current.date.getTime()) {
				map.set(key, entry);
			}
		}
	}

	const merged = Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
	return {links: merged, added};
}

function cloneEntry(entry: LinkCacheEntry): LinkCacheEntry {
	return {
		signature: entry.signature,
		localLinkKeys: new Set(entry.localLinkKeys),
		links: entry.links.slice(),
		cursor: entry.cursor ? {...entry.cursor} : undefined,
		completed: entry.completed,
		error: entry.error
	};
}

function createEmptyEntry(): LinkCacheEntry {
	return {
		signature: "",
		localLinkKeys: new Set(),
		links: [],
		cursor: undefined,
		completed: false,
		error: undefined
	};
}

export interface ConversationLinksState {
	links: ConversationLinkEntry[];
	totalCount: number;
	hasMore: boolean;
	isPaginating: boolean;
	isScanning: boolean;
	scanError?: string;
	loadMore: () => Promise<void>;
}

export default function useConversationLinks(
	conversationGuid: string | undefined,
	conversationKey: string | undefined,
	items: ConversationItem[],
	options: UseConversationLinksOptions = {}
): ConversationLinksState {
	const {
		targetInitialCount = DEFAULT_TARGET_INITIAL_COUNT,
		backfillPageSize = DEFAULT_BACKFILL_PAGE_SIZE,
		maxBackfillPages = DEFAULT_MAX_BACKFILL_PAGES,
		enabled = true
	} = options;

	const messageItems = useMemo(
		() => items.filter((item): item is MessageItem => item.itemType === ConversationItemType.Message),
		[items]
	);
	const signature = useMemo(() => computeSignature(messageItems), [messageItems]);
	const localLinks = useMemo(() => extractLinksFromMessages(messageItems), [messageItems]);
	const localLinkKeys = useMemo(() => new Set(localLinks.map((entry) => buildLinkKey(entry))), [localLinks]);

	const [links, setLinks] = useState<ConversationLinkEntry[]>(() => {
		if(conversationKey) {
			return linkCache.get(conversationKey)?.links ?? localLinks;
		}
		return localLinks;
	});
	const [hasMore, setHasMore] = useState<boolean>(() => {
		if(!conversationKey || !conversationGuid) return false;
		const entry = linkCache.get(conversationKey);
		return entry ? !entry.completed : false;
	});
	const [scanError, setScanError] = useState<string | undefined>(() =>
		conversationKey ? linkCache.get(conversationKey)?.error : undefined
	);
	const [isPaginating, setIsPaginating] = useState(false);
	const [isScanning, setIsScanning] = useState(false);

	const syncEntryState = useCallback(
		(entry: LinkCacheEntry | undefined) => {
			if(entry) {
				setLinks(entry.links);
				setScanError(entry.error);
				setHasMore(Boolean(conversationGuid && !entry.completed));
			} else {
				setLinks(localLinks);
				setScanError(undefined);
				setHasMore(false);
			}
		},
		[conversationGuid, localLinks]
	);

	const updateCachedEntry = useCallback(
		(updater: (entry: LinkCacheEntry) => LinkCacheEntry) => {
			if(!conversationKey) return undefined;
			const existing = linkCache.get(conversationKey) ?? createEmptyEntry();
			const updated = updater(cloneEntry(existing));
			const stored = cloneEntry(updated);
			linkCache.set(conversationKey, stored);
			syncEntryState(stored);
			return stored;
		},
		[conversationKey, syncEntryState]
	);

	useEffect(() => {
		if(!conversationKey) {
			syncEntryState(undefined);
			return;
		}
		const entry = linkCache.get(conversationKey);
		syncEntryState(entry);
	}, [conversationKey, syncEntryState]);

	useEffect(() => {
		if(!conversationKey) return;
		updateCachedEntry((entry) => {
			const needsUpdate =
				entry.signature !== signature ||
				!areSetsEqual(entry.localLinkKeys, localLinkKeys);
			if(!needsUpdate) return entry;
			const remaining = entry.links.filter((link) => !entry.localLinkKeys.has(buildLinkKey(link)));
			const {links: merged} = mergeLinkCollections(remaining, localLinks);
			return {
				...entry,
				signature,
				localLinkKeys: new Set(localLinkKeys),
				links: merged
			};
		});
	}, [conversationKey, localLinkKeys, localLinks, signature, updateCachedEntry]);

	const runSweep = useCallback(
		async (mode: "scan" | "paginate", minimumNewLinks: number) => {
			if(!enabled) return;
			if(!conversationGuid || !conversationKey) return;
			const entry = linkCache.get(conversationKey);
			if(entry?.completed) return;
			if(mode === "scan" && isScanning) return;
			if(mode === "paginate" && isPaginating) return;

			const setLoading = mode === "scan" ? setIsScanning : setIsPaginating;
			setLoading(true);
			try {
				let accumulated = 0;
				const required = Math.max(1, minimumNewLinks);
				updateCachedEntry((current) => ({...current, error: undefined}));
				while(true) {
					const currentEntry = linkCache.get(conversationKey) ?? createEmptyEntry();
					if(currentEntry.completed) break;
					if(
						maxBackfillPages !== undefined &&
						currentEntry.cursor &&
						currentEntry.cursor.pagesFetched >= maxBackfillPages
					) {
						updateCachedEntry((current) => ({...current, completed: true}));
						break;
					}
					const result = await ConnectionManager.fetchConversationLinkMessages(
						conversationGuid,
						currentEntry.cursor
					);
					const batchLinks = extractLinksFromMessages(result.messages);
					let added = 0;
					updateCachedEntry((current) => {
						const {links: merged, added: linkAdded} = mergeLinkCollections(current.links, batchLinks);
						added = linkAdded;
						const cursor = result.cursor ? {...result.cursor} : undefined;
						const limitReached =
							maxBackfillPages !== undefined &&
							cursor !== undefined &&
							cursor.pagesFetched >= maxBackfillPages;
						return {
							...current,
							links: merged,
							cursor,
							completed: result.exhausted || limitReached,
							error: undefined
						};
					});
					accumulated += added;
					if(result.exhausted) break;
					const latestCursor = linkCache.get(conversationKey)?.cursor;
					if(
						maxBackfillPages !== undefined &&
						latestCursor &&
						latestCursor.pagesFetched >= maxBackfillPages
					) {
						break;
					}
					if(accumulated >= required) break;
				}
			} catch(error) {
				const message = error instanceof Error ? error.message : "Failed to scan older messages.";
				updateCachedEntry((current) => ({...current, error: message}));
				throw error;
			} finally {
				setLoading(false);
			}
		},
		[
			conversationGuid,
			conversationKey,
			enabled,
			isPaginating,
			isScanning,
			maxBackfillPages,
			updateCachedEntry
		]
	);

	useEffect(() => {
		if(!enabled) return;
		if(!conversationGuid || !conversationKey) return;
		if(isScanning || isPaginating) return;
		if(scanError) return;
		const deficit = targetInitialCount - links.length;
		if(deficit <= 0) return;
		const entry = linkCache.get(conversationKey);
		if(entry?.completed) return;
		void runSweep("scan", deficit).catch(() => undefined);
	}, [
		conversationGuid,
		conversationKey,
		enabled,
		isPaginating,
		isScanning,
		links.length,
		runSweep,
		scanError,
		targetInitialCount
	]);

	const loadMore = useCallback(async () => {
		if(!enabled) return;
		if(!conversationGuid || !conversationKey) return;
		const entry = linkCache.get(conversationKey);
		if(entry?.completed) return;
		try {
			await runSweep("paginate", backfillPageSize);
		} catch {
			// error state handled inside runSweep
		}
	}, [backfillPageSize, conversationGuid, conversationKey, enabled, runSweep]);

	return {
		links,
		totalCount: links.length,
		hasMore,
		isPaginating,
		isScanning,
		scanError,
		loadMore
	};
}
