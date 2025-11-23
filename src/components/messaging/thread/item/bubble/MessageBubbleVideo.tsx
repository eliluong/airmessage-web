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
	const [lightboxOpen, setLightboxOpen] = useState(false);
	const [videoUrls, setVideoUrls] = useState<{mp4?: string; original?: string}>({});
	const [activeSource, setActiveSource] = useState<"mp4" | "original">("mp4");
	const [downloadOnly, setDownloadOnly] = useState(size > INLINE_SIZE_LIMIT_BYTES);
	const downloadResultRef = useRef<FileDownloadResult | undefined>(undefined);

	const nameDisplay = useMemo(() => name ?? "Video file", [name]);

	const subtitle = useMemo(() => {
		if(isDownloading) return "Loading…";
		if(downloadOnly) return "Tap to download";
		return "Tap to play";
	}, [isDownloading, downloadOnly]);

	useEffect(() => {
		return () => {
			if(videoUrls.mp4) URL.revokeObjectURL(videoUrls.mp4);
			if(videoUrls.original) URL.revokeObjectURL(videoUrls.original);
		};
	}, [videoUrls]);

	useEffect(() => {
		// Reset state when attachment identity changes
		setIsDownloading(false);
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
	}, [data, name, type]);

	const triggerDownload = useCallback(async (event?: React.MouseEvent) => {
		event?.stopPropagation();
		try {
			if(downloadResultRef.current) {
				const result = downloadResultRef.current;
				downloadBlob(
					result.data,
					result.downloadType ?? result.data.type ?? type,
					result.downloadName ?? name ?? "attachment.mov"
				);
				return;
			}

			if(!guid) {
				setDownloadOnly(true);
				displaySnackbar?.({message: "Attachment is unavailable for download."});
				return;
			}

			setIsDownloading(true);
			const download = await ConnectionManager.fetchAttachment(guid).promise;
			downloadResultRef.current = download;
			onDataAvailable?.(download);
			downloadBlob(
				download.data,
				download.downloadType ?? download.data.type ?? type,
				download.downloadName ?? name ?? "attachment.mov"
			);
		} catch(error) {
			const message = typeof error === "number"
				? attachmentRequestErrorCodeToDisplay(error as AttachmentRequestErrorCode)
				: (error as Error)?.message ?? "Unknown error";
			displaySnackbar?.({message: `Failed to download attachment: ${message}`});
		} finally {
			setIsDownloading(false);
		}
	}, [displaySnackbar, guid, name, onDataAvailable, type]);

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

		setIsDownloading(true);
		try {
			const downloadProgress = ConnectionManager.fetchAttachment(guid);
			const download = await downloadProgress.promise;
			downloadResultRef.current = download;
			onDataAvailable?.(download);
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
		} finally {
			setIsDownloading(false);
		}
	}, [data, downloadOnly, guid, onDataAvailable, videoUrls]);

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
							variant="indeterminate"
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
