import emojiRegex from "emoji-regex";

export interface EmojiAnalysis {
	emojiCount: number;
	isEmojiOnly: boolean;
}

const emojiPattern = emojiRegex();

export function analyseEmojiText(text: string | null | undefined): EmojiAnalysis {
	const value = text ?? "";
	const matches = [...value.matchAll(emojiPattern)];
	const emojiCount = matches.length;

	// Strip emoji clusters, whitespace, variation selectors, and ZWJ characters
	const stripped = value
		.replace(emojiPattern, "")
		.replace(/\s+/g, "")
		.replace(/[\uFE0E\uFE0F\u200D]/g, "");

	const isEmojiOnly = emojiCount > 0 && stripped.length === 0;

	return {emojiCount, isEmojiOnly};
}

export function insertEmojiAtSelection(
        value: string,
        selectionStart: number,
        selectionEnd: number,
        emoji: string
): {value: string; newCaretPosition: number} {
        const normalizedStart = Math.min(Math.max(selectionStart, 0), value.length);
        const normalizedEnd = Math.min(Math.max(selectionEnd, normalizedStart), value.length);

        const prefix = value.slice(0, normalizedStart);
        const suffix = value.slice(normalizedEnd);
        const nextValue = `${prefix}${emoji}${suffix}`;

        return {
                value: nextValue,
                newCaretPosition: prefix.length + emoji.length
        };
}
