import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import MessageBubbleWrapper from "shared/components/messaging/thread/item/bubble/MessageBubbleWrapper";
import {StickerItem, TapbackItem} from "shared/data/blocks";
import {Box, ButtonBase, CircularProgress, Stack, styled, Typography} from "@mui/material";
import {getFlowBorderRadius, MessagePartFlow} from "shared/util/messageFlow";
import {SnackbarContext} from "shared/components/control/SnackbarProvider";
import {GetAppRounded, PlayArrowRounded} from "@mui/icons-material";
import {downloadBlob} from "shared/util/browserUtils";
import {attachmentRequestErrorCodeToDisplay, formatFileSize} from "shared/util/languageUtils";
import * as ConnectionManager from "shared/connection/connectionManager";
import {AttachmentRequestErrorCode} from "shared/data/stateCodes";
import FileDownloadResult from "shared/data/fileDownloadResult";
import {coerceBlobToMp4} from "shared/util/attachmentPreview";
import AttachmentLightboxVideo from "./AttachmentLightboxVideo";
import PaletteSpecifier, {accessPaletteColor} from "shared/data/paletteSpecifier";
import {useUnsubscribeContainer} from "shared/util/hookUtils";

const VideoButton = styled(ButtonBase, {
	shouldForwardProp: (prop) =>
		typeof prop !== "string" || !["amColor", "amBackgroundColor"].includes(prop)
})<{
	amColor: PaletteSpecifier;
	amBackgroundColor: PaletteSpecifier;
}>(({amColor, amBackgroundColor, theme}) => ({
	color: accessPaletteColor(theme.palette, amColor),
	backgroundColor: accessPaletteColor(theme.palette, amBackgroundColor),
	paddingLeft: theme.spacing(1.5),
	paddingRight: theme.spacing(1.5),
	paddingTop: theme.spacing(0.75),
	paddingBottom: theme.spacing(0.75),
	overflowWrap: "break-word",
	wordBreak: "break-word",
	hyphens: "auto",
	display: "flex",
	flexDirection: "row",
	alignItems: "center"
}));

const VideoIcon = styled(Box)({
	flexShrink: 0,
	width: 36,
	height: 36,
	display: "flex",
	alignItems: "center",
	justifyContent: "center"
});

const INLINE_SIZE_LIMIT_BYTES = 200 * 1024 * 1024; // 200 MB

function browserCanPlayMp4(): boolean {
	if(typeof document === "undefined") return false;
	const v = document.createElement("video");
	if(!v.canPlayType) return false;
	const basic = v.canPlayType("video/mp4");
	if(basic === "probably" || basic === "maybe") return true;
	const support = v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
	return support === "probably" || support === "maybe";
}

export default function MessageBubbleVideo(props: {
	flow: MessagePartFlow;
	data: Blob | undefined;
	name: string | undefined;
	type: string;
	size: number;
	guid?: string;
	onDataAvailable?: (result: FileDownloadResult) => void;
	stickers: StickerItem[];
	tapbacks: TapbackItem[];
}) {
	const {
		data,
		name,
		type,
		size,
		guid,
		flow,
		onDataAvailable,
		stickers,
		tapbacks
	} = props;
	const displaySnackbar = useContext(SnackbarContext);
	const [isDownloading, setIsDownloading] = useState(false);
	const [sizeAvailable, setSizeAvailable] = useState<number>(size);
	const [sizeDownloaded, setSizeDownloaded] = useState<number | undefined>(undefined);
	const [lightboxOpen, setLightboxOpen] = useState(false);
	const [videoUrls, setVideoUrls] = useState<{mp4?: string; original?: string}>({});
	const [activeSource, setActiveSource] = useState<"mp4" | "original">("mp4");
	const [downloadOnly, setDownloadOnly] = useState(size > INLINE_SIZE_LIMIT_BYTES);
	const downloadResultRef = useRef<FileDownloadResult | undefined>(undefined);
	const attachmentSubscriptionContainer = useUnsubscribeContainer([guid]);

	const nameDisplay = useMemo(() => name ?? "Video file", [name]);

	const subtitle = useMemo(() => {
		if(isDownloading) {
			const downloaded = sizeDownloaded ?? 0;
			return `${formatFileSize(downloaded)} of ${formatFileSize(sizeAvailable)}`;
		}
		if(downloadOnly) return "Tap to download";
		return "Tap to play";
	}, [isDownloading, downloadOnly, sizeAvailable, sizeDownloaded]);

	useEffect(() => {
		return () => {
			if(videoUrls.mp4) URL.revokeObjectURL(videoUrls.mp4);
			if(videoUrls.original) URL.revokeObjectURL(videoUrls.original);
		};
	}, [videoUrls]);

	useEffect(() => {
		// Reset state when attachment identity changes
		setIsDownloading(false);
		setSizeAvailable(size);
		setSizeDownloaded(undefined);
		setLightboxOpen(false);
		setDownloadOnly(size > INLINE_SIZE_LIMIT_BYTES);
		downloadResultRef.current = undefined;
		setVideoUrls({});
		setActiveSource("mp4");
	}, [guid, size, name, type]);

	useEffect(() => {
		if(!data) return;
		const mp4 = coerceBlobToMp4(data);
		const originalBlob = data instanceof Blob ? data : new Blob([data], {type});
		const mp4Url = URL.createObjectURL(mp4);
		const originalUrl = URL.createObjectURL(originalBlob);
		setVideoUrls((previous) => {
			if(previous.mp4) URL.revokeObjectURL(previous.mp4);
			if(previous.original) URL.revokeObjectURL(previous.original);
			return {mp4: mp4Url, original: originalUrl};
		});
		setActiveSource("mp4");
		downloadResultRef.current = {
			data,
			downloadName: name,
			downloadType: type
		};
		setSizeAvailable(originalBlob.size || size);
	}, [data, name, type, size]);

	const fetchAttachmentWithProgress = useCallback(async (): Promise<FileDownloadResult> => {
		if(!guid) throw new Error("Attachment unavailable");
		setIsDownloading(true);
		setSizeDownloaded(0);
		const downloadProgress = ConnectionManager.fetchAttachment(guid);
		downloadProgress.emitter.subscribe((progressEvent) => {
			if(progressEvent.type === "size") {
				setSizeAvailable(progressEvent.value);
			} else {
				setSizeDownloaded(progressEvent.value);
			}
		}, attachmentSubscriptionContainer);

		try {
			const download = await downloadProgress.promise;
			downloadResultRef.current = download;
			onDataAvailable?.(download);
			return download;
		} finally {
			setIsDownloading(false);
			setSizeDownloaded(undefined);
		}
	}, [attachmentSubscriptionContainer, guid, onDataAvailable]);

	const triggerDownload = useCallback(async (event?: React.MouseEvent) => {
		event?.stopPropagation();
		try {
			const result = downloadResultRef.current ?? await fetchAttachmentWithProgress();
			downloadBlob(
				result.data,
				result.downloadType ?? result.data.type ?? type,
				result.downloadName ?? name ?? "attachment.mov"
			);
		} catch(error) {
			const message = typeof error === "number"
				? attachmentRequestErrorCodeToDisplay(error as AttachmentRequestErrorCode)
				: (error as Error)?.message ?? "Unknown error";
			displaySnackbar?.({message: `Failed to download attachment: ${message}`});
		}
	}, [displaySnackbar, fetchAttachmentWithProgress, name, type]);

	const ensureVideoUrl = useCallback(async () => {
		if(videoUrls.mp4) return videoUrls.mp4;
		if(downloadOnly) throw new Error("Inline playback disabled");

		if(downloadResultRef.current) {
			const mp4 = coerceBlobToMp4(downloadResultRef.current.data);
			const originalBlob = downloadResultRef.current.data;
			const originalUrl = URL.createObjectURL(originalBlob);
			const url = URL.createObjectURL(mp4);
			setVideoUrls((previous) => {
				if(previous.mp4) URL.revokeObjectURL(previous.mp4);
				if(previous.original) URL.revokeObjectURL(previous.original);
				return {mp4: url, original: originalUrl};
			});
			setActiveSource("mp4");
			return url;
		}

		if(data) {
			const mp4 = coerceBlobToMp4(data);
			const originalBlob = data instanceof Blob ? data : new Blob([data], {type});
			const originalUrl = URL.createObjectURL(originalBlob);
			const url = URL.createObjectURL(mp4);
			setVideoUrls((previous) => {
				if(previous.mp4) URL.revokeObjectURL(previous.mp4);
				if(previous.original) URL.revokeObjectURL(previous.original);
				return {mp4: url, original: originalUrl};
			});
			setActiveSource("mp4");
			return url;
		}

		if(!guid) {
			throw new Error("Attachment unavailable");
		}

		const download = await fetchAttachmentWithProgress();
		const mp4 = coerceBlobToMp4(download.data);
		const originalUrl = URL.createObjectURL(download.data);
		const url = URL.createObjectURL(mp4);
		setVideoUrls((previous) => {
			if(previous.mp4) URL.revokeObjectURL(previous.mp4);
			if(previous.original) URL.revokeObjectURL(previous.original);
			return {mp4: url, original: originalUrl};
		});
		setActiveSource("mp4");
		return url;
	}, [data, downloadOnly, fetchAttachmentWithProgress, guid, onDataAvailable, videoUrls]);

	const handleClick = useCallback(async () => {
		if(downloadOnly) {
			await triggerDownload();
			return;
		}

		try {
			await ensureVideoUrl();
			setLightboxOpen(true);
		} catch(error) {
			console.warn("Failed to open inline video", error);
			displaySnackbar?.({message: "Could not load video. Tap download to save."});
			setDownloadOnly(true);
		}
	}, [downloadOnly, ensureVideoUrl, triggerDownload]);

	const handlePlaybackError = useCallback(() => {
		if(!lightboxOpen) return;
		if(activeSource === "mp4" && videoUrls.original) {
			setActiveSource("original");
			return;
		}
		setLightboxOpen(false);
		setDownloadOnly(true);
		displaySnackbar?.({message: "Playback failed. Download to view."});
	}, [activeSource, displaySnackbar, lightboxOpen, videoUrls.original]);

	const borderRadius = getFlowBorderRadius(flow);
	const sizeLabel = formatFileSize(size);
	const activeUrl = activeSource === "mp4"
		? videoUrls.mp4 ?? videoUrls.original ?? ""
		: videoUrls.original ?? videoUrls.mp4 ?? "";
	const activeType = "video/mp4";

	return (<>
		<AttachmentLightboxVideo
			open={lightboxOpen && !!activeUrl}
			title={nameDisplay}
			downloadLabel={sizeLabel}
			src={activeUrl}
			type={activeType}
			onClose={() => setLightboxOpen(false)}
			onDownload={() => triggerDownload()}
			onPlaybackError={handlePlaybackError}
		/>
		<MessageBubbleWrapper
			flow={flow}
			stickers={stickers}
			tapbacks={tapbacks}
			maxWidth="60%">
			<VideoButton
				style={{borderRadius}}
				amColor={flow.color}
				amBackgroundColor={flow.backgroundColor}
				disabled={isDownloading}
				onClick={handleClick}>
				<VideoIcon>
					{isDownloading ? (
						<CircularProgress
							sx={{color: flow.color}}
							size={24}
							variant={sizeAvailable > 0 && sizeDownloaded !== undefined ? "determinate" : "indeterminate"}
							value={
								sizeAvailable > 0 && sizeDownloaded !== undefined
									? (sizeDownloaded / sizeAvailable) * 100
									: undefined
							}
						/>
					) : downloadOnly ? (
						<GetAppRounded />
					) : (
						<PlayArrowRounded />
					)}
				</VideoIcon>

				<Stack alignItems="flex-start" marginLeft={1.5} flexGrow={1} minWidth={0}>
					<Typography variant="body2" textAlign="start" noWrap>
						{nameDisplay}
					</Typography>
					<Typography sx={{opacity: 0.8}} variant="body2" textAlign="start" noWrap>
						{`${sizeLabel} • ${subtitle}`}
					</Typography>
				</Stack>

				<Box
					component="div"
					sx={{
						marginLeft: 1,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: flow.color
					}}
					onClick={(event) => triggerDownload(event)}
					onMouseDown={(event) => event.stopPropagation()}
					onTouchStart={(event) => event.stopPropagation()}>
					<GetAppRounded fontSize="small" />
				</Box>
			</VideoButton>
		</MessageBubbleWrapper>
	</>);
}
