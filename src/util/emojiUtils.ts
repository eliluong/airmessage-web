import emojiRegex from "emoji-regex";

export interface EmojiAnalysis {
	emojiCount: number;
	isEmojiOnly: boolean;
}

const emojiPattern = emojiRegex();

/**
 * Analyze a text message for emoji-only content and emoji count.
 *
 * A message is considered emoji-only if removing all emoji clusters,
 * whitespace, variation selectors, and zero-width joiners leaves
 * no remaining characters.
 */
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
