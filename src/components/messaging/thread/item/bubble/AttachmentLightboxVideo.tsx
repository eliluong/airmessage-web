import React from "react";
import {Backdrop, Box, IconButton, Toolbar, Tooltip, Typography} from "@mui/material";
import {ArrowBack, SaveAlt} from "@mui/icons-material";
import {ThemeProvider} from "@mui/material/styles";
import {lightboxTheme} from "../AttachmentLightbox";

export interface AttachmentLightboxVideoProps {
	open: boolean;
	title: string;
	src: string;
	type?: string;
	downloadLabel?: string;
	onClose: () => void;
	onDownload?: () => void;
	onPlaybackError?: () => void;
}

export default function AttachmentLightboxVideo({
	open,
	title,
	src,
	type,
	downloadLabel,
	onClose,
	onDownload,
	onPlaybackError
}: AttachmentLightboxVideoProps) {
	if(!open) {
		return null;
	}

	const handleDownloadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		onDownload?.();
	};

	const handleClose = (event: React.MouseEvent<HTMLElement>) => {
		event.stopPropagation();
		onClose();
	};

	return (
		<ThemeProvider theme={lightboxTheme}>
			<Backdrop
				sx={{
					zIndex: (theme) => theme.zIndex.modal,
					flexDirection: "column",
					alignItems: "stretch",
					backgroundColor: "rgba(0, 0, 0, 0.9)"
				}}
				open={open}
				onClick={onClose}>
				<Toolbar sx={{flexShrink: 0}}>
					<IconButton edge="start" onClick={handleClose}>
						<ArrowBack />
					</IconButton>

					<Box flexGrow={1} ml={1} display="flex" flexDirection="column" minWidth={0}>
						<Typography variant="h6" color="textPrimary" noWrap>
							{title}
						</Typography>
						{downloadLabel && (
							<Typography variant="body2" color="textSecondary" noWrap>
								{downloadLabel}
							</Typography>
						)}
					</Box>

					{onDownload && (
						<Tooltip title="Save">
							<IconButton onClick={handleDownloadClick}>
								<SaveAlt />
							</IconButton>
						</Tooltip>
					)}
				</Toolbar>

				<Box
					flex="1 1 0"
					minHeight={0}
					paddingLeft={2}
					paddingRight={2}
					paddingBottom={2}
					display="flex"
					alignItems="center"
					justifyContent="center"
					onClick={(event) => event.stopPropagation()}>
					<video
						key={src}
						src={src}
						controls
						autoPlay
						playsInline
						preload="auto"
						style={{
							maxWidth: "100%",
							maxHeight: "100%",
							width: "100%",
							height: "100%",
							objectFit: "contain"
						}}
						onError={onPlaybackError}>
						<source src={src} type={type} />
					</video>
				</Box>
			</Backdrop>
		</ThemeProvider>
	);
}
