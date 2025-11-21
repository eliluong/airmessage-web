const DIGIT_SEQUENCE_REGEX = /\d+/g;
const PHONE_QUERY_ALLOWED_CHARS = /^[\d\s()+\-._#*]+$/;

/**
 * Extracts all digit characters from the input string and concatenates them
 * into a continuous sequence. Returns an empty string if no digits are found.
 */
export function normalizeDigitsOnly(value: string): string {
        if(!value) return "";
        const matches = value.match(DIGIT_SEQUENCE_REGEX);
        if(!matches) return "";
        return matches.join("");
}

/**
 * Determines whether the provided input resembles a phone-number style query.
 * Treats queries that consist solely of digits and common phone punctuation
 * and contain at least three digits as phone-like.
 */
export function isPhoneLikeQuery(value: string): boolean {
        if(!value) return false;
        const trimmed = value.trim();
        if(trimmed.length === 0) return false;
        const digitSequence = normalizeDigitsOnly(trimmed);
        if(digitSequence.length < 3) return false;
        return PHONE_QUERY_ALLOWED_CHARS.test(trimmed);
}
