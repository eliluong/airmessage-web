import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {MessageItem} from "shared/data/blocks";
import {
	Avatar,
        Button,
        CircularProgress,
        Dialog,
        DialogActions,
        DialogContent,
        DialogContentText,
        DialogTitle,
        Fade,
        IconButton,
        Palette,
        Stack,
        StackProps,
        styled,
        Typography
} from "@mui/material";
import {formatMessageHoverTime, getDeliveryStatusTime, getTimeDivider} from "shared/util/dateUtils";
import {ErrorRounded} from "@mui/icons-material";
import {colorFromContact} from "shared/util/avatarUtils";
import {usePersonData} from "shared/util/hookUtils";
import {MessageStatusCode} from "shared/data/stateCodes";
import MessageBubbleText from "shared/components/messaging/thread/item/bubble/MessageBubbleText";
import {appleServiceAppleMessage} from "shared/data/appleConstants";
import FileDownloadResult, {FileDisplayResult} from "shared/data/fileDownloadResult";
import {downloadBlob} from "shared/util/browserUtils";
import {getBubbleSpacing, MessageFlow, MessagePartFlow} from "shared/util/messageFlow";
import MessageBubbleImage from "shared/components/messaging/thread/item/bubble/MessageBubbleImage";
import MessageBubbleDownloadable from "shared/components/messaging/thread/item/bubble/MessageBubbleDownloadable";
import {messageErrorToDisplay} from "shared/util/languageUtils";
import {groupArray} from "shared/util/arrayUtils";
import {isAttachmentPreviewable} from "shared/util/conversationUtils";

enum MessageDialog {
	Error,
	RawError
}

const MessageStack = styled(Stack, {
	shouldForwardProp: (prop) => prop !== "amLinked"
})<{amLinked: boolean} & StackProps>(({amLinked, theme}) => ({
        width: "100%",
        position: "relative",
        marginTop: theme.spacing(getBubbleSpacing(amLinked))
}));

type TimestampPosition = {
        top: number;
        left: number;
        anchor: "left" | "right";
};

export default function Message(props: {
	message: MessageItem;
	isGroupChat: boolean;
	service: string;
	flow: MessageFlow;
	showStatus?: boolean;
}) {
	const [dialogState, setDialogState] = useState<MessageDialog | undefined>(undefined);
	const closeDialog = useCallback(() => setDialogState(undefined), [setDialogState]);
	const openDialogError = useCallback(() => setDialogState(MessageDialog.Error), [setDialogState]);
	const openDialogRawError = useCallback(() => setDialogState(MessageDialog.RawError), [setDialogState]);
	
	/**
	 * Copies the message error detail to the clipboard,
	 * and closes the dialog
	 */
	const copyRawErrorAndClose = useCallback(async () => {
		const errorDetail = props.message.error?.detail;
		if(errorDetail !== undefined) {
			await navigator.clipboard.writeText(errorDetail);
		}
		closeDialog();
	}, [props.message, closeDialog]);
	
        const [attachmentDataMap, setAttachmentDataMap] = useState<Map<number, FileDownloadResult>>(new Map());
        const [showTimestamp, setShowTimestamp] = useState(false);
        const [timestampPosition, setTimestampPosition] = useState<TimestampPosition | undefined>(undefined);
        const hoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
        const messageStackRef = useRef<HTMLDivElement | null>(null);
        const messageBubbleRef = useRef<HTMLDivElement | null>(null);
        const formattedTimestamp = useMemo(() => formatMessageHoverTime(props.message.date), [props.message.date]);
	
	//Compute the message information
	const isOutgoing = props.message.sender === undefined;
	const displayAvatar = !isOutgoing && !props.flow.anchorTop;
	const displaySender = props.isGroupChat && displayAvatar;
	const isUnconfirmed = props.message.status === MessageStatusCode.Unconfirmed;
	
        const handleAttachmentData = useCallback((attachmentIndex: number, shouldDownload: boolean, result: FileDownloadResult) => {
                if(shouldDownload) {
			//Download the file
			const attachment = props.message.attachments[attachmentIndex];
			downloadBlob(
				result.data,
				result.downloadType ?? attachment.type,
				result.downloadName ?? attachment.name
			);
		} else {
			//Update the data map
			setAttachmentDataMap((attachmentDataMap) => new Map(attachmentDataMap).set(attachmentIndex, result));
		}
	}, [props.message.attachments, setAttachmentDataMap]);
	
	/**
	 * Saves the data of an attachment to the user's downloads
	 */
	const downloadAttachmentFile = useCallback((attachmentIndex: number, data: Blob) => {
		const attachment = props.message.attachments[attachmentIndex];
		downloadBlob(data, attachment.type, attachment.name);
	}, [props.message.attachments]);
	
	/**
	 * Computes the file data to display to the user
	 */
        const getComputedFileData = useCallback((attachmentIndex: number): FileDisplayResult => {
                const attachment = props.message.attachments[attachmentIndex];
                const downloadData = attachmentDataMap.get(attachmentIndex);

                return {
                        data: downloadData?.data ?? attachment.data,
			name: downloadData?.downloadName ?? attachment.name,
			type: downloadData?.downloadType ?? attachment.type
		};
	}, [props.message.attachments, attachmentDataMap]);
	
	//Load the message sender person
	const personData = usePersonData(props.message.sender);
	
	//Get the color palette to use for the message
	let colorPalette: keyof Palette;
	if(isOutgoing) {
		if(props.service === appleServiceAppleMessage) colorPalette = "messageOutgoing";
		else colorPalette = "messageOutgoingTextMessage";
	} else {
		colorPalette = "messageIncoming";
	}
	
	//Split the modifiers for each message part
	const stickerGroups = useMemo(() =>
			groupArray(props.message.stickers, (sticker) => sticker.messageIndex),
		[props.message.stickers]);
        const tapbackGroups = useMemo(() =>
                        groupArray(props.message.tapbacks, (tapback) => tapback.messageIndex),
                [props.message.tapbacks]);

        const clearHoverTimeout = useCallback(() => {
                if(hoverTimeout.current !== undefined) {
                        clearTimeout(hoverTimeout.current);
                        hoverTimeout.current = undefined;
                }
        }, []);

        const updateTimestampPosition = useCallback(() => {
                const container = messageStackRef.current;
                const bubble = messageBubbleRef.current;

                if(container === null || bubble === null) {
                        return;
                }

                const containerRect = container.getBoundingClientRect();
                const bubbleRect = bubble.getBoundingClientRect();
                const verticalCenter = bubbleRect.top - containerRect.top + bubbleRect.height / 2;
                const offset = 8;

                if(isOutgoing) {
                        const left = bubbleRect.left - containerRect.left - offset;
                        setTimestampPosition({
                                top: verticalCenter,
                                left,
                                anchor: "left"
                        });
                } else {
                        const left = bubbleRect.right - containerRect.left + offset;
                        setTimestampPosition({
                                top: verticalCenter,
                                left,
                                anchor: "right"
                        });
                }
        }, [isOutgoing]);

        const handleMouseEnter = useCallback(() => {
                clearHoverTimeout();
                setTimestampPosition(undefined);
                hoverTimeout.current = setTimeout(() => {
                        hoverTimeout.current = undefined;
                        updateTimestampPosition();
                        setShowTimestamp(true);
                }, 600);
        }, [clearHoverTimeout, updateTimestampPosition]);

        const handleMouseLeave = useCallback(() => {
                clearHoverTimeout();
                setShowTimestamp(false);
        }, [clearHoverTimeout]);

        useEffect(() => {
                if(!showTimestamp) {
                        return;
                }

                const handleResize = () => {
                        updateTimestampPosition();
                };

                updateTimestampPosition();
                window.addEventListener("resize", handleResize);

                return () => {
                        window.removeEventListener("resize", handleResize);
                };
        }, [showTimestamp, updateTimestampPosition]);

        useEffect(() => {
                return () => {
                        clearHoverTimeout();
                };
        }, [clearHoverTimeout]);
	
	//Build message parts
	const messagePartsArray: React.ReactNode[] = [];
	if(props.message.text) {
		messagePartsArray.push(
			<MessageBubbleText
				key="messagetext"
				flow={{
					isOutgoing: isOutgoing,
					isUnconfirmed: isUnconfirmed,
					color: `${colorPalette}.contrastText`,
					backgroundColor: `${colorPalette}.main`,
					anchorTop: props.flow.anchorTop,
					anchorBottom: props.flow.anchorBottom || props.message.attachments.length > 0
				}}
				text={props.message.text}
				stickers={stickerGroups.get(0) ?? []}
				tapbacks={tapbackGroups.get(0) ?? []} />
		);
	}
	messagePartsArray.push(
		props.message.attachments.map((attachment, i, attachmentArray) => {
			const componentKey = attachment.guid ?? attachment.localID;
			const messagePartIndex = props.message.text ? i + 1 : i;
			const stickers = stickerGroups.get(messagePartIndex) ?? [];
			const tapbacks = tapbackGroups.get(messagePartIndex) ?? [];
			
			//Get the attachment's data
			const attachmentData = getComputedFileData(i);
			
			const flow: MessagePartFlow = {
				isOutgoing: isOutgoing,
				isUnconfirmed: isUnconfirmed,
				color: `${colorPalette}.contrastText`,
				backgroundColor: `${colorPalette}.main`,
				anchorTop: !!props.message.text || props.flow.anchorTop || i > 0,
				anchorBottom: props.flow.anchorBottom || i + 1 < attachmentArray.length
			};
			
			if(attachmentData.data !== undefined && isAttachmentPreviewable(attachmentData.type)) {
				return (
					<MessageBubbleImage
						key={componentKey}
						flow={flow}
						data={attachmentData.data}
						name={attachmentData.name}
						type={attachmentData.type}
						stickers={stickers}
						tapbacks={tapbacks} />
				);
			} else {
				return (
					<MessageBubbleDownloadable
						key={componentKey}
						flow={flow}
						data={attachmentData.data}
						name={attachmentData.name}
						type={attachmentData.type}
						size={attachment.size}
						guid={attachment.guid!}
						onDataAvailable={(data) => handleAttachmentData(i, !isAttachmentPreviewable(attachmentData.type), data)}
						onDataClicked={(data) => downloadAttachmentFile(i, data)}
						stickers={stickers}
						tapbacks={tapbacks} />
				);
			}
		})
	);
	
	return (<>
                <MessageStack
                        direction="column"
                        amLinked={props.flow.anchorTop}
                        ref={messageStackRef}
                        data-message-guid={props.message.guid}
                        data-message-server-id={props.message.serverID !== undefined ? props.message.serverID.toString() : undefined}>
			{/* Time divider */}
			{props.flow.showDivider && (
				<Typography
					paddingTop={6}
					paddingBottom={1}
					paddingX={1}
					textAlign="center"
					variant="body2"
					color="textSecondary">
					{getTimeDivider(props.message.date)}
				</Typography>
			)}
			
			{/* Sender name */}
			{displaySender && (
				<Typography
					marginBottom={0.2}
					marginLeft="40px"
					variant="caption"
					color="textSecondary">
					{personData?.name ?? props.message.sender}
				</Typography>
			)}
			
			{/* Horizontal message split */}
			<Stack
				direction="row"
				alignItems="flex-start"
				flexShrink={0}>
				{/* User avatar */}
				<Avatar
					sx={{
						width: 32,
						height: 32,
						fontSize: 14
					}}
					style={{
						backgroundColor: colorFromContact(props.message.sender ?? ""),
						visibility: displayAvatar ? undefined : "hidden"
					}}
					src={personData?.avatar} />
				
				{/* Message parts */}
                                <Stack
                                        sx={{marginLeft: 1}}
                                        flexGrow={1}
                                        direction="column"
                                        alignItems={isOutgoing ? "end" : "start"}>
                                        <Stack
                                                ref={messageBubbleRef}
                                                onMouseEnter={handleMouseEnter}
                                                onMouseLeave={handleMouseLeave}
                                                gap={getBubbleSpacing(false)}
                                                direction="column"
                                                alignItems={isOutgoing ? "end" : "start"}
                                                sx={{
                                                        display: "inline-flex",
                                                        maxWidth: "100%"
                                                }}>
                                                {messagePartsArray}
                                        </Stack>
                                </Stack>
				
				{/* Progress spinner */}
				{props.message.progress !== undefined
					&& props.message.error === undefined
					&& (
						<CircularProgress
							sx={{
								marginX: 1,
								marginY: "1px"
							}}
							size={24}
							variant={props.message.progress === -1 ? "indeterminate" : "determinate"}
							value={props.message.progress} />
					)}
				
				{/* Error indicator	*/}
				{props.message.error !== undefined && (
					<IconButton
						sx={{margin: "1px"}}
						color="error"
						size="small"
						onClick={openDialogError}>
						<ErrorRounded />
					</IconButton>
				)}
			</Stack>
			
			{/* Message status */}
			{props.showStatus && (
				<Typography
					marginTop={0.5}
					textAlign="end"
					variant="caption"
					color="textSecondary">
					{getStatusString(props.message)}
				</Typography>
			)}
                        {timestampPosition !== undefined && (
                                <Fade in={showTimestamp} timeout={{enter: 150, exit: 100}} mountOnEnter unmountOnExit>
                                        <Typography
                                                variant="caption"
                                                color="textSecondary"
                                                sx={{
                                                        position: "absolute",
                                                        pointerEvents: "none",
                                                        opacity: 0.72,
                                                        zIndex: 1,
                                                        top: timestampPosition.top,
                                                        left: timestampPosition.left,
                                                        transform: timestampPosition.anchor === "left"
                                                                ? "translate(-100%, -50%)"
                                                                : "translate(0, -50%)",
                                                        whiteSpace: "nowrap"
                                                }}
                                        >
                                                {formattedTimestamp}
                                        </Typography>
                                </Fade>
                        )}
                </MessageStack>
		
		{/* Message error dialog */}
		<Dialog open={dialogState === MessageDialog.Error} onClose={closeDialog}>
			<DialogTitle>Your message could not be sent</DialogTitle>
			{props.message.error !== undefined && <React.Fragment>
				<DialogContent>
					<DialogContentText>
						{messageErrorToDisplay(props.message.error!.code)}
					</DialogContentText>
				</DialogContent>
				
				<DialogActions>
					{props.message.error!.detail !== undefined && (
						<Button onClick={openDialogRawError} color="primary">
							Error details
						</Button>
					)}
					<Button onClick={closeDialog} color="primary" autoFocus>
						Dismiss
					</Button>
				</DialogActions>
			</React.Fragment>}
		</Dialog>
		
		{/* Message raw error dialog */}
		<Dialog open={dialogState === MessageDialog.RawError} onClose={closeDialog}>
			<DialogTitle>Error details</DialogTitle>
			{props.message.error !== undefined && <React.Fragment>
				<DialogContent>
					<DialogContentText fontFamily="monospace">
						{props.message.error.detail!}
					</DialogContentText>
				</DialogContent>
				
				<DialogActions>
					<Button onClick={copyRawErrorAndClose} color="primary">
						Copy to clipboard
					</Button>
					<Button onClick={closeDialog} color="primary" autoFocus>
						Dismiss
					</Button>
				</DialogActions>
			</React.Fragment>}
		</Dialog>
	</>);
}

/**
 * Gets a human-readable status string for the given message item,
 * or undefined if no status string should be displayed
 */
function getStatusString(message: MessageItem): string | undefined {
        if(message.status === MessageStatusCode.Delivered) {
                return "Delivered";
        } else if(message.status === MessageStatusCode.Read) {
                return message.statusDate ? "Read • " + getDeliveryStatusTime(message.statusDate) : "Read";
        } else {
                return undefined;
        }
}