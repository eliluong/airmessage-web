import React from "react";
import {act, cleanup, render} from "@testing-library/react";
import {SettingsProvider, useSettings} from "shared/components/settings/SettingsProvider";

describe("SettingsProvider address book", () => {
        beforeEach(() => {
                window.localStorage.clear();
        });

        afterEach(() => {
                cleanup();
        });

        function renderCapture() {
                const capture: {context?: ReturnType<typeof useSettings>} = {};

                function Capture() {
                        const context = useSettings();
                        capture.context = context;
                        return null;
                }

                render(
                        <SettingsProvider>
                                <Capture />
                        </SettingsProvider>
                );

                return capture;
        }

        it("defaults address book selection when missing from storage", () => {
                window.localStorage.setItem(
                        "airmessage.web.settings",
                        JSON.stringify({
                                appearance: {colorScheme: "light"},
                                conversations: {initialLoadCount: 25},
                                developer: {blueBubblesDebugLogging: false}
                        })
                );

                const capture = renderCapture();
                expect(capture.context?.settings.addressBook.enabledSourceIds).toBeUndefined();
        });

        it("sanitizes stored enabled source identifiers", () => {
                window.localStorage.setItem(
                        "airmessage.web.settings",
                        JSON.stringify({
                                appearance: {colorScheme: "dark"},
                                conversations: {initialLoadCount: 50},
                                developer: {blueBubblesDebugLogging: true},
                                addressBook: {
                                        enabledSourceIds: ["  first ", "second", "second", "", 42]
                                }
                        })
                );

                const capture = renderCapture();
                expect(capture.context?.settings.addressBook.enabledSourceIds).toEqual(["first", "second"]);
        });

        it("allows updating address book preferences", () => {
                const capture = renderCapture();
                expect(capture.context).toBeDefined();

                act(() => {
                        capture.context?.updateSettings((previous) => ({
                                ...previous,
                                addressBook: {
                                        ...previous.addressBook,
                                        enabledSourceIds: []
                                }
                        }));
                });

                expect(capture.context?.settings.addressBook.enabledSourceIds).toEqual([]);
        });
});
