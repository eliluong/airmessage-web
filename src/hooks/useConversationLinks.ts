import {useCallback, useEffect, useMemo, useState} from "react";
import {find} from "linkifyjs";
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
        initialCount?: number;
        pageSize?: number;
        enabled?: boolean;
}

interface LinkCacheEntry {
        signature: string;
        links: ConversationLinkEntry[];
}

const linkCache = new Map<string, LinkCacheEntry>();

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

function extractLinksFromMessages(messages: MessageItem[]): ConversationLinkEntry[] {
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

export interface ConversationLinksState {
        links: ConversationLinkEntry[];
        totalCount: number;
        hasMore: boolean;
        isPaginating: boolean;
        loadMore: () => void;
}

export default function useConversationLinks(
        conversationKey: string | undefined,
        items: ConversationItem[],
        options: UseConversationLinksOptions = {}
): ConversationLinksState {
        const {initialCount = 20, pageSize = 10, enabled = true} = options;

        const messages = useMemo(
                () => items.filter((item): item is MessageItem => item.itemType === ConversationItemType.Message),
                [items]
        );

        const signature = useMemo(() => computeSignature(messages), [messages]);

        const allLinks = useMemo(() => {
                if(!conversationKey || !enabled) return [];
                const cached = linkCache.get(conversationKey);
                if(cached && cached.signature === signature) {
                        return cached.links;
                }
                const links = extractLinksFromMessages(messages);
                linkCache.set(conversationKey, {signature, links});
                return links;
        }, [conversationKey, enabled, messages, signature]);

        const [visibleCount, setVisibleCount] = useState<number>(initialCount);
        const [isPaginating, setIsPaginating] = useState(false);

        useEffect(() => {
                setVisibleCount(initialCount);
        }, [conversationKey, initialCount, signature]);

        const loadMore = useCallback(() => {
                setVisibleCount((count) => {
                        if(count >= allLinks.length) return count;
                        setIsPaginating(true);
                        const next = Math.min(count + pageSize, allLinks.length);
                        setIsPaginating(false);
                        return next;
                });
        }, [allLinks.length, pageSize]);

        const visibleLinks = useMemo(() => allLinks.slice(0, visibleCount), [allLinks, visibleCount]);

        return useMemo(
                () => ({
                        links: visibleLinks,
                        totalCount: allLinks.length,
                        hasMore: visibleCount < allLinks.length,
                        isPaginating,
                        loadMore
                }),
                [allLinks.length, isPaginating, loadMore, visibleCount, visibleLinks]
        );
}
