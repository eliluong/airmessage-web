import React, {useCallback, useContext, useEffect, useRef, useState} from "react";
import styles from "./Sidebar.module.css";
import AirMessageLogo from "../../logo/AirMessageLogo";
import {Box, CircularProgress, Collapse, IconButton, List, Menu, MenuItem, Stack, Toolbar, Typography} from "@mui/material";
import ListConversation from "./ListConversation";
import {Conversation} from "../../../data/blocks";
import ConnectionBanner from "./ConnectionBanner";
import {ConnectionErrorCode, FaceTimeLinkErrorCode} from "../../../data/stateCodes";
import {AddRounded, Contacts, MoreVertRounded, Update, VideoCallOutlined} from "@mui/icons-material";
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

export default function Sidebar(props: {
        conversations: Conversation[] | undefined;
        hasMoreConversations: boolean;
        onLoadMoreConversations: () => Promise<Conversation[]>;
        selectedConversation?: number;
        onConversationSelected: (id: number) => void;
        onCreateSelected: () => void;
        errorBanner?: ConnectionErrorCode;
        needsPeoplePermission?: boolean;
        onRequestPeoplePermission?: () => void;
}) {
	const displaySnackbar = useContext(SnackbarContext);
	
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

        const clearScrollThrottle = useCallback(() => {
                if(scrollThrottleRef.current !== undefined) {
                        window.clearTimeout(scrollThrottleRef.current);
                        scrollThrottleRef.current = undefined;
                }
        }, []);

        const handleScroll = useCallback((event: React.UIEvent<HTMLUListElement>) => {
                const target = event.currentTarget;
                if(scrollThrottleRef.current !== undefined) return;
                scrollThrottleRef.current = window.setTimeout(() => {
                        scrollThrottleRef.current = undefined;
                        triggerLoadMore(target);
                }, 150);
        }, [triggerLoadMore]);

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
			
                        {props.conversations !== undefined ? (
                                <List className={styles.sidebarList} onScroll={handleScroll} ref={listRef}>
                                        <TransitionGroup>
                                                {props.conversations.map((conversation) => (
                                                        <Collapse key={conversation.localID}>
                                                                <ListConversation
                                                                        conversation={conversation}
									selected={conversation.localID === props.selectedConversation}
									highlighted={conversation.unreadMessages}
									onSelected={() => props.onConversationSelected(conversation.localID)} />
							</Collapse>
                                                ))}
                                        </TransitionGroup>
                                        {props.hasMoreConversations && (
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
                        ) : (
                                <Box className={styles.sidebarListLoading}>
                                        {[...Array(16)].map((element, index) => <ConversationSkeleton key={`skeleton-${index}`} />)}
                                </Box>
			)}
		</Stack>
	);
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