import {Dialog, DialogContent, DialogContentText, DialogTitle, Link, Typography} from "@mui/material";
import React from "react";

/**
 * A dialog that warns the user to check their server for updates
 */
export default function UpdateRequiredDialog(props: {isOpen: boolean, onDismiss: () => void}) {
	return (
		<Dialog
			open={props.isOpen}
			onClose={props.onDismiss}
			fullWidth>
			<DialogTitle>Your server needs to be updated</DialogTitle>
			<DialogContent>
				<DialogContentText>
                                        <Typography paragraph>
                                                You&apos;re running an unsupported version of BlueBubbles Server.
                                        </Typography>

                                        <Typography paragraph>
                                                Unsupported versions of BlueBubbles Server may contain security or stability issues
                                                and can refuse connections without warning.
                                        </Typography>

                                        <Typography paragraph>
                                                Please install the latest version of BlueBubbles Server from <Link href="https://bluebubbles.app" target="_blank">bluebubbles.app</Link> on your Mac.
                                        </Typography>
				</DialogContentText>
			</DialogContent>
		</Dialog>
	);
}