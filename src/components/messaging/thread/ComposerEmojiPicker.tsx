import React, {useCallback} from "react";
import {Popover, useTheme} from "@mui/material";
import EmojiPicker, {EmojiClickData, EmojiStyle, Theme as EmojiTheme} from "emoji-picker-react";

export const EMOJI_PICKER_WIDTH = 350;
export const EMOJI_PICKER_HEIGHT = 420;

interface Props {
        open: boolean;
        anchorElement: HTMLElement | null;
        onClose: () => void;
        onEmojiSelected: (emoji: string) => void;
}

export default function ComposerEmojiPicker(props: Props) {
        const {open, anchorElement, onClose, onEmojiSelected} = props;
        const theme = useTheme();
        const emojiFontStack = "\"Noto Emoji COLRv1\", \"Noto Color Emoji\", \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Twemoji Mozilla\", \"EmojiOne Color\", \"Android Emoji\", system-ui, sans-serif";

        const handleEmojiClick = useCallback((emojiData: EmojiClickData) => {
                onEmojiSelected(emojiData.emoji);
        }, [onEmojiSelected]);

        return (
                <Popover
                        open={open}
                        anchorEl={anchorElement}
                        onClose={onClose}
                        anchorOrigin={{vertical: "top", horizontal: "right"}}
                        transformOrigin={{vertical: "bottom", horizontal: "right"}}
                        disableAutoFocus
                        disableEnforceFocus
                        disableRestoreFocus
                        PaperProps={{
                                sx: {
                                        borderRadius: 2,
                                        border: `1px solid ${theme.palette.divider}`,
                                        boxShadow: theme.shadows[6],
                                        overflow: "hidden"
                                }
                        }}
                        sx={{
                                "& .EmojiPickerReact": {
                                        "--epr-bg-color": theme.palette.background.paper,
                                        "--epr-category-label-bg-color": theme.palette.background.default,
                                        "--epr-hover-bg-color": theme.palette.action.hover,
                                        "--epr-text-color": theme.palette.text.primary,
                                        "--epr-search-background-color": theme.palette.background.paper,
                                        "--epr-picker-border-color": theme.palette.divider,
                                        "--epr-focus-bg-color": theme.palette.action.selected,
                                        "--epr-emoji-size": "26px"
                                },
                                "& .EmojiPickerReact, & .EmojiPickerReact *": {
                                        // Force emoji font to load glyphs from bundled Noto on older Windows
                                        fontFamily: `${emojiFontStack} !important`
                                }
                        }}>
                        <EmojiPicker
                                onEmojiClick={handleEmojiClick}
                                emojiStyle={EmojiStyle.NATIVE}
                                theme={theme.palette.mode === "dark" ? EmojiTheme.DARK : EmojiTheme.LIGHT}
                                lazyLoadEmojis
                                width={EMOJI_PICKER_WIDTH}
                                height={EMOJI_PICKER_HEIGHT}
                        />
                </Popover>
        );
}
