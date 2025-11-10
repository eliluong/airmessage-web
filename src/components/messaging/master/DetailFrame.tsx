import React from "react";
import {Divider, IconButton, Stack, Toolbar, Typography} from "@mui/material";
import {CollectionsOutlined, VideocamOutlined} from "@mui/icons-material";

interface Props {
        title: string;
        children: React.ReactNode;
        className?: string;

        showCall?: boolean;
        onClickCall?: () => void;

        showMediaDrawerButton?: boolean;
        onClickMediaDrawer?: () => void;
        mediaDrawerOpen?: boolean;
}

/**
 * A frame component with a toolbar, used to wrap detail views
 */
export const DetailFrame = React.forwardRef<HTMLDivElement, Props>((props, ref) => {
	return (
		<Stack height="100%" ref={ref}>
			<Toolbar>
				<Typography
					flexGrow={1}
					flexShrink={1}
					flexBasis={0}
					variant="h6"
					noWrap>
					{props.title}
				</Typography>
				
                                {props.showMediaDrawerButton && (
                                        <IconButton
                                                size="large"
                                                color={props.mediaDrawerOpen ? "primary" : "default"}
                                                onClick={props.onClickMediaDrawer}
                                                aria-pressed={props.mediaDrawerOpen}
                                                aria-label={props.mediaDrawerOpen ? "Hide media drawer" : "Show media drawer"}>
                                                <CollectionsOutlined />
                                        </IconButton>
                                )}

                                {props.showCall && (
                                        <IconButton
                                                size="large"
                                                onClick={props.onClickCall}>
						<VideocamOutlined />
					</IconButton>
				)}
			</Toolbar>
			
			<Divider />
			
			{props.children}
		</Stack>
	);
});