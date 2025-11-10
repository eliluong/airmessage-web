import {parseBaikalAddressBook, parseGoogleAddressBook} from "../addressBookParsers";
import {AddressType} from "../peopleUtils";

describe("parseGoogleAddressBook", () => {
        it("parses contacts that use label columns", () => {
                const csv = [
                        "First Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value",
                        "Alex,Hui,Work,alex@example.com,Home,alex.home@example.com,Mobile,2066978995,Home,\"+1 (714) 905-9516\"",
                        ",,,,,,,,,",
                ].join("\n");

                expect(parseGoogleAddressBook(csv)).toEqual([
                        {
                                id: "google:alex@example.com",
                                name: "Alex Hui",
                                addresses: [
                                        {
                                                value: "alex@example.com",
                                                displayValue: "alex@example.com",
                                                label: "Work",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "alex.home@example.com",
                                                displayValue: "alex.home@example.com",
                                                label: "Home",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "+12066978995",
                                                displayValue: "2066978995",
                                                label: "Mobile",
                                                type: AddressType.Phone,
                                        },
                                        {
                                                value: "+17149059516",
                                                displayValue: "+1 (714) 905-9516",
                                                label: "Home",
                                                type: AddressType.Phone,
                                        },
                                ],
                        },
                ]);
        });

        it("handles primary and secondary email fields", () => {
                const csv = [
                        "Name,Primary Email,Primary Email - Type,Secondary Email,Phone 1 - Label,Phone 1 - Value",
                        "Sam Example,sam@example.com,Custom Label,sam.alt@example.com,Work,+1 650-253-0000",
                ].join("\n");

                expect(parseGoogleAddressBook(csv)).toEqual([
                        {
                                id: "google:sam@example.com",
                                name: "Sam Example",
                                addresses: [
                                        {
                                                value: "sam@example.com",
                                                displayValue: "sam@example.com",
                                                label: "Custom Label",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "sam.alt@example.com",
                                                displayValue: "sam.alt@example.com",
                                                label: "Secondary",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "+16502530000",
                                                displayValue: "+1 650-253-0000",
                                                label: "Work",
                                                type: AddressType.Phone,
                                        },
                                ],
                        },
                ]);
        });

        it("skips rows without valid addresses", () => {
                const csv = [
                        "Name,E-mail 1 - Value,Phone 1 - Value",
                        "Jane Doe,not-an-email,12345",
                ].join("\n");

                expect(parseGoogleAddressBook(csv)).toEqual([]);
        });
});

describe("parseBaikalAddressBook", () => {
        it("parses Baikal CSV columns", () => {
                const csv = [
                        "First Name,Last Name,Display Name,Primary Email,Secondary Email,Mobile Number,Home Phone",
                        "Alexa,Lean,Alexa Lean,alexa@example.com,,+1 (714) 812-0204,",
                        "Brent,Yeung,Brent Yeung,,brent.work@example.com,,19496366812",
                ].join("\n");

                expect(parseBaikalAddressBook(csv)).toEqual([
                        {
                                id: "baikal:alexa@example.com",
                                name: "Alexa Lean",
                                addresses: [
                                        {
                                                value: "alexa@example.com",
                                                displayValue: "alexa@example.com",
                                                label: "Primary",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "+17148120204",
                                                displayValue: "+1 (714) 812-0204",
                                                label: "Mobile",
                                                type: AddressType.Phone,
                                        },
                                ],
                        },
                        {
                                id: "baikal:brent.work@example.com",
                                name: "Brent Yeung",
                                addresses: [
                                        {
                                                value: "brent.work@example.com",
                                                displayValue: "brent.work@example.com",
                                                label: "Secondary",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "+19496366812",
                                                displayValue: "19496366812",
                                                label: "Home",
                                                type: AddressType.Phone,
                                        },
                                ],
                        },
                ]);
        });

        it("parses Baikal vCard style keys", () => {
                const csv = [
                        "FN,item1.EMAIL;TYPE=HOME,item1.TEL;TYPE=CELL;TYPE=pref,item2.EMAIL;TYPE=WORK",
                        "Alice Example,alice@example.com,+1 650-253-0000,work@example.com",
                ].join("\n");

                expect(parseBaikalAddressBook(csv)).toEqual([
                        {
                                id: "baikal:alice@example.com",
                                name: "Alice Example",
                                addresses: [
                                        {
                                                value: "alice@example.com",
                                                displayValue: "alice@example.com",
                                                label: "HOME",
                                                type: AddressType.Email,
                                        },
                                        {
                                                value: "+16502530000",
                                                displayValue: "+1 650-253-0000",
                                                label: "CELL/pref",
                                                type: AddressType.Phone,
                                        },
                                        {
                                                value: "work@example.com",
                                                displayValue: "work@example.com",
                                                label: "WORK",
                                                type: AddressType.Email,
                                        },
                                ],
                        },
                ]);
        });

        it("ignores invalid Baikal addresses", () => {
                const csv = [
                        "First Name,Primary Email,Mobile Number",
                        "Broken,not-an-email,555",
                ].join("\n");

                expect(parseBaikalAddressBook(csv)).toEqual([]);
        });
});
