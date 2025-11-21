import {analyseEmojiText} from "../../src/util/emojiUtils";

describe("analyseEmojiText", () => {
	test("detects single emoji as emoji-only", () => {
		expect(analyseEmojiText("😀")).toEqual({emojiCount: 1, isEmojiOnly: true});
	});
	
	test("treats whitespace as ignorable for emoji-only detection", () => {
		expect(analyseEmojiText("   😀   ")).toEqual({emojiCount: 1, isEmojiOnly: true});
		expect(analyseEmojiText("😀 😀 😀")).toEqual({emojiCount: 3, isEmojiOnly: true});
	});
	
	test("handles complex emoji sequences as single emoji", () => {
		expect(analyseEmojiText("🇺🇸")).toEqual({emojiCount: 1, isEmojiOnly: true});
		expect(analyseEmojiText("👨‍👩‍👧‍👦")).toEqual({emojiCount: 1, isEmojiOnly: true});
		expect(analyseEmojiText("👍🏽")).toEqual({emojiCount: 1, isEmojiOnly: true});
	});
	
	test("detects mixed content as not emoji-only", () => {
		expect(analyseEmojiText("😀 hi").isEmojiOnly).toBe(false);
		expect(analyseEmojiText("hi 😀").isEmojiOnly).toBe(false);
	});
	
	test("counts emoji beyond the large-emoji threshold", () => {
		expect(analyseEmojiText("😀😀😀😀")).toEqual({emojiCount: 4, isEmojiOnly: true});
	});
	
	test("empty strings are not emoji-only", () => {
		expect(analyseEmojiText("")).toEqual({emojiCount: 0, isEmojiOnly: false});
	});
});
