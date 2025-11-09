export const DEFAULT_BLUEBUBBLES_DEBUG_LOGGING_ENABLED = true;

let isDebugLoggingEnabled = DEFAULT_BLUEBUBBLES_DEBUG_LOGGING_ENABLED;

export function setBlueBubblesDebugLoggingEnabled(enabled: boolean): void {
        isDebugLoggingEnabled = enabled;
}

export function isBlueBubblesDebugLoggingEnabled(): boolean {
        return isDebugLoggingEnabled;
}

export function logBlueBubblesDebug(label: string, details?: unknown): void {
        if(!isDebugLoggingEnabled) return;

        if(typeof details === "undefined") {
                console.log(`[BlueBubbles] ${label}`);
        } else {
                console.log(`[BlueBubbles] ${label}`, details);
        }
}
