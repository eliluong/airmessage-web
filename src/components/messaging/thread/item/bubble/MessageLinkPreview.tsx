import React from "react";
import {Box, styled, Typography} from "@mui/material";
import {LinkPreviewData} from "shared/util/linkPreviewCache";

const PreviewAnchor = styled("a")(({theme}) => ({
        width: "100%",
        display: "flex",
        flexDirection: "column",
        textDecoration: "none",
        color: theme.palette.text.primary,
        borderRadius: theme.shape.borderRadius,
        overflow: "hidden",
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        transition: theme.transitions.create(["box-shadow"], {duration: theme.transitions.duration.shorter}),
        "&:hover": {
                boxShadow: theme.shadows[4]
        }
}));

const PreviewImage = styled("img")({
        width: "100%",
        height: 168,
        objectFit: "cover",
        display: "block"
});

const PreviewContent = styled(Box)(({theme}) => ({
        padding: theme.spacing(1.5),
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing(0.75)
}));

const PreviewTitle = styled(Typography)(({theme}) => ({
        fontWeight: theme.typography.fontWeightMedium,
        lineHeight: 1.4,
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical"
}));

const PreviewDescription = styled(Typography)(({theme}) => ({
        color: theme.palette.text.secondary,
        lineHeight: 1.4,
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical"
}));

const PreviewUrl = styled(Typography)(({theme}) => ({
        color: theme.palette.text.secondary,
        fontSize: theme.typography.pxToRem(12),
        textTransform: "lowercase"
}));

function getDomain(previewUrl: string): string {
        try {
                return new URL(previewUrl).hostname;
        } catch (error) {
                return previewUrl;
        }
}

export default function MessageLinkPreview(props: {preview: LinkPreviewData}): JSX.Element {
        const {preview} = props;
        const domain = getDomain(preview.url);

        return (
                <PreviewAnchor href={preview.url} target="_blank" rel="noopener noreferrer">
                        {preview.image && (
                                <PreviewImage src={preview.image} alt="" loading="lazy" />
                        )}
                        <PreviewContent>
                                <PreviewTitle variant="subtitle2">{preview.title || domain}</PreviewTitle>
                                {preview.description && (
                                        <PreviewDescription variant="body2">{preview.description}</PreviewDescription>
                                )}
                                <PreviewUrl variant="caption">{domain}</PreviewUrl>
                        </PreviewContent>
                </PreviewAnchor>
        );
}
