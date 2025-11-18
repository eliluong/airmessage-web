import React, {useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import styles from "./Sidebar.module.css";
import AirMessageLogo from "../../logo/AirMessageLogo";
import {
        Box,
        CircularProgress,
        Collapse,
        IconButton,
        InputAdornment,
        List,
        ListItemButton,
        ListItemText,
        Menu,
        MenuItem,
        Stack,
        TextField,
        ToggleButton,
        ToggleButtonGroup,
        Toolbar,
        Typography
} from "@mui/material";
import {alpha, useTheme} from "@mui/material/styles";
import ListConversation from "./ListConversation";
import {Conversation} from "../../../data/blocks";
import ConnectionBanner from "./ConnectionBanner";
import {ConnectionErrorCode, FaceTimeLinkErrorCode} from "../../../data/stateCodes";
import {
        AddRounded,
        ArrowBackRounded,
        ClearRounded,
        Contacts,
        MoreVertRounded,
        SearchRounded,
        Update,
        VideoCallOutlined
} from "@mui/icons-material";
import ChangelogDialog from "../dialog/ChangelogDialog";
import FeedbackDialog from "shared/components/messaging/dialog/FeedbackDialog";
import SignOutDialog from "shared/components/messaging/dialog/SignOutDialog";
import RemoteUpdateDialog from "shared/components/messaging/dialog/RemoteUpdateDialog";
import ServerUpdateData from "shared/data/serverUpdateData";
import * as ConnectionManager from "../../../connection/connectionManager";
import {RemoteUpdateListener} from "../../../connection/connectionManager";
import SidebarBanner from "shared/components/messaging/master/SidebarBanner";
import {SnackbarContext} from "shared/components/control/SnackbarProvider";
import FaceTimeLinkDialog from "shared/components/messaging/dialog/FaceTimeLinkDialog";
import {useIsFaceTimeSupported, useNonNullableCacheState} from "shared/util/hookUtils";
import ConversationSkeleton from "shared/components/skeleton/ConversationSkeleton";
import {TransitionGroup} from "react-transition-group";
import SettingsDialog from "shared/components/messaging/dialog/SettingsDialog";
import {MessageSearchHit} from "shared/data/blocks";
import useMessageSearch from "shared/state/useMessageSearch";
import {searchCache} from "shared/state/searchCache";
import {getMemberTitleSync, mimeTypeToPreview} from "shared/util/conversationUtils";
import {PeopleContext} from "shared/state/peopleState";
import {usePersonName} from "shared/util/hookUtils";
import {useLiveLastUpdateStatusTime} from "../../../util/dateUtils";

type SearchTimeRange = "all" | "week" | "month" | "year";

const SEARCH_TIME_RANGES: ReadonlyArray<{value: SearchTimeRange; label: string; offsetMs?: number}> = [
        {value: "week", label: "7 days", offsetMs: 7 * 24 * 60 * 60 * 1000},
        {value: "month", label: "30 days", offsetMs: 30 * 24 * 60 * 60 * 1000},
        {value: "year", label: "365 days", offsetMs: 365 * 24 * 60 * 60 * 1000},
        {value: "all", label: "All time"},
];

export const DEFAULT_SEARCH_TIME_RANGE: SearchTimeRange = "month";

export default function Sidebar(props: {
        conversations: Conversation[] | undefined;
        hasMoreConversations: boolean;
        onLoadMoreConversations: () => Promise<Conversation[]>;
        selectedConversation?: number;
        onConversationSelected: (id: number) => void;
        onCreateSelected: () => void;
        onSearchResultSelected: (result: MessageSearchHit) => void;
        errorBanner?: ConnectionErrorCode;
        needsPeoplePermission?: boolean;
        onRequestPeoplePermission?: () => void;
}) {
        const displaySnackbar = useContext(SnackbarContext);
        const peopleState = useContext(PeopleContext);
	
	//The anchor element for the overflow menu
	const [overflowMenu, setOverflowMenu] = useState<HTMLElement | null>(null);
	useEffect(() => {
		//Don't hold dangling references to DOM elements
		return () => {
			setOverflowMenu(null);
		};
	}, [setOverflowMenu]);
	
	const openOverflowMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
		setOverflowMenu(event.currentTarget);
	}, [setOverflowMenu]);
	const closeOverflowMenu = useCallback(() => {
		setOverflowMenu(null);
	}, [setOverflowMenu]);
	
        const [isSettingsDialog, showSettingsDialog, hideSettingsDialog] = useSidebarDialog(closeOverflowMenu);
        const [isChangelogDialog, showChangelogDialog, hideChangelogDialog] = useSidebarDialog(closeOverflowMenu);
        const [isFeedbackDialog, showFeedbackDialog, hideFeedbackDialog] = useSidebarDialog(closeOverflowMenu);
        const [isSignOutDialog, showSignOutDialog, hideSignOutDialog] = useSidebarDialog(closeOverflowMenu);
        const [isRemoteUpdateDialog, showRemoteUpdateDialog, hideRemoteUpdateDialog] = useSidebarDialog();
        const [faceTimeLinkDialog, setFaceTimeLinkDialog] = useState<string | undefined>(undefined);
        const [isLoadingMore, setIsLoadingMore] = useState(false);
        const scrollThrottleRef = useRef<number | undefined>(undefined);
        const isLoadingMoreRef = useRef(false);
        const listRef = useRef<HTMLUListElement | null>(null);
	
	//Keep track of remote updates
	const [remoteUpdate, remoteUpdateCache, setRemoteUpdate] = useNonNullableCacheState<ServerUpdateData | undefined>(
		undefined,
		{id: 0, notes: "", protocolRequirement: [], remoteInstallable: false, version: ""}
	);
	useEffect(() => {
		const listener: RemoteUpdateListener = {onUpdate: setRemoteUpdate};
		ConnectionManager.addRemoteUpdateListener(listener);
		
		return () => {
			ConnectionManager.removeRemoteUpdateListener(listener);
			setRemoteUpdate(undefined);
		};
	}, [setRemoteUpdate]);
	
	//Keep track of whether FaceTime is supported
	const isFaceTimeSupported = useIsFaceTimeSupported();
	
        const [isFaceTimeLinkLoading, setFaceTimeLinkLoading] = useState(false);
        const [isSearchMode, setIsSearchMode] = useState(false);
        const [contactQuery, setContactQuery] = useState("");
        const {
                results: searchResults,
                loading: searchLoading,
                error: searchError,
                cacheKey: searchCacheKey,
                search
        } = useMessageSearch({debounceMs: 350});
        const [searchQuery, setSearchQuery] = useState("");
        const [searchTimeRange, setSearchTimeRange] = useState<SearchTimeRange>(DEFAULT_SEARCH_TIME_RANGE);
        const searchOptions = useMemo(() => {
                const trimmed = searchQuery.trim();
                if(trimmed.length === 0) {
                        return undefined;
                }

                const {startDate, endDate} = resolveSearchRange(searchTimeRange);
                return {
                        term: trimmed,
                        startDate,
                        endDate,
                        offset: undefined,
                        limit: undefined,
                };
        }, [searchQuery, searchTimeRange]);
        const createFaceTimeLink = useCallback(async () => {
                setFaceTimeLinkLoading(true);

                try {
                        const link = await ConnectionManager.requestFaceTimeLink();
			
			//Prefer web share, fall back to displaying a dialog
			if(navigator.share) {
				await navigator.share({text: link});
			} else {
				setFaceTimeLinkDialog(link);
			}
		} catch(error) {
			if(error === FaceTimeLinkErrorCode.Network) {
				displaySnackbar({message: "Failed to get FaceTime link: no connection to server"});
			} else if(error === FaceTimeLinkErrorCode.External) {
				displaySnackbar({message: "Failed to get FaceTime link: an external error occurred"});
			}
		} finally {
			setFaceTimeLinkLoading(false);
                }
        }, [setFaceTimeLinkLoading, displaySnackbar]);

        const triggerLoadMore = useCallback((target: HTMLElement) => {
                if(!props.hasMoreConversations) return;
                if(isLoadingMoreRef.current) return;
                const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
                if(distanceToBottom > 200) return;
                isLoadingMoreRef.current = true;
                setIsLoadingMore(true);
                props.onLoadMoreConversations()
                        .catch(() => undefined)
                        .finally(() => {
                                isLoadingMoreRef.current = false;
                                setIsLoadingMore(false);
                        });
        }, [props.hasMoreConversations, props.onLoadMoreConversations]);

        const conversationTitleMap = useMemo(() => {
                const map = new Map<string, string>();
                props.conversations?.forEach((conversation) => {
                        if(conversation.localOnly || conversation.guid === undefined) return;

                        const title = conversation.name && conversation.name.length > 0
                                ? conversation.name
                                : getMemberTitleSync(conversation.members, peopleState);
                        map.set(conversation.guid, title);
                });
                return map;
        }, [props.conversations, peopleState]);

        const trimmedContactQuery = contactQuery.trim();
        const isContactSearchActive = trimmedContactQuery.length > 0;
        const contactSearchResults = useMemo(() => {
                if(props.conversations === undefined) return [] as Conversation[];
                if(trimmedContactQuery.length === 0) return props.conversations;

                const lowerQuery = trimmedContactQuery.toLowerCase();
                return props.conversations.filter((conversation) => {
                        const title = conversation.name && conversation.name.length > 0
                                ? conversation.name
                                : getMemberTitleSync(conversation.members, peopleState);

                        if(title?.toLowerCase().includes(lowerQuery)) {
                                return true;
                        }

                        if(conversation.members !== undefined) {
                                return conversation.members.some((memberAddress) =>
                                        memberAddress.toLowerCase().includes(lowerQuery)
                                );
                        }

                        return false;
                });
        }, [peopleState, props.conversations, trimmedContactQuery]);

        const handleToggleSearchMode = useCallback(() => {
                setIsSearchMode((current) => !current);
        }, []);

        const handleCloseSearchMode = useCallback(() => {
                setIsSearchMode(false);
        }, []);

        useEffect(() => {
                if(!isSearchMode) return;
                search(searchOptions);
        }, [isSearchMode, searchOptions, search]);

        useEffect(() => {
                if(!isSearchMode) return;

                const handleKeyDown = (event: KeyboardEvent) => {
                        if(event.key === "Escape") {
                                event.preventDefault();
                                handleCloseSearchMode();
                        }
                };

                window.addEventListener("keydown", handleKeyDown);
                return () => window.removeEventListener("keydown", handleKeyDown);
        }, [handleCloseSearchMode, isSearchMode]);

        const handleSearchResultSelected = useCallback((hit: MessageSearchHit) => {
                props.onSearchResultSelected(hit);
        }, [props]);

        const clearScrollThrottle = useCallback(() => {
                if(scrollThrottleRef.current !== undefined) {
                        window.clearTimeout(scrollThrottleRef.current);
                        scrollThrottleRef.current = undefined;
                }
        }, []);

        const handleScroll = useCallback((event: React.UIEvent<HTMLUListElement>) => {
                if(isContactSearchActive) return;
                const target = event.currentTarget;
                if(scrollThrottleRef.current !== undefined) return;
                scrollThrottleRef.current = window.setTimeout(() => {
                        scrollThrottleRef.current = undefined;
                        triggerLoadMore(target);
                }, 150);
        }, [isContactSearchActive, triggerLoadMore]);

        useEffect(() => () => clearScrollThrottle(), [clearScrollThrottle]);

        useEffect(() => {
                if(!props.hasMoreConversations) {
                        isLoadingMoreRef.current = false;
                        setIsLoadingMore(false);
                }
        }, [props.hasMoreConversations]);
	
	return (
		<Stack height="100%">
                        <SettingsDialog isOpen={isSettingsDialog} onDismiss={hideSettingsDialog} />
                        <ChangelogDialog isOpen={isChangelogDialog} onDismiss={hideChangelogDialog} />
			<FeedbackDialog isOpen={isFeedbackDialog} onDismiss={hideFeedbackDialog} />
			<SignOutDialog isOpen={isSignOutDialog} onDismiss={hideSignOutDialog} />
                        <RemoteUpdateDialog isOpen={isRemoteUpdateDialog} onDismiss={hideRemoteUpdateDialog} update={remoteUpdateCache} />
			<FaceTimeLinkDialog isOpen={faceTimeLinkDialog !== undefined} onDismiss={() => setFaceTimeLinkDialog(undefined)} link={faceTimeLinkDialog ?? ""} />
			
			<Toolbar>
				<AirMessageLogo />
				
				<Box sx={{flexGrow: 1}} />
				
                                <Box sx={{display: "flex"}}>
                                        {isFaceTimeSupported && (
                                                <IconButton
                                                        size="large"
                                                        onClick={createFaceTimeLink}
                                                        disabled={isFaceTimeLinkLoading}>
                                                        <VideoCallOutlined />
                                                </IconButton>
                                        )}

                                        <IconButton
                                                size="large"
                                                color={isSearchMode ? "primary" : "default"}
                                                onClick={handleToggleSearchMode}
                                                disabled={props.conversations === undefined && !isSearchMode}>
                                                <SearchRounded />
                                        </IconButton>

                                        <IconButton
                                                size="large"
                                                onClick={props.onCreateSelected}
                                                disabled={props.conversations === undefined}>
                                                <AddRounded />
					</IconButton>
					
                                        <IconButton
                                                aria-haspopup="true"
                                                size="large"
                                                edge="end"
                                                onClick={openOverflowMenu}
                                                disabled={props.conversations === undefined}>
                                                <MoreVertRounded data-testid="MoreVertRoundedIcon" />
                                        </IconButton>

                                        <Menu
						anchorEl={overflowMenu}
						anchorOrigin={{
							vertical: "top",
							horizontal: "right",
						}}
						keepMounted
						transformOrigin={{
							vertical: "top",
							horizontal: "right",
						}}
						open={!!overflowMenu}
						onClose={closeOverflowMenu}>
                                                <MenuItem onClick={showSettingsDialog}>Settings</MenuItem>
                                                <MenuItem onClick={showChangelogDialog}>What&apos;s new</MenuItem>
						<MenuItem onClick={showFeedbackDialog}>Help and feedback</MenuItem>
						<MenuItem onClick={showSignOutDialog}>Sign out</MenuItem>
					</Menu>
				</Box>
			</Toolbar>
			
			{props.errorBanner !== undefined && <ConnectionBanner error={props.errorBanner} /> }
			
			{props.needsPeoplePermission && (
				<SidebarBanner
					icon={<Contacts />}
					message="Allow access to contacts to show names and pictures"
					button="Enable"
					onClickButton={props.onRequestPeoplePermission} />
			)}
			
			{remoteUpdate !== undefined && (
				<SidebarBanner
					icon={<Update />}
					message="A server update is available"
					button="Details"
					onClickButton={showRemoteUpdateDialog} />
			)}
			
                        {isSearchMode ? (
                                <SearchPanel
                                        conversationTitleMap={conversationTitleMap}
                                        query={searchQuery}
                                        onQueryChange={setSearchQuery}
                                        timeRange={searchTimeRange}
                                        onTimeRangeChange={setSearchTimeRange}
                                        loading={searchLoading}
                                        results={searchResults}
                                        error={searchError}
                                        onResultSelected={handleSearchResultSelected}
                                        onCancel={handleCloseSearchMode}
                                        cacheKey={searchCacheKey} />
                        ) : props.conversations !== undefined ? (
                                <Box display="flex" flexDirection="column" flex={1} minHeight={0}>
                                        <Box
                                                component="header"
                                                sx={{
                                                        paddingX: 1.5,
                                                        paddingY: 1,
                                                        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                                                }}>
                                                <TextField
                                                        value={contactQuery}
                                                        onChange={(event) => setContactQuery(event.target.value)}
                                                        placeholder="Find people by name or number"
                                                        size="small"
                                                        fullWidth
                                                        InputProps={{
                                                                startAdornment: (
                                                                        <InputAdornment position="start">
                                                                                <SearchRounded fontSize="small" />
                                                                        </InputAdornment>
                                                                ),
                                                                endAdornment: contactQuery.length > 0 ? (
                                                                        <InputAdornment position="end">
                                                                                <IconButton
                                                                                        aria-label="Clear contact search"
                                                                                        size="small"
                                                                                        onClick={() => setContactQuery("")}
                                                                                >
                                                                                        <ClearRounded fontSize="small" />
                                                                                </IconButton>
                                                                        </InputAdornment>
                                                                ) : undefined,
                                                        }}
                                                />
                                        </Box>
                                        <List
                                                className={styles.sidebarList}
                                                onScroll={isContactSearchActive ? undefined : handleScroll}
                                                ref={listRef}>
                                                <TransitionGroup>
                                                        {(isContactSearchActive ? contactSearchResults : props.conversations).map((conversation) => (
                                                                <Collapse key={conversation.localID}>
                                                                        <ListConversation
                                                                                conversation={conversation}
                                                                                selected={conversation.localID === props.selectedConversation}
                                                                                highlighted={conversation.unreadMessages}
                                                                                onSelected={() => props.onConversationSelected(conversation.localID)} />
                                                                </Collapse>
                                                        ))}
                                                </TransitionGroup>
                                                {isContactSearchActive && contactSearchResults.length === 0 && (
                                                        <Box textAlign="center" py={2} px={2}>
                                                                <Typography variant="body2" color="textSecondary">
                                                                        No conversations found
                                                                </Typography>
                                                        </Box>
                                                )}
                                                {!isContactSearchActive && props.hasMoreConversations && (
                                                        <Box display="flex" justifyContent="center" py={1}>
                                                                {isLoadingMore ? (
                                                                        <CircularProgress size={20} />
                                                                ) : (
                                                                        <Typography variant="caption" color="textSecondary">
                                                                                Scroll to load more conversations
                                                                        </Typography>
                                                                )}
                                                        </Box>
                                                )}
                                        </List>
                                </Box>
                        ) : (
                                <Box className={styles.sidebarListLoading}>
                                        {[...Array(16)].map((element, index) => <ConversationSkeleton key={`skeleton-${index}`} />)}
                                </Box>
                        )}
		</Stack>
	);
}

interface SearchPanelProps {
        conversationTitleMap: Map<string, string>;
        query: string;
        onQueryChange: (value: string) => void;
        timeRange: SearchTimeRange;
        onTimeRangeChange: (value: SearchTimeRange) => void;
        loading: boolean;
        results: MessageSearchHit[];
        error: Error | undefined;
        onResultSelected: (result: MessageSearchHit) => void;
        onCancel: VoidFunction;
        cacheKey?: string;
}

function SearchPanel(props: SearchPanelProps) {
        const {
                conversationTitleMap,
                query,
                onQueryChange,
                timeRange,
                onTimeRangeChange,
                loading,
                results,
                error,
                onResultSelected,
                onCancel,
                cacheKey
        } = props;

        const inputRef = useRef<HTMLInputElement | null>(null);
        const listRef = useRef<HTMLUListElement | null>(null);
        const scrollPersistHandleRef = useRef<number | undefined>(undefined);

        const handleTimeRangeChange = useCallback((event: React.MouseEvent<HTMLElement>, value: SearchTimeRange | null) => {
                if(value !== null) {
                        onTimeRangeChange(value);
                }
        }, [onTimeRangeChange]);

        const handleCancel = useCallback(() => {
                onCancel();
        }, [onCancel]);

        const hasQuery = query.trim().length > 0;

        const handleClearQuery = useCallback(() => {
                onQueryChange("");
                inputRef.current?.focus();
        }, [onQueryChange]);

        useLayoutEffect(() => {
                if(!cacheKey) return;
                const viewState = searchCache.getViewState(cacheKey);
                const scrollTop = viewState?.scrollTop ?? 0;
                if(listRef.current) {
                        listRef.current.scrollTo({top: scrollTop});
                }
        }, [cacheKey]);

        const handleListScroll = useCallback((event: React.UIEvent<HTMLUListElement>) => {
                if(!cacheKey) return;
                const target = event.currentTarget;
                if(scrollPersistHandleRef.current !== undefined) return;
                scrollPersistHandleRef.current = window.setTimeout(() => {
                        scrollPersistHandleRef.current = undefined;
                        searchCache.updateViewState(cacheKey, {scrollTop: target.scrollTop});
                }, 100);
        }, [cacheKey]);

        useEffect(() => {
                return () => {
                        if(scrollPersistHandleRef.current !== undefined) {
                                window.clearTimeout(scrollPersistHandleRef.current);
                                scrollPersistHandleRef.current = undefined;
                        }
                        if(cacheKey) {
                                searchCache.updateViewState(cacheKey, {scrollTop: listRef.current?.scrollTop ?? 0});
                        }
                        listRef.current = null;
                };
        }, [cacheKey]);

        const statusBoxSx = {
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                paddingX: 1.5,
                paddingY: 3
        } as const;

        return (
                <Box display="flex" flexDirection="column" flex={1} minHeight={0}>
                        <Box
                                component="header"
                                sx={{
                                        paddingX: 1.5,
                                        paddingY: 1,
                                        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 1
                                }}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                        <IconButton aria-label="Back to conversations" onClick={handleCancel}>
                                                <ArrowBackRounded />
                                        </IconButton>
                                        <TextField
                                                inputRef={inputRef}
                                                value={query}
                                                onChange={(event) => onQueryChange(event.target.value)}
                                                placeholder="Search messages"
                                                fullWidth
                                                autoFocus
                                                size="small"
                                                InputProps={{
                                                        startAdornment: (
                                                                <InputAdornment position="start">
                                                                        <SearchRounded fontSize="small" />
                                                                </InputAdornment>
                                                        ),
                                                        endAdornment: hasQuery ? (
                                                                <InputAdornment position="end">
                                                                        <IconButton
                                                                                aria-label="Clear search"
                                                                                size="small"
                                                                                onClick={handleClearQuery}>
                                                                                <ClearRounded fontSize="small" />
                                                                        </IconButton>
                                                                </InputAdornment>
                                                        ) : undefined
                                                }}
                                        />
                                </Stack>

                                <ToggleButtonGroup
                                        value={timeRange}
                                        exclusive
                                        onChange={handleTimeRangeChange}
                                        size="small"
                                        fullWidth>
                                        {SEARCH_TIME_RANGES.map(({value, label}) => (
                                                <ToggleButton key={value} value={value}>
                                                        {label}
                                                </ToggleButton>
                                        ))}
                                </ToggleButtonGroup>
                        </Box>

                        <Box flex={1} minHeight={0} display="flex" flexDirection="column">
                                {loading ? (
                                        <Box sx={statusBoxSx}>
                                                <CircularProgress />
                                        </Box>
                                ) : error ? (
                                        <Box sx={statusBoxSx}>
                                                <Typography color="error">{error.message}</Typography>
                                        </Box>
                                ) : !hasQuery ? (
                                        <Box sx={statusBoxSx}>
                                                <Typography color="textSecondary">Type to search your messages</Typography>
                                        </Box>
                                ) : results.length === 0 ? (
                                        <Box sx={statusBoxSx}>
                                                <Typography color="textSecondary">No results found</Typography>
                                        </Box>
                                ) : (
                                        <List
                                                className={styles.sidebarList}
                                                disablePadding
                                                sx={{paddingTop: 0}}
                                                ref={listRef}
                                                onScroll={handleListScroll}>
                                                {results.map((hit) => {
                                                        const key = String(hit.originalROWID);
                                                        const titleKey = hit.conversationGuid ?? hit.message.chatGuid;
                                                        const title = (titleKey ? conversationTitleMap.get(titleKey) : undefined)
                                                                ?? conversationTitleMap.get(hit.message.chatGuid ?? "")
                                                                ?? conversationTitleMap.get(hit.conversationGuid ?? "")
                                                                ?? titleKey
                                                                ?? "Unknown conversation";
                                                        return (
                                                                <SearchResultItem
                                                                        key={key}
                                                                        hit={hit}
                                                                        title={title}
                                                                        query={query}
                                                                        onSelected={onResultSelected} />
                                                        );
                                                })}
                                        </List>
                                )}
                        </Box>
                </Box>
        );
}

function SearchResultItem(props: {hit: MessageSearchHit; title: string; query: string; onSelected: (result: MessageSearchHit) => void}) {
        const {hit, title, query, onSelected} = props;
        const senderName = usePersonName(hit.message.sender);
        const theme = useTheme();

	const snippet = useMemo(() => {
		if(hit.message.text && hit.message.text.trim().length > 0) {
			return hit.message.text;
		}

		if(hit.message.attachments.length > 0) {
			if(hit.message.attachments.length === 1) {
				return mimeTypeToPreview(hit.message.attachments[0].type);
			}

			return `${hit.message.attachments.length} attachments`;
		}

		return "(No preview)";
	}, [hit.message.attachments, hit.message.text]);

        const secondary = senderName ? `${senderName}: ${snippet}` : snippet;

        const secondarySegments = useMemo(() => {
                const normalizedQuery = query.trim().toLowerCase();
                if(normalizedQuery.length === 0) {
                        return [secondary];
                }

                const escapedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                if(escapedQuery.length === 0) {
                        return [secondary];
                }

                const regex = new RegExp(escapedQuery, "gi");
                const segments: React.ReactNode[] = [];
                const text = secondary ?? "";
                let lastIndex = 0;
                let match: RegExpExecArray | null;
                let matchIndex = 0;

                while((match = regex.exec(text)) !== null) {
                        if(match.index > lastIndex) {
                                segments.push(text.slice(lastIndex, match.index));
                        }

                        const matchedText = text.slice(match.index, regex.lastIndex);
                        segments.push(
                                <Box
                                        component="mark"
                                        key={`match-${matchIndex}`}
                                        sx={{
                                                backgroundColor: alpha(
                                                        theme.palette.primary.main,
                                                        theme.palette.mode === "dark" ? 0.4 : 0.25
                                                ),
                                                borderRadius: 0.5,
                                                px: 0.25,
                                                color: theme.palette.text.primary,
                                                fontWeight: 600
                                        }}>
                                        {matchedText}
                                </Box>
                        );
                        matchIndex += 1;
                        lastIndex = regex.lastIndex;
                }

                if(lastIndex < text.length) {
                        segments.push(text.slice(lastIndex));
                }

                if(segments.length === 0) {
                        return [secondary];
                }

                return segments;
        }, [query, secondary, theme]);

        const timestamp = useLiveLastUpdateStatusTime(hit.message.date);

        return (
                <ListItemButton
                        alignItems="flex-start"
                        onClick={() => onSelected(hit)}
                        sx={{
                                marginX: 1,
                                marginY: 0.5,
                                borderRadius: 1,
                                paddingX: 1.5,
                                paddingY: 0.5,
                                "&&:hover": {
                                        backgroundColor: "action.hover"
                                }
                        }}>
                        <ListItemText
                                primary={(
                                        <Stack direction="row" alignItems="flex-start" spacing={1}>
                                                <Typography
                                                        variant="body1"
                                                        sx={{
                                                                flexGrow: 1,
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                                whiteSpace: "nowrap",
                                                                fontSize: "1rem",
                                                                fontWeight: 500
                                                        }}>
                                                        {title}
                                                </Typography>
                                                <Typography
                                                        variant="body2"
                                                        color="textSecondary"
                                                        sx={{
                                                                flexShrink: 0,
                                                                paddingTop: 0.5
                                                        }}>
                                                        {timestamp}
                                                </Typography>
                                        </Stack>
                                )}
				secondary={(
                                        <Typography
                                                variant="body2"
                                                color="textSecondary"
                                                        sx={{
                                                        display: "-webkit-box",
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: "vertical",
                                                        overflow: "hidden"
                                                }}>
                                                {secondarySegments}
                                        </Typography>
                                )}
                        />
                </ListItemButton>
        );
}

function resolveSearchRange(range: SearchTimeRange): {startDate?: Date; endDate?: Date} {
        const now = new Date();
        const option = SEARCH_TIME_RANGES.find((item) => item.value === range);

        if(option?.offsetMs !== undefined) {
                return {startDate: new Date(now.getTime() - option.offsetMs)};
        }

        return {};
}


/**
 * Creates a toggleable state for a sidebar dialog
 * @param openCallback A callback invoked when the menu is opened
 */
function useSidebarDialog(openCallback?: VoidFunction): [boolean, VoidFunction, VoidFunction] {
	const [showDialog, setShowDialog] = useState(false);

	const openDialog = useCallback(() => {
		openCallback?.();
		setShowDialog(true);
	}, [openCallback, setShowDialog]);
	const closeDialog = useCallback(() => {
		setShowDialog(false);
	}, [setShowDialog]);
	
	useEffect(() => {
		//Close the dialog on unmount
		return () => {
			setShowDialog(false);
		};
	}, [setShowDialog]);
	
	return [showDialog, openDialog, closeDialog];
}
