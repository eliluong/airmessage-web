export interface ServerFeaturesResponse {
        private_api?: boolean;
        helper_connected?: boolean;
        delivered_receipts?: boolean;
        read_receipts?: boolean;
        reactions?: boolean;
        typing_indicators?: boolean;
        [feature: string]: boolean | undefined;
}

export interface ServerMetadataResponse {
        computer_id: string;
        os_version: string;
        server_version: string;
        private_api: boolean;
        helper_connected: boolean;
        proxy_service: string;
        detected_icloud: string;
        detected_imessage: string;
        macos_time_sync: number | null;
        local_ipv4s: string[];
        local_ipv6s: string[];
        features?: ServerFeaturesResponse;
}

export interface AttachmentResponse {
        originalROWID: number;
        guid: string;
        messages?: string[];
        data?: string;
        blurhash?: string;
        height?: number;
        width?: number;
        uti: string;
        mimeType: string;
        transferState?: number;
        totalBytes: number;
        isOutgoing?: boolean;
        transferName: string;
        isSticker?: boolean;
        hideAttachment?: boolean;
        originalGuid?: string;
        metadata?: Record<string, string | boolean | number>;
        hasLivePhoto?: boolean;
}

export interface HandleResponse {
        originalROWID: number;
        messages?: MessageResponse[];
        chats?: ChatResponse[];
        address: string;
        service: string;
        country?: string;
        uncanonicalizedId?: string;
}

export interface MessageResponse {
        originalROWID: number;
        tempGuid?: string;
        guid: string;
        text: string;
        attributedBody?: unknown[];
        messageSummaryInfo?: Record<string, unknown>[];
        handle?: HandleResponse | null;
        handleId: number;
        otherHandle: number;
        chats?: ChatResponse[];
        attachments?: AttachmentResponse[];
        subject: string;
        country?: string;
        error: number;
        dateCreated: number;
        dateRead: number | null;
        dateDelivered: number | null;
        isFromMe: boolean;
        isDelayed?: boolean;
        isDelivered?: boolean;
        isAutoReply?: boolean;
        isSystemMessage?: boolean;
        isServiceMessage?: boolean;
        isForward?: boolean;
        isArchived: boolean;
        hasDdResults?: boolean;
        cacheRoomnames?: string | null;
        isAudioMessage?: boolean;
        datePlayed?: number | null;
        itemType: number;
        groupTitle: string | null;
        groupActionType: number;
        isExpired?: boolean;
        balloonBundleId: string | null;
        associatedMessageGuid: string | null;
        associatedMessageType: string | null;
        expressiveSendStyleId: string | null;
        timeExpressiveSendPlayed?: number | null;
        replyToGuid?: string | null;
        isCorrupt?: boolean;
        isSpam?: boolean;
        threadOriginatorGuid?: string | null;
        threadOriginatorPart?: string | null;
        dateRetracted?: number | null;
        dateEdited?: number | null;
        partCount?: number | null;
        payloadData?: Record<string, unknown>[];
        hasPayloadData?: boolean;
        wasDeliveredQuietly?: boolean;
        didNotifyRecipient?: boolean;
        shareStatus?: number | null;
        shareDirection?: number | null;
}

export interface ChatResponse {
        originalROWID: number;
        guid: string;
        participants?: HandleResponse[];
        messages?: MessageResponse[];
        lastMessage?: MessageResponse;
        properties?: Record<string, unknown>[] | null;
        style: number;
        chatIdentifier: string;
        isArchived: boolean;
        isFiltered?: boolean;
        displayName: string;
        groupId?: string;
        lastAddressedHandle?: string | null;
}

export interface MessageQueryResponse {
        data: MessageResponse[];
        metadata?: {
                offset?: number;
                limit?: number;
                total?: number;
                count?: number;
        };
}

export interface ChatQueryResponse {
        data: ChatResponse[];
        metadata?: {
                count: number;
                total: number;
                offset?: number;
                limit?: number;
        };
}

export interface SingleChatResponse {
        data: ChatResponse;
}

export interface MessageSendResponse {
        data: MessageResponse;
}

export interface AttachmentSendResponse {
        data: MessageResponse;
}

export interface ChatCreateResponse {
        data: ChatResponse;
}

export interface SuccessResponse {
        message?: string;
}

export interface ApiErrorResponse {
        error?: string;
        message?: string;
        code?: string | number;
}
