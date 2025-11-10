import React from "react";
import {Divider, IconButton, Stack, Toolbar, Typography} from "@mui/material";
import {VideocamOutlined} from "@mui/icons-material";

interface Props {
        title: string;
        children: React.ReactNode;
        className?: string;

        toolbarActions?: React.ReactNode;

        showCall?: boolean;
        onClickCall?: () => void;
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

                                {(props.toolbarActions || props.showCall) && (
                                        <Stack direction="row" spacing={1} alignItems="center">
                                                {props.toolbarActions}

                                                {props.showCall && (
                                                        <IconButton
                                                                size="large"
                                                                onClick={props.onClickCall}>
                                                                <VideocamOutlined />
                                                        </IconButton>
                                                )}
                                        </Stack>
                                )}
                        </Toolbar>
			
			<Divider />
			
			{props.children}
		</Stack>
	);
});