import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {Conversation} from "shared/data/blocks";
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
import {formatFileSize} from "shared/util/languageUtils";
import {isAttachmentPreviewable} from "shared/util/conversationUtils";
import {downloadBlob} from "shared/util/browserUtils";
import {SnackbarContext} from "shared/components/control/SnackbarProvider";
import FileDownloadResult from "shared/data/fileDownloadResult";
import AttachmentLightbox from "./item/AttachmentLightbox";
import useConversationMedia from "shared/state/useConversationMedia";
import useAttachmentThumbnails from "shared/state/useAttachmentThumbnails";
import {ConversationAttachmentEntry} from "shared/data/attachment";
import {blurhashToDataURL} from "shared/util/blurhash";

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

        const conversationGuid = conversation.localOnly ? undefined : conversation.guid;
        const conversationKey = useMemo(() => conversationGuid ?? `local:${conversation.localID}`, [conversationGuid, conversation.localID]);
        const {
                items: mediaItems,
                isLoading,
                isLoadingMore,
                error: loadError,
                hasMore,
                loadMore,
                reload
        } = useConversationMedia(conversationGuid, open);
        const [previewState, setPreviewState] = useState<{guid: string; title: string; url: string; data: FileDownloadResult;} | null>(null);
        const [previewLoadingGuid, setPreviewLoadingGuid] = useState<string | undefined>(undefined);
        const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
        const {thumbnails: thumbnailMap, loadThumbnails, cancelActive: cancelThumbnailDownloads} = useAttachmentThumbnails(open);
        const [blurhashPlaceholders, setBlurhashPlaceholders] = useState<Map<string, string>>(new Map());

        const downloadCache = useRef<Map<string, FileDownloadResult>>(new Map());
        const mountedRef = useRef(true);
        const previewUrlsRef = useRef<Map<string, string>>(new Map());
        const seenThumbnailFailuresRef = useRef<Set<string>>(new Set());

        const clearPreviewUrls = useCallback(() => {
                previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
                previewUrlsRef.current = new Map();
                setPreviewUrls(new Map());
        }, []);
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

        useEffect(() => {
                clearPreviewUrls();
                setPreviewState(null);
                setPreviewLoadingGuid(undefined);
                downloadCache.current.clear();
                cancelThumbnailDownloads();
                setBlurhashPlaceholders(new Map());
                seenThumbnailFailuresRef.current.clear();
        }, [conversationKey, cancelThumbnailDownloads, clearPreviewUrls]);

        const handleRetry = useCallback(() => {
                void reload();
        }, [reload]);

        const handleLoadMore = useCallback(async () => {
                try {
                        await loadMore();
                } catch(error) {
                        console.warn("Failed to load additional media", error);
                        if(!mountedRef.current) return;
                        snackbar?.({message: "Failed to load more media."});
                }
        }, [loadMore, snackbar]);

        const handleTileClick = useCallback(async (item: ConversationAttachmentEntry) => {
                const guid = item.guid;
                if(!guid || !isAttachmentPreviewable(item.mimeType)) {
                        snackbar?.({message: "Preview isn\'t available for this attachment."});
                        return;
                }

                const cached = downloadCache.current.get(guid);
                if(cached) {
                        const existingUrl = previewUrls.get(guid);
                        if(existingUrl) {
                                setPreviewState({guid, title: item.name, url: existingUrl, data: cached});
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
                        setPreviewState({guid, title: item.name, url, data: download});
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

        const attachmentMap = useMemo(() => {
                const map = new Map<string, ConversationAttachmentEntry>();
                for(const item of mediaItems) {
                        if(item.guid) map.set(item.guid, item);
                }
                return map;
        }, [mediaItems]);

        useEffect(() => {
                if(!open) {
                        seenThumbnailFailuresRef.current.clear();
                        return;
                }

                const abortController = new AbortController();
                const guids: string[] = [];
                for(const item of mediaItems) {
                        if(item.guid && isAttachmentPreviewable(item.mimeType)) {
                                guids.push(item.guid);
                        }
                }
                if(guids.length > 0) {
                        loadThumbnails(guids, abortController.signal);
                }
                return () => abortController.abort();
        }, [mediaItems, loadThumbnails, open]);

        useEffect(() => {
                if(!open) return;
                if(typeof window === "undefined") return;
                setBlurhashPlaceholders((previous) => {
                        let updated = false;
                        const next = new Map(previous);
                        for(const item of mediaItems) {
                                const guid = item.guid;
                                if(!guid || !item.blurhash || next.has(guid)) continue;
                                const dataUrl = blurhashToDataURL(item.blurhash, 64, 64);
                                if(dataUrl) {
                                        next.set(guid, dataUrl);
                                        updated = true;
                                }
                        }
                        return updated ? next : previous;
                });
        }, [mediaItems, open]);

        useEffect(() => {
                if(!open) return;
                const seen = seenThumbnailFailuresRef.current;
                thumbnailMap.forEach((entry, guid) => {
                        if(entry.status === "error" && entry.error && !seen.has(guid)) {
                                const attachment = attachmentMap.get(guid);
                                const message = attachment ? `Failed to load preview for ${attachment.name}.` : entry.error;
                                snackbar?.({message});
                                seen.add(guid);
                        } else if(entry.status === "loaded") {
                                seen.delete(guid);
                        }
                });
        }, [attachmentMap, open, snackbar, thumbnailMap]);

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
                                                const guid = item.guid;
                                                const previewUrl = guid ? previewUrls.get(guid) : undefined;
                                                const thumbnail = guid ? thumbnailMap.get(guid) : undefined;
                                                const fallbackUrl = guid ? blurhashPlaceholders.get(guid) : undefined;
                                                const tileImage = previewUrl ?? thumbnail?.url ?? fallbackUrl;
                                                const isLoadingPreview = guid !== undefined && previewLoadingGuid === guid;
                                                const showLoadingOverlay = isLoadingPreview || (!!guid && thumbnail?.status === "loading" && !previewUrl);
                                                return (
                                                        <MediaTileButton
                                                                key={item.key}
                                                                onClick={() => handleTileClick(item)}
                                                                disabled={isLoadingPreview}>
                                                                {tileImage ? (
                                                                        <MediaTileImage src={tileImage} alt="" />
                                                                ) : (
                                                                        <MediaTilePlaceholder>
                                                                                <InsertDriveFileOutlined fontSize="large" />
                                                                        </MediaTilePlaceholder>
                                                                )}
                                                                {showLoadingOverlay && (
                                                                        <LoadingOverlay>
                                                                                <CircularProgress size={32} />
                                                                        </LoadingOverlay>
                                                                )}
                                                                <MetadataOverlay>
                                                                        <Typography variant="subtitle2" noWrap>
                                                                                {item.name}
                                                                        </Typography>
                                                                        <Typography variant="caption" noWrap>
                                                                                {formatFileSize(item.size)} • {dateFormatter.format(item.timestamp)}
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
                                                        onClick={handleLoadMore}
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
