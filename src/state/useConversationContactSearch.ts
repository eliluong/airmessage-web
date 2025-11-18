import {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import * as ConnectionManager from "shared/connection/connectionManager";
import {Conversation} from "shared/data/blocks";
import {PeopleContext, PeopleState} from "shared/state/peopleState";
import {getMemberTitleSync} from "shared/util/conversationUtils";
import {isPhoneLikeQuery, normalizeDigitsOnly} from "shared/util/phone";
import type {PersonData} from "shared/interface/people/peopleUtils";

export interface ConversationSearchProgress {
        scanned: number;
        total?: number;
}

export interface ConversationContactSearchState {
        results: Conversation[];
        loading: boolean;
        progress?: ConversationSearchProgress;
        search: (query: string) => void;
        clear: () => void;
}

interface NormalizedQuery {
        raw: string;
        trimmed: string;
        lower: string;
        digitSequence: string;
        isPhoneLike: boolean;
}

type NameLookupMap = Map<string, string[]>;

const DEFAULT_QUERY: NormalizedQuery = normalizeQuery("");
const REMOTE_SCAN_PAGE_SIZE = 1000;

export default function useConversationContactSearch(
        conversations: Conversation[] | undefined
): ConversationContactSearchState {
        const peopleState = useContext(PeopleContext);
        const safeConversations = conversations ?? [];
        const [query, setQuery] = useState<NormalizedQuery>(DEFAULT_QUERY);
        const [localMatches, setLocalMatches] = useState<Conversation[]>(safeConversations);
        const [remoteMatches, setRemoteMatches] = useState<Conversation[]>([]);
        const [loading, setLoading] = useState(false);
        const [progress, setProgress] = useState<ConversationSearchProgress | undefined>(undefined);
        const nameLookup = useMemo(() => buildNameLookup(peopleState.allPeople), [peopleState.allPeople]);
        const scanTokenRef = useRef(0);
        const controllerRef = useRef<AbortController | undefined>(undefined);

        const recomputeLocalMatches = useCallback((nextQuery: NormalizedQuery) => {
                const nameMatches = buildMatchingAddressSet(nameLookup, nextQuery.lower);
                const filtered = filterConversations(safeConversations, nextQuery, nameMatches, peopleState);
                setLocalMatches(filtered);
        }, [nameLookup, peopleState, safeConversations]);

        useEffect(() => {
                recomputeLocalMatches(query);
        }, [query, recomputeLocalMatches]);

        const cancelRemoteScan = useCallback(() => {
                if(controllerRef.current) {
                        controllerRef.current.abort();
                        controllerRef.current = undefined;
                }
                scanTokenRef.current += 1;
                setLoading(false);
        }, []);

        const runRemoteScan = useCallback((descriptor: NormalizedQuery, token: number) => {
                const controller = new AbortController();
                controllerRef.current = controller;
                const nameMatches = buildMatchingAddressSet(nameLookup, descriptor.lower);

                const performScan = async () => {
                        try {
                                const totals = await ConnectionManager.fetchConversationScanTotals(controller.signal);
                                if(controller.signal.aborted || scanTokenRef.current !== token) return;
                                setProgress({scanned: 0, total: totals.total});

                                const total = totals.total ?? totals.count;
                                let offset = 0;
                                let scanned = 0;
                                while(controller.signal.aborted === false && scanTokenRef.current === token) {
                                        if(total !== undefined && offset >= total) break;
                                        const page = await ConnectionManager.fetchConversationScanPage({
                                                offset,
                                                limit: REMOTE_SCAN_PAGE_SIZE,
                                                signal: controller.signal
                                        });
                                        if(controller.signal.aborted || scanTokenRef.current !== token) return;

                                        const matches = page.conversations.filter((conversation) =>
                                                matchesConversation(conversation, descriptor, nameMatches, peopleState)
                                        );
                                        if(matches.length > 0) {
                                                setRemoteMatches((current) => mergeConversationLists(current, matches));
                                        }

                                        const pageCount = page.metadata.count ?? page.conversations.length;
                                        if(pageCount <= 0) break;
                                        scanned = Math.min(scanned + pageCount, total ?? scanned + pageCount);
                                        offset = (page.metadata.offset ?? offset) + pageCount;
                                        setProgress({scanned, total});
                                }
                        } catch(error) {
                                if(!controller.signal.aborted && scanTokenRef.current === token) {
                                        console.warn("Failed to scan remote conversations", error);
                                }
                        } finally {
                                if(controllerRef.current === controller) {
                                        controllerRef.current = undefined;
                                }
                                if(scanTokenRef.current === token) {
                                        setLoading(false);
                                }
                        }
                };

                void performScan();
        }, [nameLookup, peopleState]);

        const search = useCallback((rawQuery: string) => {
                const descriptor = normalizeQuery(rawQuery);
                setQuery(descriptor);
                setRemoteMatches([]);
                setProgress(undefined);
                cancelRemoteScan();

                if(descriptor.trimmed.length === 0) {
                        return;
                }

                if(!ConnectionManager.getBlueBubblesAuth()) {
                        return;
                }

                const token = ++scanTokenRef.current;
                setLoading(true);
                runRemoteScan(descriptor, token);
        }, [cancelRemoteScan, runRemoteScan]);

        const clear = useCallback(() => {
                cancelRemoteScan();
                setRemoteMatches([]);
                setProgress(undefined);
                setQuery(DEFAULT_QUERY);
        }, [cancelRemoteScan]);

        const results = useMemo(() => {
                return mergeConversationLists(localMatches, remoteMatches);
        }, [localMatches, remoteMatches]);

        useEffect(() => () => {
                cancelRemoteScan();
        }, [cancelRemoteScan]);

        return {
                results,
                loading,
                progress,
                search,
                clear
        };
}

function normalizeQuery(value: string): NormalizedQuery {
        const trimmed = value.trim();
        const lower = trimmed.toLowerCase();
        const digitSequence = normalizeDigitsOnly(trimmed);
        return {
                raw: value,
                trimmed,
                lower,
                digitSequence,
                isPhoneLike: isPhoneLikeQuery(trimmed)
        };
}

function buildNameLookup(people: PersonData[] | undefined): NameLookupMap {
        const map: NameLookupMap = new Map();
        if(!people) return map;
        for(const person of people) {
                const normalizedName = person.name?.trim().toLowerCase();
                if(!normalizedName) continue;
                const addresses = person.addresses.map((address) => address.value).filter(Boolean);
                if(addresses.length === 0) continue;
                const existing = map.get(normalizedName);
                if(existing) existing.push(...addresses);
                else map.set(normalizedName, [...addresses]);
        }
        return map;
}

function buildMatchingAddressSet(
        nameLookup: NameLookupMap,
        lowerQuery: string
): ReadonlySet<string> | undefined {
        if(lowerQuery.length === 0) return undefined;
        const matches = new Set<string>();
        for(const [name, addresses] of nameLookup.entries()) {
                if(!name.includes(lowerQuery)) continue;
                for(const address of addresses) {
                        matches.add(address.toLowerCase());
                }
        }
        return matches.size > 0 ? matches : undefined;
}

function filterConversations(
        source: Conversation[],
        descriptor: NormalizedQuery,
        nameMatches: ReadonlySet<string> | undefined,
        peopleState: PeopleState
): Conversation[] {
        if(descriptor.trimmed.length === 0) return source;
        return source.filter((conversation) =>
                matchesConversation(conversation, descriptor, nameMatches, peopleState)
        );
}

function matchesConversation(
        conversation: Conversation,
        descriptor: NormalizedQuery,
        nameMatches: ReadonlySet<string> | undefined,
        peopleState: PeopleState
): boolean {
        if(descriptor.trimmed.length === 0) return true;
        const lowerQuery = descriptor.lower;
        const title = conversation.name && conversation.name.length > 0
                ? conversation.name
                : getMemberTitleSync(conversation.members, peopleState);
        if(title?.toLowerCase().includes(lowerQuery)) {
                return true;
        }

        const checkDigits = descriptor.isPhoneLike && descriptor.digitSequence.length > 0;
        for(const member of conversation.members) {
                const lowerMember = member.toLowerCase();
                if(lowerMember.includes(lowerQuery)) {
                        return true;
                }
                if(checkDigits) {
                        const memberDigits = normalizeDigitsOnly(member);
                        if(memberDigits.includes(descriptor.digitSequence)) {
                                return true;
                        }
                }
                if(nameMatches?.has(lowerMember)) {
                        return true;
                }
                const person = peopleState.getPerson(member);
                if(person?.name?.toLowerCase().includes(lowerQuery)) {
                        return true;
                }
        }

        return false;
}

function mergeConversationLists(...lists: Conversation[][]): Conversation[] {
        const map = new Map<string | number, Conversation>();
        const result: Conversation[] = [];
        const addConversation = (conversation: Conversation) => {
                const key = conversation.localOnly ? conversation.localID : conversation.guid ?? conversation.localID;
                if(map.has(key)) return;
                map.set(key, conversation);
                result.push(conversation);
        };
        for(const list of lists) {
                for(const conversation of list) addConversation(conversation);
        }
        return result;
}
