import {ConversationItem, MessageSearchHit} from "../data/blocks";

export interface MessageSearchOptions {
        term: string;
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
        chatGuids?: string[];
        handleGuids?: string[];
}

export interface MessageSearchMetadata {
        offset?: number;
        limit?: number;
        total?: number;
        count?: number;
}

export interface MessageSearchHydratedResult {
        items: ConversationItem[];
        metadata?: MessageSearchMetadata;
}

export interface MessageSearchResult {
        items: MessageSearchHit[];
        metadata?: MessageSearchMetadata;
}
