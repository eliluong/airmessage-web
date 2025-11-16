import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {Conversation, ConversationItem, MessageItem} from "shared/data/blocks";
import {ConversationItemType} from "shared/data/stateCodes";
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
        styled,
        Avatar,
        Tooltip,
        Tabs,
        Tab,
        List,
        ListItem,
        ListItemAvatar,
        ListItemText,
        Link as MuiLink
} from "@mui/material";
import {Close, InsertDriveFileOutlined} from "@mui/icons-material";
import {useTheme} from "@mui/material/styles";
import * as ConnectionManager from "shared/connection/connectionManager";
import {formatFileSize} from "shared/util/languageUtils";
import {formatAddress, isAttachmentPreviewable} from "shared/util/conversationUtils";
import {downloadBlob} from "shared/util/browserUtils";
import {SnackbarContext} from "shared/components/control/SnackbarProvider";
import FileDownloadResult from "shared/data/fileDownloadResult";
import AttachmentLightbox from "./item/AttachmentLightbox";
import useConversationMedia from "shared/state/useConversationMedia";
import useAttachmentThumbnails from "shared/state/useAttachmentThumbnails";
import {ConversationAttachmentEntry} from "shared/data/attachment";
import {blurhashToDataURL} from "shared/util/blurhash";
import {PeopleContext} from "shared/state/peopleState";
import {colorFromContact} from "shared/util/avatarUtils";
import useConversationLinks from "shared/hooks/useConversationLinks";

interface ConversationMediaDrawerProps {
        conversation: Conversation;
        open: boolean;
        onClose: () => void;
        messages: ConversationItem[];
        enableLinkPreviews?: boolean;
}

const DEFAULT_LINK_INITIAL_COUNT = 20;
const DEFAULT_LINK_PAGE_SIZE = 10;
const MAX_URL_DISPLAY_LENGTH = 70;

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

const SenderBadge = styled("div")(({theme}) => ({
        position: "absolute",
        top: theme.spacing(1),
        right: theme.spacing(1),
        pointerEvents: "none",
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        [`& > *`]: {
                pointerEvents: "auto"
        }
}));

interface SenderDisplayData {
        readonly displayName: string;
        readonly initials: string;
        readonly color: string;
        readonly avatarUrl?: string;
        readonly tooltip: string;
}

function sanitizePhoneNumber(address: string): string {
        return address.replace(/\D+/g, "");
}

function deriveInitialsFromName(name: string): string {
        const trimmed = name.trim();
        if(trimmed.length === 0) return "??";

        const parts = trimmed.split(/\s+/).filter(Boolean);

        if(parts.length >= 2) {
                const firstPart = parts[0];
                const lastPart = parts[parts.length - 1];
                const firstInitial = Array.from(firstPart)[0];
                const lastInitial = Array.from(lastPart)[0];
                if(firstInitial && lastInitial) {
                        return `${firstInitial}${lastInitial}`.toUpperCase();
                }
        }

        const compactCharacters = Array.from(trimmed).filter((char) => char.trim().length > 0);
        if(compactCharacters.length >= 2) {
                return `${compactCharacters[0]}${compactCharacters[compactCharacters.length - 1]}`.toUpperCase();
        }
        if(compactCharacters.length === 1) {
                return `${compactCharacters[0]}${compactCharacters[0]}`.toUpperCase();
        }
        return "??";
}

function deriveInitialsFromAddress(address: string): string {
        const digits = sanitizePhoneNumber(address);
        if(digits.length >= 2) {
                return digits.slice(-2);
        }
        if(digits.length === 1) {
                return digits;
        }
        const alphanumeric = address.replace(/[^A-Za-z0-9]+/g, "");
        if(alphanumeric.length >= 2) {
                return `${alphanumeric[0]}${alphanumeric[alphanumeric.length - 1]}`.toUpperCase();
        }
        if(alphanumeric.length === 1) {
                return alphanumeric.toUpperCase();
        }
        return "??";
}

function truncateUrl(url: string, maxLength: number): string {
        if(url.length <= maxLength) return url;
        return `${url.slice(0, maxLength - 1)}…`;
}

export default function ConversationMediaDrawer({
        conversation,
        open,
        onClose,
        messages,
        enableLinkPreviews = false
}: ConversationMediaDrawerProps) {
        const theme = useTheme();
        const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
        const snackbar = useContext(SnackbarContext);
        const peopleState = useContext(PeopleContext);
        const {getPerson} = peopleState;
        const [activeTab, setActiveTab] = useState<"photos" | "links">("photos");

        const conversationGuid = conversation.localOnly ? undefined : conversation.guid;
        const conversationKey = useMemo(() => conversationGuid ?? `local:${conversation.localID}`, [conversationGuid, conversation.localID]);
        const photosTabId = "conversation-media-tab-photos";
        const linksTabId = "conversation-media-tab-links";
        const photosPanelId = "conversation-media-panel-photos";
        const linksPanelId = "conversation-media-panel-links";
        const {
                items: mediaItems,
                isLoading,
                isLoadingMore,
                error: loadError,
                hasMore,
                loadMore,
                reload
        } = useConversationMedia(conversationGuid, open);
        const [previewState, setPreviewState] = useState<{
                guid: string;
                title: string;
                url: string;
                data: FileDownloadResult;
                senderLabel?: string;
        } | null>(null);
        const [previewLoadingGuid, setPreviewLoadingGuid] = useState<string | undefined>(undefined);
        const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
        const {thumbnails: thumbnailMap, loadThumbnails, cancelActive: cancelThumbnailDownloads} = useAttachmentThumbnails(open);
        const [blurhashPlaceholders, setBlurhashPlaceholders] = useState<Map<string, string>>(new Map());
        const scrollContainerRef = useRef<HTMLDivElement | null>(null);
        const linkSentinelRef = useRef<HTMLDivElement | null>(null);

        const downloadCache = useRef<Map<string, FileDownloadResult>>(new Map());
        const mountedRef = useRef(true);
        const previewUrlsRef = useRef<Map<string, string>>(new Map());
        const seenThumbnailFailuresRef = useRef<Set<string>>(new Set());

        const messageItems = useMemo(
                () => messages.filter((item): item is MessageItem => item.itemType === ConversationItemType.Message),
                [messages]
        );

        const {
                links: conversationLinks,
                totalCount: totalLinkCount,
                hasMore: hasMoreLinks,
                isPaginating: isPaginatingLinks,
                loadMore: loadMoreLinks
        } = useConversationLinks(conversationKey, messages, {
                initialCount: DEFAULT_LINK_INITIAL_COUNT,
                pageSize: DEFAULT_LINK_PAGE_SIZE,
                enabled: open
        });

        const clearPreviewUrls = useCallback(() => {
                previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
                previewUrlsRef.current = new Map();
                setPreviewUrls(new Map());
        }, []);
        useEffect(() => {
                mountedRef.current = true;
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

        const senderDisplayMap = useMemo(() => {
                const map = new Map<string, SenderDisplayData>();
                for(const item of mediaItems) {
                        const sender = item.sender ?? "me";
                        const isMe = sender === "me";
                        const person = isMe ? undefined : getPerson(sender);
                        const personName = person?.name?.trim();
                        const displayName = isMe ? "Me" : personName && personName.length > 0 ? personName : formatAddress(sender);
                        const initials = isMe
                                ? "Me"
                                : personName && personName.length > 0
                                        ? deriveInitialsFromName(personName)
                                        : deriveInitialsFromAddress(sender);
                        const avatarUrl = person?.avatar;
                        const color = colorFromContact(sender);
                        map.set(item.key, {
                                displayName,
                                initials,
                                color,
                                avatarUrl,
                                tooltip: displayName
                        });
                }
                return map;
        }, [getPerson, mediaItems]);

        const linkSenderDisplayMap = useMemo(() => {
                const map = new Map<string, SenderDisplayData>();
                for(const message of messageItems) {
                        const sender = message.sender ?? "me";
                        if(map.has(sender)) continue;
                        const isMe = sender === "me";
                        const person = isMe ? undefined : getPerson(sender);
                        const personName = person?.name?.trim();
                        const displayName = isMe ? "Me" : personName && personName.length > 0 ? personName : formatAddress(sender);
                        const initials = isMe
                                ? "Me"
                                : personName && personName.length > 0
                                        ? deriveInitialsFromName(personName)
                                        : deriveInitialsFromAddress(sender);
                        const avatarUrl = person?.avatar;
                        const color = colorFromContact(sender);
                        map.set(sender, {
                                displayName,
                                initials,
                                color,
                                avatarUrl,
                                tooltip: displayName
                        });
                }
                return map;
        }, [getPerson, messageItems]);

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
                                const senderInfo = senderDisplayMap.get(item.key);
                                setPreviewState({
                                        guid,
                                        title: item.name,
                                        url: existingUrl,
                                        data: cached,
                                        senderLabel: senderInfo?.displayName
                                });
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
                        const senderInfo = senderDisplayMap.get(item.key);
                        setPreviewState({
                                guid,
                                title: item.name,
                                url,
                                data: download,
                                senderLabel: senderInfo?.displayName
                        });
                } catch(error) {
                        console.warn("Failed to fetch attachment preview", error);
                        if(!mountedRef.current) return;
                        snackbar?.({message: "Couldn\'t open this attachment."});
                } finally {
                        if(mountedRef.current) {
                                setPreviewLoadingGuid(undefined);
                        }
                }
        }, [previewUrls, senderDisplayMap, snackbar]);

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

        useEffect(() => {
                if(activeTab !== "links") return;
                if(!hasMoreLinks) return;
                const sentinel = linkSentinelRef.current;
                const root = scrollContainerRef.current;
                if(!sentinel || !root) return;

                const observer = new IntersectionObserver(
                        (entries) => {
                                if(entries.some((entry) => entry.isIntersecting)) {
                                        loadMoreLinks();
                                }
                        },
                        {root, rootMargin: "160px"}
                );

                observer.observe(sentinel);
                return () => observer.disconnect();
        }, [activeTab, hasMoreLinks, loadMoreLinks]);

        const renderPhotosPanel = () => {
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
                                                const senderInfo = senderDisplayMap.get(item.key);
                                                return (
                                                        <MediaTileButton
                                                                key={item.key}
                                                                onClick={() => handleTileClick(item)}
                                                                disabled={isLoadingPreview}>
                                                                {senderInfo && (
                                                                        <SenderBadge>
                                                                                <Tooltip
                                                                                        title={senderInfo.tooltip}
                                                                                        placement="left"
                                                                                        componentsProps={{popper: {sx: {pointerEvents: "none"}}}}>
                                                                                        <Avatar
                                                                                                src={senderInfo.avatarUrl}
                                                                                                alt=""
                                                                                                sx={{
                                                                                                        width: 32,
                                                                                                        height: 32,
                                                                                                        fontSize: senderInfo.initials.length > 2 ? 12 : 14,
                                                                                                        fontWeight: 600,
                                                                                                        bgcolor: senderInfo.avatarUrl ? undefined : senderInfo.color,
                                                                                                        color: senderInfo.avatarUrl ? undefined : theme.palette.getContrastText(senderInfo.color)
                                                                                                }}
                                                                                        >
                                                                                                {!senderInfo.avatarUrl ? senderInfo.initials : null}
                                                                                        </Avatar>
                                                                                </Tooltip>
                                                                        </SenderBadge>
                                                                )}
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

        const renderLinksPanel = () => {
                if(conversationLinks.length === 0) {
                        return (
                                <Stack height="100%" alignItems="center" justifyContent="center" spacing={1}>
                                        <Typography color="textSecondary" textAlign="center">
                                                No links found in this conversation yet.
                                        </Typography>
                                </Stack>
                        );
                }

                return (
                        <Stack spacing={1.5} paddingBottom={1}>
                                {!enableLinkPreviews && (
                                        <Typography variant="caption" color="textSecondary">
                                                Link previews are disabled for now.
                                        </Typography>
                                )}
                                <List disablePadding>
                                        {conversationLinks.map((link) => {
                                                const senderInfo = linkSenderDisplayMap.get(link.sender ?? "me");
                                                const displayUrl = truncateUrl(
                                                        link.normalizedUrl.replace(/^https?:\/\//, ""),
                                                        MAX_URL_DISPLAY_LENGTH
                                                );
                                                const key = `${link.normalizedUrl}-${link.messageGuid ?? link.messageLocalID ?? link.messageServerID ?? link.date.getTime()}`;
                                                return (
                                                        <ListItem key={key} alignItems="flex-start" disableGutters sx={{py: 1}}>
                                                                <ListItemAvatar>
                                                                        <Avatar
                                                                                src={senderInfo?.avatarUrl}
                                                                                alt=""
                                                                                sx={{
                                                                                        width: 40,
                                                                                        height: 40,
                                                                                        fontSize: senderInfo && senderInfo.initials.length > 2 ? 12 : 14,
                                                                                        fontWeight: 600,
                                                                                        bgcolor: senderInfo?.avatarUrl ? undefined : senderInfo?.color,
                                                                                        color: senderInfo?.avatarUrl
                                                                                                ? undefined
                                                                                                : senderInfo
                                                                                                        ? theme.palette.getContrastText(senderInfo.color)
                                                                                                        : undefined
                                                                                }}
                                                                        >
                                                                                {!senderInfo?.avatarUrl ? senderInfo?.initials ?? "?" : null}
                                                                        </Avatar>
                                                                </ListItemAvatar>
                                                                <ListItemText
                                                                        primary={
                                                                                <Stack spacing={0.25}>
                                                                                        <Typography variant="subtitle1" noWrap>
                                                                                                {link.domain}
                                                                                        </Typography>
                                                                                        <MuiLink
                                                                                                href={link.normalizedUrl}
                                                                                                target="_blank"
                                                                                                rel="noopener noreferrer"
                                                                                                underline="hover"
                                                                                                variant="body2"
                                                                                                sx={{wordBreak: "break-all"}}>
                                                                                                {displayUrl}
                                                                                        </MuiLink>
                                                                                </Stack>
                                                                        }
                                                                        secondary={
                                                                                <Typography variant="body2" color="textSecondary">
                                                                                        {senderInfo?.displayName ?? "Unknown sender"} • {dateFormatter.format(link.date)}
                                                                                </Typography>
                                                                        }
                                                                />
                                                        </ListItem>
                                                );
                                        })}
                                </List>
                                <Box ref={linkSentinelRef} height={1} />
                                {hasMoreLinks && (
                                        <Box display="flex" justifyContent="center">
                                                <Button
                                                        variant="outlined"
                                                        onClick={loadMoreLinks}
                                                        disabled={isPaginatingLinks}
                                                        startIcon={isPaginatingLinks ? <CircularProgress size={18} /> : undefined}>
                                                        {isPaginatingLinks ? "Loading" : "Load more"}
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
                        <Tabs
                                value={activeTab}
                                onChange={(event, value: "photos" | "links") => setActiveTab(value)}
                                aria-label="Conversation media tabs"
                                variant="fullWidth">
                                <Tab label="Photos" value="photos" id={photosTabId} aria-controls={photosPanelId} />
                                <Tab
                                        label={`Links (${totalLinkCount})`}
                                        value="links"
                                        id={linksTabId}
                                        aria-controls={linksPanelId}
                                />
                        </Tabs>
                        <Divider />
                        <Box ref={scrollContainerRef} flexGrow={1} minHeight={0} padding={2} overflow="auto">
                                <Box
                                        role="tabpanel"
                                        hidden={activeTab !== "photos"}
                                        id={photosPanelId}
                                        aria-labelledby={photosTabId}
                                        height="100%">
                                        {activeTab === "photos" ? renderPhotosPanel() : null}
                                </Box>
                                <Box
                                        role="tabpanel"
                                        hidden={activeTab !== "links"}
                                        id={linksPanelId}
                                        aria-labelledby={linksTabId}
                                        height="100%">
                                        {activeTab === "links" ? renderLinksPanel() : null}
                                </Box>
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
