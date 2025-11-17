import {useMemo} from "react";
import {ConversationItem, MessageItem} from "shared/data/blocks";
import {ConversationItemType} from "shared/data/stateCodes";

export type EditHistoryEntry = {
        text: string;
        sourceGuid?: string;
        editedDate?: Date;
};

export type MessageEditMetadata = {
        latestText: string;
        history: EditHistoryEntry[];
};

export type MessageItemWithEdits = MessageItem & {
        uiEdited?: MessageEditMetadata;
};

type ConversationItemWithMeta = ConversationItem & {
        uiSuppress?: boolean;
};

export type EditedMessageGroupingOptions = {
        windowMs?: number;
        maxLookback?: number;
        similarityThreshold?: number;
        similarityMargin?: number;
};

const EDITED_TO_PATTERN = /^(?:Edited(?:\s+to)?)\s+[“"]([\s\S]*?)[”"]\s*$/i;
const DEFAULT_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_MAX_LOOKBACK = 100;
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;
const DEFAULT_SIMILARITY_MARGIN = 0.05;
const SELF_SENDER_KEY = "__self__";
const EMPTY_ITEMS: ConversationItem[] = [];

function normalizeEditedText(text?: string): string | undefined {
        if(!text) return undefined;
        const match = text.match(EDITED_TO_PATTERN);
        if(!match) return undefined;
        const extracted = match[1] ?? "";
        return extracted.trim();
}

function tokenize(text: string): string[] {
        return text
                .toLowerCase()
                .split(/[^a-z0-9]+/i)
                .filter((token) => token.length > 0);
}

function computeSimilarity(left: string, right: string): number {
        if(!left || !right) return 0;
        const leftTokens = new Set(tokenize(left));
        const rightTokens = new Set(tokenize(right));
        let intersection = 0;
        for(const token of leftTokens) {
                if(rightTokens.has(token)) {
                        intersection += 1;
                }
        }
        const union = leftTokens.size + rightTokens.size - intersection;
        const jaccard = union === 0 ? 0 : intersection / union;
        const leftLength = left.length;
        const rightLength = right.length;
        const lengthSimilarity = 1 - Math.min(1, Math.abs(leftLength - rightLength) / Math.max(1, leftLength, rightLength));
        return 0.7 * jaccard + 0.3 * lengthSimilarity;
}

function getSenderKey(message: MessageItem): string {
        return message.sender ?? SELF_SENDER_KEY;
}

function ensureClonedItem(
        items: ConversationItemWithMeta[],
        index: number,
        cloned: Set<number>
): ConversationItemWithMeta {
        if(cloned.has(index)) return items[index];
        items[index] = {...items[index]};
        cloned.add(index);
        return items[index];
}

function shouldSkipCandidate(candidate: MessageItem): boolean {
        if(candidate.text === undefined) return true;
        if(candidate.text.trim().length === 0) return true;
        if(normalizeEditedText(candidate.text)) return true;
        return false;
}

export function deriveEditedMessageGroups(
        items: ConversationItem[],
        options?: EditedMessageGroupingOptions
): ConversationItem[] {
        if(!items || items.length === 0) return items ?? EMPTY_ITEMS;

        const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
        const maxLookback = options?.maxLookback ?? DEFAULT_MAX_LOOKBACK;
        const similarityThreshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
        const similarityMargin = options?.similarityMargin ?? DEFAULT_SIMILARITY_MARGIN;

        const editEvents: {index: number; newText: string}[] = [];
        for(let i = 0; i < items.length; i += 1) {
                const item = items[i];
                if(item.itemType !== ConversationItemType.Message) continue;
                const message = item as MessageItem;
                const newText = normalizeEditedText(message.text);
                if(newText) {
                        editEvents.push({index: i, newText});
                }
        }

        if(editEvents.length === 0) {
                        return items;
        }

        const workingItems = items.slice() as ConversationItemWithMeta[];
        const cloned = new Set<number>();
        const suppressed = new Set<number>();
        let changed = false;

        for(let eventIndex = editEvents.length - 1; eventIndex >= 0; eventIndex -= 1) {
                const {index: editedIndex, newText} = editEvents[eventIndex];
                const editedItem = workingItems[editedIndex];
                if(!editedItem || editedItem.itemType !== ConversationItemType.Message) continue;
                const editedMessage = editedItem as MessageItem & ConversationItemWithMeta;
                const senderKey = getSenderKey(editedMessage);
                const editedTime = editedMessage.date.getTime();

                let bestIndex = -1;
                let bestScore = 0;
                let secondBest = 0;
                let inspected = 0;

                for(let candidateIndex = editedIndex + 1;
                        candidateIndex < workingItems.length && inspected < maxLookback;
                        candidateIndex += 1) {
                        const candidateItem = workingItems[candidateIndex];
                        if(candidateItem.itemType !== ConversationItemType.Message) continue;
                        inspected += 1;
                        const candidateMessage = candidateItem as MessageItem;
                        if(getSenderKey(candidateMessage) !== senderKey) continue;
                        if(editedTime - candidateMessage.date.getTime() > windowMs) break;
                        if(shouldSkipCandidate(candidateMessage)) continue;

                        const similarity = computeSimilarity(newText, candidateMessage.text ?? "");
                        if(similarity > bestScore) {
                                secondBest = bestScore;
                                bestScore = similarity;
                                bestIndex = candidateIndex;
                        } else if(similarity > secondBest) {
                                secondBest = similarity;
                        }
                }

                const confident = bestIndex !== -1
                        && bestScore >= similarityThreshold
                        && (bestScore - secondBest) >= similarityMargin;
                if(!confident) continue;

                const originalItem = ensureClonedItem(workingItems, bestIndex, cloned) as MessageItemWithEdits & ConversationItemWithMeta;
                const stubItem = ensureClonedItem(workingItems, editedIndex, cloned);
                const previousText = (originalItem.uiEdited?.latestText ?? originalItem.text ?? "").trimEnd();
                const history = originalItem.uiEdited ? [...originalItem.uiEdited.history] : [];
                if(previousText.length > 0) {
                        history.push({
                                text: previousText,
                                sourceGuid: editedMessage.guid,
                                editedDate: editedMessage.date
                        });
                }

                originalItem.uiEdited = {
                        latestText: newText,
                        history
                };

                stubItem.uiSuppress = true;
                suppressed.add(editedIndex);
                changed = true;
        }

        if(!changed) {
                return items;
        }

        const filtered: ConversationItem[] = [];
        for(let i = 0; i < workingItems.length; i += 1) {
                if(suppressed.has(i)) continue;
                filtered.push(workingItems[i]);
        }
        return filtered;
}

export function useEditedMessageGroups(
        items: ConversationItem[] | undefined,
        options?: EditedMessageGroupingOptions
): ConversationItem[] {
        const sourceItems = items ?? EMPTY_ITEMS;
        const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
        const maxLookback = options?.maxLookback ?? DEFAULT_MAX_LOOKBACK;
        const similarityThreshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
        const similarityMargin = options?.similarityMargin ?? DEFAULT_SIMILARITY_MARGIN;

        return useMemo(
                () => deriveEditedMessageGroups(sourceItems, {
                        windowMs,
                        maxLookback,
                        similarityThreshold,
                        similarityMargin
                }),
                [sourceItems, windowMs, maxLookback, similarityThreshold, similarityMargin]
        );
}

export function __TESTING_ONLY__extractEditedText(text?: string): string | undefined {
        return normalizeEditedText(text);
}
