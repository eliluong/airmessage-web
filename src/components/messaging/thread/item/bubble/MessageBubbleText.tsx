import React from "react";
import Linkify from "linkify-react";
import MessageBubbleWrapper from "shared/components/messaging/thread/item/bubble/MessageBubbleWrapper";
import {StickerItem, TapbackItem} from "shared/data/blocks";
import {Box, styled, Typography} from "@mui/material";
import useMessageLinkPreview from "shared/hooks/useMessageLinkPreview";
import MessageLinkPreview from "./MessageLinkPreview";
import {getFlowBorderRadius, MessagePartFlow} from "shared/util/messageFlow";
import {accessPaletteColor} from "shared/data/paletteSpecifier";
import {analyseEmojiText} from "shared/util/emojiUtils";

const BubbleSurface = styled("div", {
        shouldForwardProp: (prop) => prop !== "flow" && prop !== "isLargeEmoji"
})<{flow: MessagePartFlow; isLargeEmoji: boolean}>(({flow, theme, isLargeEmoji}) => ({
        display: "flex",
        flexDirection: "column",
        backgroundColor: isLargeEmoji ? "transparent" : accessPaletteColor(theme.palette, flow.backgroundColor),
        color: accessPaletteColor(theme.palette, flow.color),
        borderRadius: isLargeEmoji ? 0 : getFlowBorderRadius(flow),
        overflow: isLargeEmoji ? "visible" : "hidden",
        alignItems: isLargeEmoji ? "center" : undefined
}));

const MessageBubbleTypography = styled(Typography, {
        shouldForwardProp: (prop) => prop !== "isLargeEmoji"
})<{isLargeEmoji: boolean}>(({theme, isLargeEmoji}) => ({
        paddingLeft: isLargeEmoji ? 0 : theme.spacing(1.5),
        paddingRight: isLargeEmoji ? 0 : theme.spacing(1.5),
        paddingTop: isLargeEmoji ? 0 : theme.spacing(0.75),
        paddingBottom: isLargeEmoji ? 0 : theme.spacing(0.75),
        overflowWrap: "break-word",
        wordBreak: "break-word",
        hyphens: "auto",
        whiteSpace: "break-spaces",
        color: "inherit",
        fontSize: isLargeEmoji ? "2.5rem" : undefined,
        lineHeight: isLargeEmoji ? 1.1 : undefined,
        textAlign: isLargeEmoji ? "center" : undefined,
        display: isLargeEmoji ? "flex" : undefined,
        alignItems: isLargeEmoji ? "center" : undefined,
        justifyContent: isLargeEmoji ? "center" : undefined,

        "& a": {
                color: "inherit"
        }
}));

const PreviewPadding = styled(Box)(({theme}) => ({
        paddingLeft: 0,
        paddingRight: 0,
        paddingBottom: 0,
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
        const {emojiCount, isEmojiOnly} = analyseEmojiText(props.text);
        const isLargeEmoji = isEmojiOnly && emojiCount > 0 && emojiCount <= 3;

        return (
                <MessageBubbleWrapper
                        flow={props.flow}
                        stickers={props.stickers}
                        tapbacks={props.tapbacks}
                        maxWidth="60%">
                        <BubbleSurface flow={props.flow} isLargeEmoji={isLargeEmoji}>
                                <MessageBubbleTypography variant="body2" isLargeEmoji={isLargeEmoji}>
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
