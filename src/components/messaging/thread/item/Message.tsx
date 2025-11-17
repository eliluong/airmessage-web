import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {MessageItem} from "shared/data/blocks";
import {
Avatar,
Box,
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
import type {MessageItemWithEdits} from "shared/components/messaging/thread/hooks/useEditedMessageGroups";

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
message: MessageItemWithEdits;
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
const [showEditHistory, setShowEditHistory] = useState(false);
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
                const bubbleContainer = messageBubbleRef.current;

                if(container === null || bubbleContainer === null) {
                        return;
                }

                const bubbleChildren = Array.from(bubbleContainer.children) as HTMLElement[];
                const meaningfulRects = bubbleChildren
                        .map((element) => element.getBoundingClientRect())
                        .filter((rect) => rect.width > 0 && rect.height > 0);

                if(meaningfulRects.length === 0) {
                        return;
                }

                const containerRect = container.getBoundingClientRect();
                let minTop = meaningfulRects[0].top;
                let maxBottom = meaningfulRects[0].bottom;
                let minLeft = meaningfulRects[0].left;
                let maxRight = meaningfulRects[0].right;

                for(let i = 1; i < meaningfulRects.length; i += 1) {
                        const rect = meaningfulRects[i];
                        minTop = Math.min(minTop, rect.top);
                        maxBottom = Math.max(maxBottom, rect.bottom);
                        minLeft = Math.min(minLeft, rect.left);
                        maxRight = Math.max(maxRight, rect.right);
                }

                const verticalCenter = (minTop + maxBottom) / 2 - containerRect.top;
                const offset = 8;

                if(isOutgoing) {
                        const left = minLeft - containerRect.left - offset;
                        setTimestampPosition({
                                top: verticalCenter,
                                left,
                                anchor: "left"
                        });
                } else {
                        const left = maxRight - containerRect.left + offset;
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
const displayedText = props.message.uiEdited?.latestText ?? props.message.text;
const messagePartsArray: React.ReactNode[] = [];
if(displayedText) {
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
text={displayedText}
stickers={stickerGroups.get(0) ?? []}
tapbacks={tapbackGroups.get(0) ?? []} />
);
}
messagePartsArray.push(
props.message.attachments.map((attachment, i, attachmentArray) => {
const componentKey = attachment.guid ?? attachment.localID;
const messagePartIndex = displayedText ? i + 1 : i;
const stickers = stickerGroups.get(messagePartIndex) ?? [];
const tapbacks = tapbackGroups.get(messagePartIndex) ?? [];

//Get the attachment's data
const attachmentData = getComputedFileData(i);

const flow: MessagePartFlow = {
isOutgoing: isOutgoing,
isUnconfirmed: isUnconfirmed,
color: `${colorPalette}.contrastText`,
backgroundColor: `${colorPalette}.main`,
anchorTop: !!displayedText || props.flow.anchorTop || i > 0,
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
	
const historyEntries = props.message.uiEdited?.history ?? [];
const hasHistoryEntries = historyEntries.length > 0;
const showHistory = showEditHistory && hasHistoryEntries;

useEffect(() => {
setShowEditHistory(false);
}, [props.message.guid, props.message.localID, historyEntries.length]);

useEffect(() => {
if(!hasHistoryEntries) {
setShowEditHistory(false);
}
}, [hasHistoryEntries]);

const toggleHistoryVisibility = useCallback(() => {
if(!hasHistoryEntries) return;
setShowEditHistory((value) => !value);
}, [hasHistoryEntries]);

const handleEditedLabelKeyDown = useCallback((event: React.KeyboardEvent<HTMLSpanElement>) => {
if(!hasHistoryEntries) return;
if(event.key === "Enter" || event.key === " ") {
event.preventDefault();
setShowEditHistory((value) => !value);
}
}, [hasHistoryEntries]);

const historyFlow: MessagePartFlow = {
isOutgoing,
isUnconfirmed,
color: `${colorPalette}.contrastText`,
backgroundColor: `${colorPalette}.main`,
anchorTop: false,
anchorBottom: false
};

const historyNodes: React.ReactNode[] = [];
if(showHistory) {
historyEntries.forEach((entry, index) => {
historyNodes.push(
<Box key={`history-${entry.sourceGuid ?? index}`} sx={{opacity: 0.7, width: "100%"}}>
<MessageBubbleText
flow={historyFlow}
text={entry.text}
stickers={[]}
tapbacks={[]} />
</Box>
);
});
}

const bubbleNodes = historyNodes.length > 0 ? historyNodes.concat(messagePartsArray) : messagePartsArray;

const statusText = props.showStatus ? getStatusString(props.message) : undefined;
const showEditedLabel = props.message.uiEdited !== undefined;
const showFootnoteRow = showEditedLabel || !!statusText;
const editedLabelTitle = hasHistoryEntries
? (showEditHistory ? "Hide edit history" : "Show edit history")
: undefined;

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
                                        alignItems={isOutgoing ? "end" : "start"}
                                        spacing={showFootnoteRow ? 0.5 : 0}>
                                        <Stack
                                                ref={messageBubbleRef}
                                                onMouseEnter={handleMouseEnter}
                                                onMouseLeave={handleMouseLeave}
                                                gap={getBubbleSpacing(false)}
                                                direction="column"
                                                alignItems={isOutgoing ? "end" : "start"}
                                                sx={{
                                                        width: "100%"
                                                }}>
                                                {bubbleNodes}
                                        </Stack>

                                        {/* Message status / edit chip */}
                                        {showFootnoteRow && (
                                                <Stack
                                                        direction="row"
                                                        spacing={1}
                                                        justifyContent={isOutgoing ? "flex-end" : "flex-start"}
                                                        alignItems="center"
                                                        sx={{width: "100%"}}>
                                                        {showEditedLabel && (
                                                                <Typography
                                                                        variant="caption"
                                                                        component={hasHistoryEntries ? "button" : "span"}
                                                                        type={hasHistoryEntries ? "button" : undefined}
                                                                        tabIndex={hasHistoryEntries ? 0 : undefined}
                                                                        aria-expanded={hasHistoryEntries ? showEditHistory : undefined}
                                                                        onClick={hasHistoryEntries ? toggleHistoryVisibility : undefined}
                                                                        onKeyDown={hasHistoryEntries ? handleEditedLabelKeyDown : undefined}
                                                                        title={editedLabelTitle}
                                                                        sx={{
                                                                                color: "#448AFF",
                                                                                fontWeight: 700,
                                                                                cursor: hasHistoryEntries ? "pointer" : "default",
                                                                                textDecoration: showEditHistory ? "underline" : "none",
                                                                                outline: "none",
                                                                                backgroundColor: "transparent",
                                                                                border: 0,
                                                                                padding: 0,
                                                                                alignSelf: isOutgoing ? "flex-end" : "flex-start",
                                                                                '&:focus-visible': hasHistoryEntries ? {
                                                                                        outline: "2px solid currentColor",
                                                                                        outlineOffset: 2
                                                                                } : undefined
                                                                        }}
                                                                >
                                                                        Edited
                                                                </Typography>
                                                        )}
                                                        {statusText && (
                                                                <Typography
                                                                        textAlign={isOutgoing ? "end" : "start"}
                                                                        variant="caption"
                                                                        color="textSecondary">
                                                                        {statusText}
                                                                </Typography>
                                                        )}
                                                </Stack>
                                        )}
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