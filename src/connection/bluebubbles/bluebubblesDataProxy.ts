import DataProxy from "../dataProxy";
import {ConnectionErrorCode} from "../../data/stateCodes";

export default class BlueBubblesDataProxy extends DataProxy {
        public readonly proxyType = "BlueBubbles";

        start(): void {
                // No-op: the BlueBubbles communications manager performs HTTP handshakes directly.
                // Immediately report the proxy as open so the communications manager can continue.
                this.notifyOpen();
        }

        stop(): void {
                // Nothing to tear down - the communications manager owns any ongoing polling streams.
        }

        send(_: ArrayBuffer): void {
                // BlueBubbles REST transport does not use the binary proxy channel.
        }

        public override stopWithReason(reason: ConnectionErrorCode) {
                super.stopWithReason(reason);
                this.notifyClose(reason);
        }
}
