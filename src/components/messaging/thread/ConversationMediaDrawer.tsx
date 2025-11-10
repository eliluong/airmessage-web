import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {
        AttachmentItem,
        Conversation,
        ConversationItem,
        MessageItem
} from "shared/data/blocks";
import {
        Box,
        Button,
        CircularProgress,
        Dialog,
        Divider,
        Drawer,
        IconButton,
        Stack,
        Toolbar,
        Typography,
        useMediaQuery,
        ButtonBase,
        styled
} from "@mui/material";
import {Close, InsertDriveFileOutlined} from "@mui/icons-material";
import {useTheme} from "@mui/material/styles";
import * as ConnectionManager from "shared/connection/connectionManager";
import type {ThreadFetchResult} from "shared/connection/connectionManager";
import {ConversationItemType} from "shared/data/stateCodes";
import {formatFileSize} from "shared/util/languageUtils";
import {isAttachmentPreviewable} from "shared/util/conversationUtils";
import {downloadBlob} from "shared/util/browserUtils";
import {SnackbarContext} from "shared/components/control/SnackbarProvider";
import FileDownloadResult from "shared/data/fileDownloadResult";
import AttachmentLightbox from "./item/AttachmentLightbox";

const PAGE_SIZE = 30;

interface MediaTile {
        key: string;
        attachment: AttachmentItem;
        messageDate: Date;
        messageGuid?: string;
        messageServerID?: number;
}

interface ConversationMediaDrawerProps {
        conversation: Conversation;
        open: boolean;
        onClose: () => void;
}

const MediaGrid = styled("div")(({theme}) => ({
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: theme.spacing(2)
}));

const MediaTileButton = styled(ButtonBase)(({theme}) => ({
        position: "relative",
        width: "100%",
        paddingTop: "100%",
        borderRadius: theme.shape.borderRadius,
        overflow: "hidden",
        backgroundColor: theme.palette.action.hover,
        color: theme.palette.text.secondary,
        transition: "transform 150ms ease",
        '&:hover': {
                transform: "scale(1.01)"
        }
}));

const MediaTileImage = styled("img")({
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover"
});

const MediaTilePlaceholder = styled(Box)(({theme}) => ({
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.secondary
}));

const MetadataOverlay = styled(Box)(({theme}) => ({
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: theme.spacing(1.5),
        background: "linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.7) 100%)",
        color: theme.palette.common.white,
        opacity: 0,
        transition: "opacity 150ms ease",
        pointerEvents: "none",
        [`${MediaTileButton}:hover &`]: {
                opacity: 1
        }
}));

const LoadingOverlay = styled(Box)(({theme}) => ({
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.palette.action.disabledBackground
}));

export default function ConversationMediaDrawer({conversation, open, onClose}: ConversationMediaDrawerProps) {
        const theme = useTheme();
        const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
        const snackbar = useContext(SnackbarContext);

        const [mediaItems, setMediaItems] = useState<MediaTile[]>([]);
        const [metadata, setMetadata] = useState<ThreadFetchResult["metadata"]>(undefined);
        const [isLoading, setIsLoading] = useState(false);
        const [isLoadingMore, setIsLoadingMore] = useState(false);
        const [loadError, setLoadError] = useState<string | undefined>(undefined);
        const [hasMore, setHasMore] = useState(true);
        const [previewState, setPreviewState] = useState<{guid: string; title: string; url: string; data: FileDownloadResult;} | null>(null);
        const [previewLoadingGuid, setPreviewLoadingGuid] = useState<string | undefined>(undefined);
        const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());

        const downloadCache = useRef<Map<string, FileDownloadResult>>(new Map());
        const mountedRef = useRef(true);
        const conversationGuid = conversation.localOnly ? undefined : conversation.guid;
        const conversationKey = useMemo(() => conversationGuid ?? `local:${conversation.localID}`, [conversationGuid, conversation.localID]);
        const initializedConversation = useRef<string | undefined>(undefined);
        const previewUrlsRef = useRef<Map<string, string>>(new Map());

        useEffect(() => {
                return () => {
                        mountedRef.current = false;
                        previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
                        previewUrlsRef.current = new Map();
                };
        }, []);

        useEffect(() => {
                previewUrlsRef.current = previewUrls;
        }, [previewUrls]);

        const clearPreviewUrls = useCallback(() => {
                previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
                previewUrlsRef.current = new Map();
                setPreviewUrls(new Map());
        }, []);

        const resetState = useCallback(() => {
                setMediaItems([]);
                setMetadata(undefined);
                setHasMore(true);
                setLoadError(undefined);
                setPreviewState(null);
                setPreviewLoadingGuid(undefined);
                clearPreviewUrls();
                downloadCache.current.clear();
        }, [clearPreviewUrls]);

        const mergeMediaItems = useCallback((current: MediaTile[], incoming: MediaTile[]) => {
                const map = new Map<string, MediaTile>();
                for(const item of current) {
                        map.set(item.key, item);
                }
                for(const item of incoming) {
                        const existing = map.get(item.key);
                        if(!existing || existing.messageDate.getTime() < item.messageDate.getTime()) {
                                map.set(item.key, item);
                        }
                }
                const merged = Array.from(map.values());
                merged.sort((a, b) => b.messageDate.getTime() - a.messageDate.getTime());
                return merged;
        }, []);

        const updateMetadata = useCallback((base: ThreadFetchResult["metadata"], result: ThreadFetchResult): ThreadFetchResult["metadata"] => {
                let next = mergeMetadata(base, result.metadata);
                const itemMetadata = computeMetadataFromItems(result.items);
                next = mergeMetadata(next, itemMetadata);
                return next;
        }, []);

        const loadInitial = useCallback(async () => {
                if(!conversationGuid) {
                        setMediaItems([]);
                        setMetadata(undefined);
                        setHasMore(false);
                        setLoadError("Media is unavailable for unsynced conversations.");
                        return;
                }

                setIsLoading(true);
                setLoadError(undefined);
                try {
                        const result = await ConnectionManager.fetchThread(conversationGuid, {limit: PAGE_SIZE});
                        if(!mountedRef.current) return;
                        const nextItems = extractMediaTiles(result.items);
                        setMediaItems(nextItems);
                        const nextMetadata = updateMetadata(undefined, result);
                        setMetadata(nextMetadata);
                        const moreAvailable = Boolean(result.items.length >= PAGE_SIZE && nextMetadata?.oldestServerID !== undefined);
                        setHasMore(moreAvailable);
                } catch(error) {
                        console.warn("Failed to load conversation media", error);
                        if(!mountedRef.current) return;
                        setLoadError("Unable to load media for this conversation.");
                        setHasMore(false);
                } finally {
                        if(mountedRef.current) {
                                setIsLoading(false);
                        }
                }
        }, [conversationGuid, updateMetadata]);

        const loadMore = useCallback(async () => {
                if(!conversationGuid || isLoadingMore) return;
                const oldest = metadata?.oldestServerID;
                if(oldest === undefined) {
                        setHasMore(false);
                        return;
                }
                setIsLoadingMore(true);
                try {
                        const result = await ConnectionManager.fetchThread(conversationGuid, {
                                anchorMessageID: oldest,
                                direction: "before",
                                limit: PAGE_SIZE
                        });
                        if(!mountedRef.current) return;
                        const nextItems = extractMediaTiles(result.items);
                        setMediaItems((current) => mergeMediaItems(current, nextItems));
                        const previousMetadata = metadata;
                        const mergedMetadata = updateMetadata(previousMetadata, result);
                        setMetadata(mergedMetadata);
                        const previousOldest = previousMetadata?.oldestServerID;
                        const mergedOldest = mergedMetadata?.oldestServerID;
                        if(result.items.length === 0 || mergedOldest === previousOldest) {
                                setHasMore(false);
                        } else {
                                setHasMore(result.items.length >= PAGE_SIZE);
                        }
                } catch(error) {
                        console.warn("Failed to load additional media", error);
                        if(!mountedRef.current) return;
                        snackbar?.({message: "Failed to load more media."});
                } finally {
                        if(mountedRef.current) {
                                setIsLoadingMore(false);
                        }
                }
        }, [conversationGuid, isLoadingMore, metadata, mergeMediaItems, snackbar, updateMetadata]);

        useEffect(() => {
                if(!open) return;
                if(initializedConversation.current !== conversationKey) {
                        initializedConversation.current = conversationKey;
                        resetState();
                        loadInitial();
                }
        }, [open, conversationKey, loadInitial, resetState]);

        const handleRetry = useCallback(() => {
                resetState();
                loadInitial();
        }, [resetState, loadInitial]);

        const handleTileClick = useCallback(async (item: MediaTile) => {
                const guid = item.attachment.guid;
                if(!guid || !isAttachmentPreviewable(item.attachment.type)) {
                        snackbar?.({message: "Preview isn\'t available for this attachment."});
                        return;
                }

                const cached = downloadCache.current.get(guid);
                if(cached) {
                        const existingUrl = previewUrls.get(guid);
                        if(existingUrl) {
                                setPreviewState({guid, title: item.attachment.name, url: existingUrl, data: cached});
                                return;
                        }
                }

                setPreviewLoadingGuid(guid);
                try {
                        const download = await ConnectionManager.fetchAttachment(guid).promise;
                        if(!mountedRef.current) return;
                        downloadCache.current.set(guid, download);
                        const url = URL.createObjectURL(download.data);
                        setPreviewUrls((prev) => {
                                const next = new Map(prev);
                                const previousUrl = next.get(guid);
                                if(previousUrl) URL.revokeObjectURL(previousUrl);
                                next.set(guid, url);
                                return next;
                        });
                        setPreviewState({guid, title: item.attachment.name, url, data: download});
                } catch(error) {
                        console.warn("Failed to fetch attachment preview", error);
                        if(!mountedRef.current) return;
                        snackbar?.({message: "Couldn\'t open this attachment."});
                } finally {
                        if(mountedRef.current) {
                                setPreviewLoadingGuid(undefined);
                        }
                }
        }, [previewUrls, snackbar]);

        const closePreview = useCallback(() => setPreviewState(null), []);

        const handleDownloadPreview = useCallback(() => {
                if(!previewState) return;
                downloadBlob(
                        previewState.data.data,
                        previewState.data.downloadType ?? previewState.data.data.type,
                        previewState.data.downloadName ?? previewState.title
                );
        }, [previewState]);

        const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short"
        }), []);

        const renderBody = () => {
                if(isLoading) {
                        return (
                                <Stack height="100%" alignItems="center" justifyContent="center">
                                        <CircularProgress />
                                </Stack>
                        );
                }

                if(loadError) {
                        return (
                                <Stack height="100%" alignItems="center" justifyContent="center" spacing={2}>
                                        <Typography color="textSecondary" textAlign="center">
                                                {loadError}
                                        </Typography>
                                        <Button variant="contained" onClick={handleRetry}>Retry</Button>
                                </Stack>
                        );
                }

                if(mediaItems.length === 0) {
                        return (
                                <Stack height="100%" alignItems="center" justifyContent="center" spacing={1}>
                                        <Typography color="textSecondary" textAlign="center">
                                                No media found in this conversation yet.
                                        </Typography>
                                </Stack>
                        );
                }

                return (
                        <Stack spacing={2}>
                                <MediaGrid>
                                        {mediaItems.map((item) => {
                                                const guid = item.attachment.guid;
                                                const previewUrl = guid ? previewUrls.get(guid) : undefined;
                                                const isLoadingPreview = guid !== undefined && previewLoadingGuid === guid;
                                                return (
                                                        <MediaTileButton
                                                                key={item.key}
                                                                onClick={() => handleTileClick(item)}
                                                                disabled={isLoadingPreview}>
                                                                {previewUrl ? (
                                                                        <MediaTileImage src={previewUrl} alt="" />
                                                                ) : (
                                                                        <MediaTilePlaceholder>
                                                                                <InsertDriveFileOutlined fontSize="large" />
                                                                        </MediaTilePlaceholder>
                                                                )}
                                                                {isLoadingPreview && (
                                                                        <LoadingOverlay>
                                                                                <CircularProgress size={32} />
                                                                        </LoadingOverlay>
                                                                )}
                                                                <MetadataOverlay>
                                                                        <Typography variant="subtitle2" noWrap>
                                                                                {item.attachment.name}
                                                                        </Typography>
                                                                        <Typography variant="caption" noWrap>
                                                                                {formatFileSize(item.attachment.size)} • {dateFormatter.format(item.messageDate)}
                                                                        </Typography>
                                                                </MetadataOverlay>
                                                        </MediaTileButton>
                                                );
                                        })}
                                </MediaGrid>
                                {hasMore && (
                                        <Box display="flex" justifyContent="center">
                                                <Button
                                                        variant="outlined"
                                                        onClick={loadMore}
                                                        disabled={isLoadingMore}
                                                        startIcon={isLoadingMore ? <CircularProgress size={18} /> : undefined}>
                                                        {isLoadingMore ? "Loading" : "Load more"}
                                                </Button>
                                        </Box>
                                )}
                        </Stack>
                );
        };

        const content = (
                <Stack height="100%">
                        <Toolbar>
                                <Typography variant="h6" flexGrow={1} noWrap>
                                        Media
                                </Typography>
                                <IconButton edge="end" onClick={onClose} aria-label="Close media drawer">
                                        <Close />
                                </IconButton>
                        </Toolbar>
                        <Divider />
                        <Box flexGrow={1} minHeight={0} padding={2} overflow="auto">
                                {renderBody()}
                        </Box>
                </Stack>
        );

        return (<>
                {fullScreen ? (
                        <Dialog fullScreen open={open} onClose={onClose}>
                                {content}
                        </Dialog>
                ) : (
                        <Drawer
                                anchor="right"
                                open={open}
                                onClose={onClose}
                                ModalProps={{keepMounted: true}}
                                PaperProps={{sx: {width: {xs: "100%", sm: 360, lg: 420}}}}>
                                {content}
                        </Drawer>
                )}
                <AttachmentLightbox
                        open={previewState !== null}
                        title={previewState?.title ?? ""}
                        imageURL={previewState?.url}
                        onClose={closePreview}
                        onDownload={previewState ? handleDownloadPreview : undefined}
                />
        </>);
}

function extractMediaTiles(items: ConversationItem[]): MediaTile[] {
        const tiles: MediaTile[] = [];
        for(const item of items) {
                if(item.itemType !== ConversationItemType.Message) continue;
                const message = item as MessageItem;
                message.attachments.forEach((attachment, index) => {
                        const key = attachment.guid ?? `${message.guid ?? "local"}:${index}`;
                        tiles.push({
                                key,
                                attachment,
                                messageDate: message.date,
                                messageGuid: message.guid,
                                messageServerID: message.serverID
                        });
                });
        }
        tiles.sort((a, b) => b.messageDate.getTime() - a.messageDate.getTime());
        return tiles;
}

function mergeMetadata(base: ThreadFetchResult["metadata"], incoming: ThreadFetchResult["metadata"]): ThreadFetchResult["metadata"] {
        if(!incoming) return base;
        let oldest = base?.oldestServerID;
        let newest = base?.newestServerID;
        let changed = false;
        if(incoming.oldestServerID !== undefined && (oldest === undefined || incoming.oldestServerID < oldest)) {
                oldest = incoming.oldestServerID;
                changed = true;
        }
        if(incoming.newestServerID !== undefined && (newest === undefined || incoming.newestServerID > newest)) {
                newest = incoming.newestServerID;
                changed = true;
        }
        if(!changed) return base;
        return {oldestServerID: oldest, newestServerID: newest};
}

function computeMetadataFromItems(items: ConversationItem[]): ThreadFetchResult["metadata"] {
        let oldest: number | undefined;
        let newest: number | undefined;
        for(const item of items) {
                if(item.itemType !== ConversationItemType.Message) continue;
                const message = item as MessageItem;
                if(message.serverID === undefined) continue;
                if(oldest === undefined || message.serverID < oldest) oldest = message.serverID;
                if(newest === undefined || message.serverID > newest) newest = message.serverID;
        }
        if(oldest === undefined && newest === undefined) return undefined;
        return {oldestServerID: oldest, newestServerID: newest};
}
