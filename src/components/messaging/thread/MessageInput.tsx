import React, {ChangeEvent, useCallback, useEffect, useRef, useState} from "react";
import {Box, IconButton, InputBase, Stack} from "@mui/material";
import InsertEmoticonOutlinedIcon from "@mui/icons-material/InsertEmoticonOutlined";
import type {IconButtonProps} from "@mui/material";
import PushIcon from "../../icon/PushIcon";
import ComposerEmojiPicker from "./ComposerEmojiPicker";
import {LocalConversationID, QueuedFile} from "../../../data/blocks";
import {insertEmojiAtSelection} from "shared/util/emojiUtils";
import {QueuedAttachmentImage} from "./queue/QueuedAttachmentImage";
import QueuedAttachmentGeneric from "./queue/QueuedAttachmentGeneric";
import {QueuedAttachmentProps} from "./queue/QueuedAttachment";

interface Props {
        conversationID: LocalConversationID;
        placeholder: string;
        message: string;
        attachments: QueuedFile[];
        onMessageChange: (value: string) => void;
        onMessageSubmit: (message: string, attachments: QueuedFile[]) => void;
        onAttachmentAdd: (files: File[]) => void;
        onAttachmentRemove: (value: QueuedFile) => void;
        sendButtonColor?: IconButtonProps["color"] | string;
}

export default function MessageInput(props: Props) {
        const {
                conversationID: propsConversationID,
                onMessageChange: propsOnMessageChange,
                onMessageSubmit: propsOnMessageSubmit,
                message: propsMessage,
                attachments: propsAttachments,
                onAttachmentAdd: propsOnAttachmentAdd,
                sendButtonColor = "primary"
        } = props;

	const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
	const [emojiAnchorElement, setEmojiAnchorElement] = useState<HTMLElement | null>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);

	const closeEmojiPicker = useCallback(() => {
		setIsEmojiPickerOpen(false);
		setEmojiAnchorElement(null);
		inputRef.current?.focus();
	}, []);

	useEffect(() => {
		closeEmojiPicker();
	}, [closeEmojiPicker, propsConversationID]);

	const toggleEmojiPicker = useCallback((event: React.MouseEvent<HTMLElement>) => {
		if(isEmojiPickerOpen) {
			closeEmojiPicker();
			return;
		}

		setEmojiAnchorElement(event.currentTarget);
		setIsEmojiPickerOpen(true);
	}, [closeEmojiPicker, isEmojiPickerOpen]);

	const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
		propsOnMessageChange(event.target.value);
	}, [propsOnMessageChange]);
	
	const submitInput = useCallback(() => {
		closeEmojiPicker();
		propsOnMessageSubmit(propsMessage, propsAttachments);
	}, [closeEmojiPicker, propsOnMessageSubmit, propsMessage, propsAttachments]);
	
	const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
		if(event.key === "Escape" && isEmojiPickerOpen) {
			event.preventDefault();
			closeEmojiPicker();
			return;
		}

		if(!event.shiftKey && event.key === "Enter") {
			event.preventDefault();
			submitInput();
		}
	}, [closeEmojiPicker, isEmojiPickerOpen, submitInput]);
	
        const handlePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
                propsOnAttachmentAdd(Array.from(event.clipboardData.files));
        }, [propsOnAttachmentAdd]);

	const handleEmojiSelected = useCallback((emoji: string) => {
		const inputElement = inputRef.current;
		const selectionStart = inputElement?.selectionStart ?? propsMessage.length;
		const selectionEnd = inputElement?.selectionEnd ?? propsMessage.length;

		const {value, newCaretPosition} = insertEmojiAtSelection(
			propsMessage,
			selectionStart,
			selectionEnd,
			emoji
		);

		propsOnMessageChange(value);

		requestAnimationFrame(() => {
			const target = inputRef.current;
			if(!target) return;
			const nextCaretPosition = Math.min(newCaretPosition, target.value.length);
			target.focus();
			target.setSelectionRange(nextCaretPosition, nextCaretPosition);
		});
	}, [propsMessage, propsOnMessageChange]);

        const isCustomSendButtonColor = typeof sendButtonColor === "string" && sendButtonColor.startsWith("#");
	
	return (
		<Box sx={{
			borderRadius: 5,
			backgroundColor: "messageIncoming.main",
			overflow: "hidden",
			maxWidth: 1000,
			marginX: "auto"
		}}>
			{props.attachments.length > 0 &&
				<Stack
					sx={{
						overflowX: "scroll",
						overflowY: "hidden",
						scrollbarWidth: "none",
						"&::-webkit-scrollbar": {
							display: "none"
						},
						
						paddingX: "16px",
						paddingTop: "16px"
					}}
					direction="row"
					gap={2}>
					{props.attachments.map((file) => {
						const queueData: QueuedAttachmentProps = {
							file: file.file,
							onRemove: () => props.onAttachmentRemove(file)
						};
						
						let component: React.ReactNode;
						if(file.file.type.startsWith("image/")) {
							component = (<QueuedAttachmentImage key={file.id} queueData={queueData} />);
						} else {
							component = (<QueuedAttachmentGeneric key={file.id} queueData={queueData} />);
						}
						
						return component;
					})}
				</Stack>
			}
			
			<Stack direction="row" alignItems="flex-end">
				<InputBase
					sx={{
						typography: "body2",
						paddingX: "16px",
						paddingY: "10px"
					}}
					maxRows="5"
					multiline
					fullWidth
					autoFocus
					inputRef={inputRef}
					placeholder={props.placeholder}
					value={props.message}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste} />
				<IconButton
					sx={{
						width: "40px",
						height: "40px",
						flexShrink: 0,
						alignSelf: "flex-end"
					}}
					size="small"
					aria-label="Insert emoji"
					aria-haspopup="dialog"
					aria-expanded={isEmojiPickerOpen}
					onClick={toggleEmojiPicker}>
					<InsertEmoticonOutlinedIcon />
				</IconButton>
                                <IconButton
                                        sx={{
                                                width: "40px",
                                                height: "40px",
                                                flexShrink: 0,
                                                alignSelf: "flex-end",
                                                ...(isCustomSendButtonColor ? {color: sendButtonColor} : {})
                                        }}
                                        size="small"
                                        color={isCustomSendButtonColor ? undefined : sendButtonColor as IconButtonProps["color"]}
                                        disabled={props.message.trim() === "" && props.attachments.length === 0}
                                        onClick={submitInput}>
					<PushIcon />
				</IconButton>
			</Stack>
			<ComposerEmojiPicker
				open={isEmojiPickerOpen}
				anchorElement={emojiAnchorElement}
				onClose={closeEmojiPicker}
				onEmojiSelected={handleEmojiSelected}
			/>
		</Box>
	);
}
