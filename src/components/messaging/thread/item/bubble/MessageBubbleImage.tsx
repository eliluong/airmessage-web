import React, {useCallback, useState} from "react";
import MessageBubbleWrapper from "shared/components/messaging/thread/item/bubble/MessageBubbleWrapper";
import {StickerItem, TapbackItem} from "shared/data/blocks";
import {Box, ButtonBase, styled} from "@mui/material";
import {getFlowBorderRadius, MessagePartFlow} from "shared/util/messageFlow";
import {useBlobURL} from "shared/util/hookUtils";
import {downloadURL} from "shared/util/browserUtils";
import AttachmentLightbox from "../AttachmentLightbox";

const ImagePreview = styled("img")(({theme}) => ({
	backgroundColor: theme.palette.background.sidebar,
	maxWidth: "100%",
}));

/**
 * A message bubble that displays an image thumbnail,
 * and allows the user to enlarge the image by
 * clicking on it
 */
export default function MessageBubbleImage(props: {
	flow: MessagePartFlow;
	data: ArrayBuffer | Blob;
	name: string;
	type: string;
	stickers: StickerItem[];
	tapbacks: TapbackItem[];
}) {
	const imageURL = useBlobURL(props.data);
	const [previewOpen, setPreviewOpen] = useState(false);
	
	/**
	 * Saves the attachment file to the user's downloads
	 */
        const downloadAttachmentFile = useCallback((event?: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
                //So that we don't dismiss the backdrop
                event?.stopPropagation();
		
		if(imageURL === undefined) return;
		downloadURL(imageURL, props.type, props.name);
	}, [imageURL, props.type, props.name]);
	
	const borderRadius = getFlowBorderRadius(props.flow);
	
        return (<>
                <AttachmentLightbox
                        open={previewOpen}
                        title={props.name}
                        imageURL={imageURL}
                        onClose={() => setPreviewOpen(false)}
                        onDownload={() => downloadAttachmentFile()}
                />

                <MessageBubbleWrapper
                        flow={props.flow}
			stickers={props.stickers}
			tapbacks={props.tapbacks}
			maxWidth={400}>
			<ButtonBase
				style={{borderRadius}}
				onClick={() => setPreviewOpen(true)}>
				<ImagePreview
					style={{borderRadius}}
					src={imageURL}
					alt="" />
			</ButtonBase>
		</MessageBubbleWrapper>
	</>);
}