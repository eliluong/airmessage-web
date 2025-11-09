import React, {useCallback, useEffect, useMemo, useState} from "react";
import {
        DEFAULT_BLUEBUBBLES_DEBUG_LOGGING_ENABLED,
        setBlueBubblesDebugLoggingEnabled
} from "../../connection/bluebubbles/debugLogging";

export type SettingsColorScheme = "system" | "light" | "dark";

export interface SettingsState {
        appearance: {
                colorScheme: SettingsColorScheme;
        };
        conversations: {
                initialLoadCount: number;
        };
        developer: {
                blueBubblesDebugLogging: boolean;
        };
}

export type SettingsUpdater = (previous: SettingsState) => SettingsState;

interface SettingsContextValue {
        settings: SettingsState;
        updateSettings: (updater: SettingsUpdater) => void;
        resetSettings: () => void;
}

const STORAGE_KEY = "airmessage.web.settings";

const DEFAULT_SETTINGS: SettingsState = Object.freeze({
        appearance: {
                colorScheme: "system" as SettingsColorScheme
        },
        conversations: {
                initialLoadCount: 50
        },
        developer: {
                blueBubblesDebugLogging: DEFAULT_BLUEBUBBLES_DEBUG_LOGGING_ENABLED
        }
});

const SettingsContext = React.createContext<SettingsContextValue | undefined>(undefined);

function createDefaultSettings(): SettingsState {
        return {
                appearance: {
                        colorScheme: DEFAULT_SETTINGS.appearance.colorScheme
                },
                conversations: {
                        initialLoadCount: DEFAULT_SETTINGS.conversations.initialLoadCount
                },
                developer: {
                        blueBubblesDebugLogging: DEFAULT_SETTINGS.developer.blueBubblesDebugLogging
                }
        };
}

function isColorScheme(value: unknown): value is SettingsColorScheme {
        return value === "system" || value === "light" || value === "dark";
}

function sanitizeSettings(candidate: Partial<SettingsState> | undefined): SettingsState {
        const defaults = createDefaultSettings();
        if(!candidate) return defaults;

        const colorScheme = candidate.appearance?.colorScheme;
        const initialLoadCount = candidate.conversations?.initialLoadCount;
        const blueBubblesDebugLogging = candidate.developer?.blueBubblesDebugLogging;

        return {
                appearance: {
                        colorScheme: isColorScheme(colorScheme) ? colorScheme : defaults.appearance.colorScheme
                },
                conversations: {
                        initialLoadCount: sanitizeInitialLoadCount(initialLoadCount, defaults.conversations.initialLoadCount)
                },
                developer: {
                        blueBubblesDebugLogging: sanitizeBoolean(
                                blueBubblesDebugLogging,
                                defaults.developer.blueBubblesDebugLogging
                        )
                }
        };
}

function sanitizeInitialLoadCount(value: unknown, fallback: number): number {
        const parsed = typeof value === "number" ? value : Number(value);
        if(Number.isFinite(parsed)) {
                const normalized = Math.round(parsed);
                if(normalized >= 1 && normalized <= 1000) {
                        return normalized;
                }
        }
        return fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
        if(typeof value === "boolean") return value;
        if(value === "true") return true;
        if(value === "false") return false;
        return fallback;
}

function readStoredSettings(): SettingsState {
        if(typeof window === "undefined") {
                return createDefaultSettings();
        }

        try {
                const rawValue = window.localStorage.getItem(STORAGE_KEY);
                if(!rawValue) return createDefaultSettings();

                const parsed = JSON.parse(rawValue) as Partial<SettingsState> | undefined;
                return sanitizeSettings(parsed);
        } catch(error) {
                console.warn("Failed to read stored settings", error);
                return createDefaultSettings();
        }
}

export function SettingsProvider(props: {children: React.ReactNode}) {
        const [settings, setSettings] = useState<SettingsState>(() => readStoredSettings());

        useEffect(() => {
                if(typeof window === "undefined") return;

                try {
                        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
                } catch(error) {
                        console.warn("Failed to persist settings", error);
                }
        }, [settings]);

        const updateSettings = useCallback((updater: SettingsUpdater) => {
                setSettings((previous) => {
                        const draft: SettingsState = {
                                appearance: {
                                        colorScheme: previous.appearance.colorScheme
                                },
                                conversations: {
                                        initialLoadCount: previous.conversations.initialLoadCount
                                },
                                developer: {
                                        blueBubblesDebugLogging: previous.developer.blueBubblesDebugLogging
                                }
                        };
                        const result = updater(draft);
                        return sanitizeSettings(result);
                });
        }, []);

        const resetSettings = useCallback(() => {
                setSettings(createDefaultSettings());
        }, []);

        const contextValue = useMemo<SettingsContextValue>(() => ({
                settings,
                updateSettings,
                resetSettings
        }), [settings, updateSettings, resetSettings]);

        useEffect(() => {
                setBlueBubblesDebugLoggingEnabled(settings.developer.blueBubblesDebugLogging);
        }, [settings.developer.blueBubblesDebugLogging]);

        return (
                <SettingsContext.Provider value={contextValue}>
                        {props.children}
                </SettingsContext.Provider>
        );
}

export function useSettings(): SettingsContextValue {
        const context = React.useContext(SettingsContext);
        if(!context) {
                throw new Error("useSettings must be used within a SettingsProvider");
        }
        return context;
}
