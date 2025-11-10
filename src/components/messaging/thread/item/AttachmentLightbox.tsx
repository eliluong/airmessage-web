import React from "react";
import {Backdrop, Box, IconButton, Toolbar, Tooltip, Typography} from "@mui/material";
import {createTheme, Theme, ThemeProvider} from "@mui/material/styles";
import {ArrowBack, SaveAlt} from "@mui/icons-material";

const lightboxTheme = createTheme({
        palette: {
                mode: "dark",
                messageIncoming: undefined,
                messageOutgoing: undefined,
                messageOutgoingTextMessage: undefined
        }
});

export interface AttachmentLightboxProps {
        open: boolean;
        title: string;
        imageURL?: string;
        onClose: () => void;
        onDownload?: () => void;
}

export default function AttachmentLightbox(props: AttachmentLightboxProps) {
        const handleDownloadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                props.onDownload?.();
        };

        return (
                <ThemeProvider theme={lightboxTheme}>
                        <Backdrop
                                sx={{
                                        zIndex: (theme: Theme) => theme.zIndex.modal,
                                        flexDirection: "column",
                                        alignItems: "stretch",
                                        backgroundColor: "rgba(0, 0, 0, 0.9)"
                                }}
                                open={props.open}
                                onClick={props.onClose}>
                                <Toolbar sx={{flexShrink: 0}}>
                                        <IconButton edge="start">
                                                <ArrowBack />
                                        </IconButton>

                                        <Typography
                                                flexGrow={1}
                                                variant="h6"
                                                color="textPrimary">
                                                {props.title}
                                        </Typography>

                                        {props.onDownload && (
                                                <Tooltip title="Save">
                                                        <IconButton onClick={handleDownloadClick}>
                                                                <SaveAlt />
                                                        </IconButton>
                                                </Tooltip>
                                        )}
                                </Toolbar>

                                <Box
                                        flexGrow={1}
                                        paddingLeft={8}
                                        paddingRight={8}
                                        paddingBottom={8}>
                                        <Box
                                                sx={{
                                                        width: "100%",
                                                        height: "100%",
                                                        backgroundImage: props.imageURL ? `url("${props.imageURL}")` : undefined,
                                                        backgroundPosition: "center",
                                                        backgroundRepeat: "no-repeat",
                                                        backgroundSize: "contain",
                                                        backgroundColor: "black"
                                        }} />
                                </Box>
                        </Backdrop>
                </ThemeProvider>
        );
}

export {lightboxTheme};
