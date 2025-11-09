export interface ThreadFocusTarget {
        guid?: string;
        serverID?: number;
}

export function areFocusTargetsEqual(a?: ThreadFocusTarget, b?: ThreadFocusTarget): boolean {
        if(a === b) return true;
        if(!a || !b) return false;
        return a.guid === b.guid && a.serverID === b.serverID;
}
