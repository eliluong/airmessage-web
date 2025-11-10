import Papa from "papaparse";

import {AddressType, PersonData} from "./peopleUtils";
import {isValidEmailAddress, isValidPhoneNumber, normalizeAddress} from "shared/util/addressHelper";

type CsvRow = Record<string, unknown>;

const GOOGLE_SOURCE_ID = "google";
const BAIKAL_SOURCE_ID = "baikal";

export function parseGoogleAddressBook(csv: string): PersonData[] {
        const rows = parseCsv(csv);

        return rows
                .map((row) => buildGooglePerson(row))
                .filter((person): person is PersonData => person !== null);
}

export function parseBaikalAddressBook(csv: string): PersonData[] {
        const rows = parseCsv(csv);

        return rows
                .map((row) => buildBaikalPerson(row))
                .filter((person): person is PersonData => person !== null);
}

function parseCsv(csv: string): CsvRow[] {
        const result = Papa.parse<CsvRow>(csv, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (header: string) => header.trim(),
        });

        if(!Array.isArray(result.data)) {
                return [];
        }

        return result.data.filter((row): row is CsvRow => row != null && typeof row === "object");
}

function buildGooglePerson(row: CsvRow): PersonData | null {
        const name = firstNonEmpty([
                getCaseInsensitiveValue(row, "Name"),
                getCaseInsensitiveValue(row, "Full Name"),
                getCaseInsensitiveValue(row, "Display Name"),
                combineNameParts(row, ["First Name", "Middle Name", "Last Name"]),
                combineNameParts(row, ["First Name", "Last Name"]),
                combineNameParts(row, ["Given Name", "Additional Name", "Family Name"]),
        ]);
        const addresses = extractGoogleAddresses(row);

        return createPerson(GOOGLE_SOURCE_ID, name, addresses);
}

function combineNameParts(row: CsvRow, keys: string[]): string | undefined {
        const parts = keys
                .map((key) => getCaseInsensitiveValue(row, key)?.trim())
                .filter((part): part is string => Boolean(part && part.length > 0));

        if(parts.length === 0) {
                return undefined;
        }

        return parts.join(" ");
}

function extractGoogleAddresses(row: CsvRow): PersonData["addresses"] {
        const addresses: PersonData["addresses"] = [];

        for(const [rawKey, rawValue] of Object.entries(row)) {
                if(typeof rawValue !== "string") {
                        continue;
                }

                const value = rawValue.trim();
                if(!value) {
                        continue;
                }

                const key = rawKey.trim();

                const emailMatch = key.match(/^(E-?mail|Email) (\d+) - Value$/i);
                if(emailMatch) {
                        const index = emailMatch[2];
                        const label = firstNonEmpty([
                                getCaseInsensitiveValue(row, `E-mail ${index} - Label`),
                                getCaseInsensitiveValue(row, `Email ${index} - Label`),
                                getCaseInsensitiveValue(row, `E-mail ${index} - Type`),
                                getCaseInsensitiveValue(row, `Email ${index} - Type`),
                        ]);
                        addAddress(addresses, value, AddressType.Email, label);
                        continue;
                }

                const phoneMatch = key.match(/^Phone (\d+) - Value$/i);
                if(phoneMatch) {
                        const index = phoneMatch[1];
                        const label = firstNonEmpty([
                                getCaseInsensitiveValue(row, `Phone ${index} - Label`),
                                getCaseInsensitiveValue(row, `Phone ${index} - Type`),
                        ]);
                        addAddress(addresses, value, AddressType.Phone, label);
                        continue;
                }

                if(/^Primary Email(?: - Value)?$/i.test(key)) {
                        const label = firstNonEmpty([
                                getCaseInsensitiveValue(row, "Primary Email - Label"),
                                getCaseInsensitiveValue(row, "Primary Email - Type"),
                                "Primary",
                        ]);
                        addAddress(addresses, value, AddressType.Email, label);
                        continue;
                }

                if(/^Secondary Email(?: - Value)?$/i.test(key)) {
                        const label = firstNonEmpty([
                                getCaseInsensitiveValue(row, "Secondary Email - Label"),
                                getCaseInsensitiveValue(row, "Secondary Email - Type"),
                                "Secondary",
                        ]);
                        addAddress(addresses, value, AddressType.Email, label);
                        continue;
                }
        }

        return addresses;
}

function buildBaikalPerson(row: CsvRow): PersonData | null {
        const name = firstNonEmpty([
                getCaseInsensitiveValue(row, "Display Name"),
                getCaseInsensitiveValue(row, "Full Name"),
                combineNameParts(row, ["First Name", "Middle Name", "Last Name"]),
                combineNameParts(row, ["First Name", "Last Name"]),
                getCaseInsensitiveValue(row, "FN"),
        ]);
        const addresses = extractBaikalAddresses(row);

        return createPerson(BAIKAL_SOURCE_ID, name, addresses);
}

const BAIKAL_STANDARD_FIELD_MAPPINGS: Record<string, {type: AddressType; label?: string}> = {
        "primary email": {type: AddressType.Email, label: "Primary"},
        "secondary email": {type: AddressType.Email, label: "Secondary"},
        "other email": {type: AddressType.Email, label: "Other"},
        "mobile number": {type: AddressType.Phone, label: "Mobile"},
        "mobile phone": {type: AddressType.Phone, label: "Mobile"},
        "home phone": {type: AddressType.Phone, label: "Home"},
        "home phone 2": {type: AddressType.Phone, label: "Home"},
        "work phone": {type: AddressType.Phone, label: "Work"},
        "work phone 2": {type: AddressType.Phone, label: "Work"},
        "fax number": {type: AddressType.Phone, label: "Fax"},
        "home fax": {type: AddressType.Phone, label: "Fax"},
        "work fax": {type: AddressType.Phone, label: "Fax"},
        "pager number": {type: AddressType.Phone, label: "Pager"},
};

function extractBaikalAddresses(row: CsvRow): PersonData["addresses"] {
        const addresses: PersonData["addresses"] = [];

        for(const [rawKey, rawValue] of Object.entries(row)) {
                if(typeof rawValue !== "string") {
                        continue;
                }

                const value = rawValue.trim();
                if(!value) {
                        continue;
                }

                const key = rawKey.trim();
                const {baseKey, label: baikalLabel} = parseBaikalKey(key);

                if(baseKey === "EMAIL") {
                        addAddress(addresses, value, AddressType.Email, baikalLabel);
                        continue;
                }

                if(baseKey === "TEL" || baseKey === "PHONE") {
                        addAddress(addresses, value, AddressType.Phone, baikalLabel);
                        continue;
                }

                const standard = parseBaikalStandardField(key);
                if(standard) {
                        addAddress(addresses, value, standard.type, standard.label);
                }
        }

        return addresses;
}

function parseBaikalStandardField(key: string): {type: AddressType; label?: string} | null {
        const normalized = key.trim().toLowerCase();
        const mapped = BAIKAL_STANDARD_FIELD_MAPPINGS[normalized];
        if(mapped) {
                return mapped;
        }

        if(normalized.includes("email")) {
                return {
                        type: AddressType.Email,
                        label: buildBaikalLabel(normalized, AddressType.Email),
                };
        }

        if(normalized.includes("phone") || normalized.includes("fax") || normalized.includes("mobile") || normalized.includes("pager")) {
                return {
                        type: AddressType.Phone,
                        label: buildBaikalLabel(normalized, AddressType.Phone),
                };
        }

        return null;
}

function buildBaikalLabel(normalizedKey: string, type: AddressType): string | undefined {
        const words = normalizedKey
                .split(/[^a-z0-9]+/)
                .filter((word) => {
                        if(!word || /^\d+$/.test(word)) {
                                return false;
                        }

                        if(type === AddressType.Email) {
                                return !["email", "e-mail", "address", "value"].includes(word);
                        }

                        return !["phone", "tel", "number", "value"].includes(word);
                })
                .map(capitalizeWord);

        if(words.length === 0) {
                return undefined;
        }

        return words.join(" ");
}

function parseBaikalKey(key: string): {baseKey: "EMAIL" | "TEL" | "PHONE" | ""; label?: string} {
        const sanitized = key.trim().replace(/^item\d+\./i, "");
        const segments = sanitized.split(";");

        const baseKey = segments[0]?.toUpperCase() ?? "";
        const typeSegments = segments
                .slice(1)
                .map((segment) => segment.trim())
                .filter((segment) => segment.length > 0 && segment.toUpperCase().startsWith("TYPE="))
                .map((segment) => segment.substring(segment.indexOf("=") + 1));

        const label = typeSegments.length > 0 ? typeSegments.join("/") : undefined;

        if(baseKey === "EMAIL") {
                return {baseKey: "EMAIL", label};
        }

        if(baseKey === "TEL" || baseKey === "PHONE") {
                return {baseKey: baseKey as "TEL" | "PHONE", label};
        }

        return {baseKey: "", label: undefined};
}

function addAddress(addresses: PersonData["addresses"], rawValue: string, type: AddressType, label?: string): void {
        const address = createAddress(rawValue, type, label);
        if(address) {
                addresses.push(address);
        }
}

function createPerson(sourceId: string, name: string | undefined, addresses: PersonData["addresses"]): PersonData | null {
        if(addresses.length === 0) {
                return null;
        }

        const primaryAddress = addresses[0]?.value;
        if(!primaryAddress) {
                return null;
        }

        const trimmedName = name?.trim();

        return {
                id: `${sourceId}:${primaryAddress}`,
                name: trimmedName || undefined,
                addresses,
        };
}

function createAddress(rawValue: string, type: AddressType, label?: string): PersonData["addresses"][number] | null {
        const displayValue = rawValue.trim();

        if(type === AddressType.Email) {
                if(!isValidEmailAddress(displayValue)) {
                        return null;
                }

                return {
                        value: normalizeAddress(displayValue),
                        displayValue,
                        label: cleanLabel(label),
                        type,
                };
        }

        if(!isValidPhoneNumber(displayValue)) {
                return null;
        }

        return {
                value: normalizeAddress(displayValue),
                displayValue,
                label: cleanLabel(label),
                type,
        };
}

function cleanLabel(label?: string): string | undefined {
        const trimmed = label?.trim();
        return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
        for(const value of values) {
                const trimmed = value?.trim();
                if(trimmed) {
                        return trimmed;
                }
        }

        return undefined;
}

function getCaseInsensitiveValue(row: CsvRow, key: string): string | undefined {
        const target = key.trim().toLowerCase();
        const matchedKey = Object.keys(row).find((candidate) => candidate.trim().toLowerCase() === target);
        if(!matchedKey) {
                return undefined;
        }

        return asString(row[matchedKey]);
}

function capitalizeWord(word: string): string {
        if(word.length === 0) {
                return word;
        }

        return word[0].toUpperCase() + word.slice(1);
}

function asString(value: unknown): string | undefined {
        return typeof value === "string" ? value : undefined;
}
