import React from "react";
import Linkify from "linkify-react";
import MessageBubbleWrapper from "shared/components/messaging/thread/item/bubble/MessageBubbleWrapper";
import {StickerItem, TapbackItem} from "shared/data/blocks";
import {Box, styled, Typography} from "@mui/material";
import useMessageLinkPreview from "shared/hooks/useMessageLinkPreview";
import MessageLinkPreview from "./MessageLinkPreview";
import {getFlowBorderRadius, MessagePartFlow} from "shared/util/messageFlow";
import {accessPaletteColor} from "shared/data/paletteSpecifier";

const BubbleSurface = styled("div", {
        shouldForwardProp: (prop) => prop !== "flow"
})<{flow: MessagePartFlow}>(({flow, theme}) => ({
        display: "flex",
        flexDirection: "column",
        backgroundColor: accessPaletteColor(theme.palette, flow.backgroundColor),
        color: accessPaletteColor(theme.palette, flow.color),
        borderRadius: getFlowBorderRadius(flow),
        overflow: "hidden"
}));

const MessageBubbleTypography = styled(Typography)(({theme}) => ({
        paddingLeft: theme.spacing(1.5),
        paddingRight: theme.spacing(1.5),
        paddingTop: theme.spacing(0.75),
        paddingBottom: theme.spacing(0.75),
        overflowWrap: "break-word",
        wordBreak: "break-word",
        hyphens: "auto",
        whiteSpace: "break-spaces",
        color: "inherit",

        "& a": {
                color: "inherit"
        }
}));

const PreviewPadding = styled(Box)(({theme}) => ({
        paddingLeft: theme.spacing(1.5),
        paddingRight: theme.spacing(1.5),
        paddingBottom: theme.spacing(1.5),
        paddingTop: theme.spacing(0.5),
        display: "flex",
        width: "100%"
}));

/**
 * A message bubble that displays text content
 */
export default function MessageBubbleText(props: {
        flow: MessagePartFlow;
        text: string;
        stickers: StickerItem[];
        tapbacks: TapbackItem[];
}) {
        const previewState = useMessageLinkPreview(props.text);

        return (
                <MessageBubbleWrapper
                        flow={props.flow}
                        stickers={props.stickers}
                        tapbacks={props.tapbacks}
                        maxWidth="60%">
                        <BubbleSurface flow={props.flow}>
                                <MessageBubbleTypography variant="body2">
                                        <Linkify options={{target: "_blank"}}>{props.text}</Linkify>
                                </MessageBubbleTypography>
                                {previewState.status === "ready" && previewState.preview && (
                                        <PreviewPadding>
                                                <MessageLinkPreview preview={previewState.preview} />
                                        </PreviewPadding>
                                )}
                        </BubbleSurface>
                </MessageBubbleWrapper>
        );
}
