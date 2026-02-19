import {
        BlueBubblesRealtimeChannelOptions,
        BlueBubblesRealtimeConnectionState,
        BlueBubblesRealtimeEventName,
        BlueBubblesRealtimeListener
} from "../realtimeChannel";

const PHASE1_REALTIME_REASON = "BFF realtime bridge is not implemented in Phase 1.";

export default class BffRealtimeChannel {
        private connectionState: BlueBubblesRealtimeConnectionState = "idle";
        private readonly listeners = new Map<BlueBubblesRealtimeEventName, Set<BlueBubblesRealtimeListener>>([
                ["new-message", new Set<BlueBubblesRealtimeListener>()],
                ["updated-message", new Set<BlueBubblesRealtimeListener>()]
        ]);

        constructor(private readonly options: BlueBubblesRealtimeChannelOptions = {}) {}

        public connect(): void {
                this.setState("connecting");
                this.setState("disconnected", PHASE1_REALTIME_REASON);
        }

        public disconnect(): void {
                this.setState("disconnected", "intentional");
        }

        public subscribe(eventName: BlueBubblesRealtimeEventName, listener: BlueBubblesRealtimeListener): () => void {
                const listeners = this.listeners.get(eventName);
                if(!listeners) {
                        throw new Error(`Unsupported realtime event: ${eventName}`);
                }
                listeners.add(listener);
                return () => listeners.delete(listener);
        }

        public get state(): BlueBubblesRealtimeConnectionState {
                return this.connectionState;
        }

        public isHealthy(): boolean {
                return false;
        }

        private setState(state: BlueBubblesRealtimeConnectionState, details?: unknown): void {
                if(this.connectionState === state && details === undefined) {
                        return;
                }
                this.connectionState = state;
                this.options.onStateChange?.(state, details);
        }
}
