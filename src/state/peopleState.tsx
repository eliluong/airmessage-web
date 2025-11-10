import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {parseBaikalAddressBook, parseGoogleAddressBook} from "shared/interface/people/addressBookParsers";
import {AddressType, PersonData} from "shared/interface/people/peopleUtils";
import {normalizeAddress} from "shared/util/addressHelper";

const STORAGE_KEY = "airmessage.web.addressBook";

export type AddressBookFormat = "google" | "baikal" | "unknown";

export interface AddressBookSourceStatus {
id: string;
label: string;
type?: string;
path: string;
format: AddressBookFormat;
version?: string;
enabled: boolean;
syncedAt?: string;
needsUpdate: boolean;
isSyncing: boolean;
error?: string;
peopleCount: number;
}

export interface PeopleState {
needsPermission: boolean;
getPerson(address: string): PersonData | undefined;
allPeople: PersonData[] | undefined;
sources: AddressBookSourceStatus[];
isSyncing: boolean;
syncAddressBooks(selectedIds?: string[]): Promise<void>;
}

interface AddressBookCacheEntry {
people: PersonData[];
syncedAt: string;
version?: string;
}

type AddressBookCache = Record<string, AddressBookCacheEntry>;

interface AddressBookManifestSource {
id: string;
label: string;
path: string;
format: AddressBookFormat;
type?: string;
version?: string;
enabled?: boolean;
}

interface AddressBookSourceInternal {
id: string;
label: string;
type?: string;
path: string;
format: AddressBookFormat;
version?: string;
enabled: boolean;
syncedAt?: string;
needsUpdate: boolean;
isSyncing: boolean;
error?: string;
people: PersonData[];
}

interface MergeResult {
people: PersonData[];
peopleByAddress: Map<string, PersonData>;
}

export const PeopleContext = React.createContext<PeopleState>({
needsPermission: false,
getPerson: () => undefined,
allPeople: undefined,
sources: [],
isSyncing: false,
syncAddressBooks: async () => {
/* no-op */
}
});

export function PeopleContextProvider(props: {
children?: React.ReactNode;
ready?: boolean;
}) {
const isReady = props.ready !== false;
const [initialCache] = useState<AddressBookCache>(() => readCache());
const cacheRef = useRef<AddressBookCache>(initialCache);
const [sources, setSources] = useState<AddressBookSourceInternal[]>([]);
const [hasLoaded, setHasLoaded] = useState(false);

useEffect(() => {
if(!isReady) {
return;
}

let cancelled = false;
const controller = new AbortController();

async function loadManifest() {
try {
const manifestSources = await fetchManifest(controller.signal);
if(cancelled) {
return;
}

const manifestIds = new Set(manifestSources.map((source) => source.id));
const prunedCache: AddressBookCache = {};
for(const [id, entry] of Object.entries(cacheRef.current)) {
if(manifestIds.has(id)) {
prunedCache[id] = {
people: normalizePeopleList(entry.people),
syncedAt: entry.syncedAt,
version: entry.version
};
}
}
cacheRef.current = prunedCache;
writeCache(prunedCache);

const nextSources = manifestSources.map((source) => createSourceState(source, prunedCache[source.id]));
setSources(nextSources);
setHasLoaded(true);
} catch(error) {
if(cancelled || isAbortError(error)) {
return;
}

const fallbackSources = createFallbackSources(cacheRef.current);
setSources(fallbackSources);
setHasLoaded(true);
}
}

void loadManifest();

return () => {
cancelled = true;
controller.abort();
};
}, [isReady]);

const mergeResult = useMemo<MergeResult>(() => mergePeopleFromSources(sources), [sources]);
const allPeople = hasLoaded ? mergeResult.people : undefined;
const isSyncing = useMemo(() => sources.some((source) => source.isSyncing), [sources]);

const getPerson = useCallback((address: string): PersonData | undefined => {
if(!address) {
return undefined;
}

const trimmed = address.trim();
if(trimmed.length === 0) {
return undefined;
}

const direct = mergeResult.peopleByAddress.get(trimmed);
if(direct) {
return direct;
}

try {
const normalized = normalizeAddress(trimmed);
return mergeResult.peopleByAddress.get(normalized) ?? mergeResult.peopleByAddress.get(trimmed);
} catch {
return mergeResult.peopleByAddress.get(trimmed);
}
}, [mergeResult]);

const sourcesForContext = useMemo<AddressBookSourceStatus[]>(() => sources.map((source) => ({
id: source.id,
label: source.label,
type: source.type,
path: source.path,
format: source.format,
version: source.version,
enabled: source.enabled,
syncedAt: source.syncedAt,
needsUpdate: source.needsUpdate,
isSyncing: source.isSyncing,
error: source.error,
peopleCount: source.people.length
})), [sources]);

const syncAddressBooks = useCallback(async (selectedIds?: string[]) => {
if(!isReady || sources.length === 0) {
return;
}

const snapshot = sources;
const selectedSet = selectedIds ? new Set(selectedIds) : undefined;
const targets = snapshot
.map((source, index) => ({source, index}))
.filter(({source}) => selectedSet ? selectedSet.has(source.id) : source.enabled);

if(targets.length === 0) {
return;
}

const targetIndexSet = new Set(targets.map(({index}) => index));
setSources((current) => current.map((source, index) => {
if(!targetIndexSet.has(index)) {
return source;
}

return {
...source,
isSyncing: true,
error: undefined
};
}));

let cacheChanged = false;
const nextCache: AddressBookCache = {...cacheRef.current};

for(const {source, index} of targets) {
let updatedSource: AddressBookSourceInternal = source;

try {
const parser = getParserForFormat(source.format);
if(!parser) {
throw new Error("No parser available for this address book source");
}

const sourcePath = buildSourceUrl(source.path);
const response = await fetch(sourcePath);
if(!response.ok) {
throw new Error(`Failed to download address book (${response.status})`);
}

const csv = await response.text();
const parsedPeople = parser(csv);
const normalizedPeople = normalizePeopleList(parsedPeople);
const syncedAt = new Date().toISOString();
updatedSource = {
...source,
people: normalizedPeople,
syncedAt,
needsUpdate: false,
isSyncing: false,
error: undefined
};

nextCache[source.id] = {
people: clonePeople(normalizedPeople),
syncedAt,
version: source.version
};
cacheChanged = true;
} catch(error) {
const message = error instanceof Error ? error.message : "Unknown error";
updatedSource = {
...source,
error: message,
isSyncing: false
};
}

setSources((current) => {
const next = [...current];
const existing = next[index];
next[index] = {
...existing,
...updatedSource
};
return next;
});
}

if(cacheChanged) {
cacheRef.current = nextCache;
writeCache(nextCache);
}
}, [isReady, sources]);

return (
<PeopleContext.Provider value={{
needsPermission: false,
getPerson,
allPeople,
sources: sourcesForContext,
isSyncing,
syncAddressBooks
}}>
{props.children}
</PeopleContext.Provider>
);
}

function fetchManifest(signal: AbortSignal): Promise<AddressBookManifestSource[]> {
const manifestUrl = buildSourceUrl("manifest.json");

return fetch(manifestUrl, {signal})
.then((response) => {
if(!response.ok) {
throw new Error(`Failed to load address book manifest (${response.status})`);
}

return response.json();
})
.then((data) => parseManifest(data));
}

function parseManifest(data: unknown): AddressBookManifestSource[] {
if(!data || typeof data !== "object") {
return [];
}

const sources = Array.isArray((data as Record<string, unknown>).sources)
? (data as Record<string, unknown>).sources as unknown[]
: [];

return sources
.map((entry) => sanitizeManifestSource(entry))
.filter((entry): entry is AddressBookManifestSource => entry != null);
}

function sanitizeManifestSource(raw: unknown): AddressBookManifestSource | null {
if(!raw || typeof raw !== "object") {
return null;
}

const record = raw as Record<string, unknown>;
const id = typeof record.id === "string" ? record.id.trim() : "";
const label = typeof record.label === "string" ? record.label.trim() : "";
const path = typeof record.path === "string" ? record.path.trim() : "";
const type = typeof record.type === "string" ? record.type : undefined;
const version = typeof record.version === "string" ? record.version : undefined;
const enabled = typeof record.enabled === "boolean" ? record.enabled : undefined;

let formatValue = "";
if(typeof record.format === "string") {
formatValue = record.format.trim().toLowerCase();
} else if(typeof record.parser === "string") {
formatValue = record.parser.trim().toLowerCase();
}

let format: AddressBookFormat = "unknown";
if(formatValue === "google") {
format = "google";
} else if(formatValue === "baikal") {
format = "baikal";
}

if(!id || !label || !path || format === "unknown") {
return null;
}

return {
id,
label,
path,
format,
type,
version,
enabled
};
}

function createSourceState(source: AddressBookManifestSource, cacheEntry?: AddressBookCacheEntry): AddressBookSourceInternal {
const cachedPeople = cacheEntry ? normalizePeopleList(cacheEntry.people) : [];
const hasCache = Boolean(cacheEntry);
const needsUpdate = !hasCache || (source.version != null && cacheEntry?.version !== source.version);

return {
id: source.id,
label: source.label,
type: source.type,
path: source.path,
format: source.format,
version: source.version,
enabled: source.enabled !== false,
syncedAt: cacheEntry?.syncedAt,
needsUpdate,
isSyncing: false,
error: undefined,
people: cachedPeople
};
}

function createFallbackSources(cache: AddressBookCache): AddressBookSourceInternal[] {
return Object.entries(cache).map(([id, entry]) => ({
id,
label: id,
path: "",
format: "unknown" as AddressBookFormat,
version: entry.version,
enabled: true,
syncedAt: entry.syncedAt,
needsUpdate: false,
isSyncing: false,
error: "Manifest unavailable",
people: normalizePeopleList(entry.people)
}));
}

function mergePeopleFromSources(sources: AddressBookSourceInternal[]): MergeResult {
const mergedPeople: PersonData[] = [];
const addressToIndex = new Map<string, number>();

for(const source of sources) {
if(!source.enabled) {
continue;
}

for(const person of source.people) {
if(person.addresses.length === 0) {
continue;
}

const dedupedAddresses = dedupeAddresses(person.addresses);
if(dedupedAddresses.length === 0) {
continue;
}

let existingIndex: number | undefined;
for(const address of dedupedAddresses) {
const index = addressToIndex.get(address.value);
if(index !== undefined) {
existingIndex = index;
break;
}
}

if(existingIndex === undefined) {
const newPerson: PersonData = {
id: person.id,
name: person.name,
avatar: person.avatar,
addresses: dedupedAddresses.map((address) => ({...address}))
};
mergedPeople.push(newPerson);
const newIndex = mergedPeople.length - 1;
for(const address of newPerson.addresses) {
addressToIndex.set(address.value, newIndex);
}
continue;
}

const existing = mergedPeople[existingIndex];
const existingAddresses = dedupeAddresses(existing.addresses);
const knownValues = new Set(existingAddresses.map((address) => address.value));
let name = existing.name;
let avatar = existing.avatar;

if(!name && person.name) {
name = person.name;
}

if(!avatar && person.avatar) {
avatar = person.avatar;
}

for(const address of dedupedAddresses) {
if(!knownValues.has(address.value)) {
existingAddresses.push({...address});
knownValues.add(address.value);
}
addressToIndex.set(address.value, existingIndex);
}

mergedPeople[existingIndex] = {
...existing,
name,
avatar,
addresses: existingAddresses
};
}
}

const peopleByAddress = new Map<string, PersonData>();
for(const person of mergedPeople) {
for(const address of person.addresses) {
peopleByAddress.set(address.value, person);
}
}

return {
people: mergedPeople,
peopleByAddress
};
}

function dedupeAddresses(addresses: PersonData["addresses"]): PersonData["addresses"] {
const unique: PersonData["addresses"] = [];
const seen = new Set<string>();

for(const address of addresses) {
if(seen.has(address.value)) {
continue;
}

seen.add(address.value);
unique.push({...address});
}

return unique;
}

function normalizePeopleList(people: PersonData[]): PersonData[] {
const normalized: PersonData[] = [];

for(const person of people) {
const addresses = dedupeAddresses(person.addresses);
if(addresses.length === 0) {
continue;
}

normalized.push({
id: person.id,
name: person.name,
avatar: person.avatar,
addresses
});
}

return normalized;
}

function clonePeople(people: PersonData[]): PersonData[] {
return people.map((person) => ({
...person,
addresses: person.addresses.map((address) => ({...address}))
}));
}

function getParserForFormat(format: AddressBookFormat) {
if(format === "google") {
return parseGoogleAddressBook;
}

if(format === "baikal") {
return parseBaikalAddressBook;
}

return undefined;
}

function buildSourceUrl(path: string): string {
const sanitized = sanitizeRelativePath(path);
const relative = sanitized.startsWith("address-books/") ? sanitized : `address-books/${sanitized}`;
return buildPublicUrl(relative);
}

function buildPublicUrl(relativePath: string): string {
const trimmedRelative = relativePath.replace(/^\/+/, "");
const base = process.env.PUBLIC_URL ?? "";
if(!base) {
return trimmedRelative;
}

const trimmedBase = base.replace(/\/$/, "");
return `${trimmedBase}/${trimmedRelative}`;
}

function sanitizeRelativePath(path: string): string {
return path
.trim()
.replace(/^\/+/, "")
.split("/")
.filter((segment) => segment.length > 0 && segment !== "..")
.join("/");
}

function readCache(): AddressBookCache {
if(typeof window === "undefined" || !window.localStorage) {
return {};
}

try {
const rawValue = window.localStorage.getItem(STORAGE_KEY);
if(!rawValue) {
return {};
}

const parsed = JSON.parse(rawValue);
if(!parsed || typeof parsed !== "object") {
return {};
}

const result: AddressBookCache = {};
for(const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
if(!value || typeof value !== "object") {
continue;
}

const entry = value as Record<string, unknown>;
const people = sanitizeCachedPeople(entry.people);
const syncedAt = typeof entry.syncedAt === "string" ? entry.syncedAt : undefined;
const version = typeof entry.version === "string" ? entry.version : undefined;

if(!syncedAt || people.length === 0) {
continue;
}

result[id] = {
people,
syncedAt,
version
};
}

return result;
} catch(error) {
console.warn("Failed to read address book cache", error);
return {};
}
}

function writeCache(cache: AddressBookCache): void {
if(typeof window === "undefined" || !window.localStorage) {
return;
}

try {
window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
} catch(error) {
console.warn("Failed to write address book cache", error);
}
}

function sanitizeCachedPeople(value: unknown): PersonData[] {
if(!Array.isArray(value)) {
return [];
}

const sanitized: PersonData[] = [];
for(const item of value) {
const person = coercePersonData(item);
if(person) {
sanitized.push(person);
}
}

return sanitized;
}

function coercePersonData(candidate: unknown): PersonData | null {
if(!candidate || typeof candidate !== "object") {
return null;
}

const record = candidate as Record<string, unknown>;
const id = typeof record.id === "string" ? record.id : undefined;
if(!id) {
return null;
}

const rawName = typeof record.name === "string" ? record.name.trim() : undefined;
const rawAvatar = typeof record.avatar === "string" ? record.avatar.trim() : undefined;
const addressesValue = Array.isArray(record.addresses) ? record.addresses : [];
const addresses: PersonData["addresses"] = [];
const seen = new Set<string>();

for(const rawAddress of addressesValue) {
if(!rawAddress || typeof rawAddress !== "object") {
continue;
}

const addressRecord = rawAddress as Record<string, unknown>;
const value = typeof addressRecord.value === "string" ? addressRecord.value : undefined;
const displayValue = typeof addressRecord.displayValue === "string" ? addressRecord.displayValue : undefined;
const label = typeof addressRecord.label === "string" ? addressRecord.label : undefined;
const typeValue = addressRecord.type;
const type = typeValue === AddressType.Email || typeValue === "email"
? AddressType.Email
: typeValue === AddressType.Phone || typeValue === "phone"
? AddressType.Phone
: undefined;

if(!value || !displayValue || !type || seen.has(value)) {
continue;
}

seen.add(value);
addresses.push({value, displayValue, label, type});
}

if(addresses.length === 0) {
return null;
}

return {
id,
name: rawName || undefined,
avatar: rawAvatar || undefined,
addresses
};
}

function isAbortError(error: unknown): boolean {
return error instanceof DOMException && error.name === "AbortError";
}
