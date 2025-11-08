import React from "react";
import {
        Box,
        Button,
        Dialog,
        DialogActions,
        DialogContent,
        DialogTitle,
        List,
        ListItem,
        ListItemText,
        ListSubheader,
        Stack,
        Typography
} from "@mui/material";
import {SettingsColorScheme, useSettings} from "shared/components/settings/SettingsProvider";

const COLOR_SCHEME_LABEL: Record<SettingsColorScheme, string> = {
        system: "System default",
        light: "Light",
        dark: "Dark"
};

export default function SettingsDialog(props: {isOpen: boolean; onDismiss: () => void}) {
        const {settings} = useSettings();

        return (
                <Dialog open={props.isOpen} onClose={props.onDismiss} fullWidth maxWidth="sm">
                        <DialogTitle>Settings</DialogTitle>
                        <DialogContent dividers>
                                <Stack spacing={3}>
                                        <Typography variant="body2" color="textSecondary">
                                                Personalize AirMessage for this browser. Changes will be saved on this device and can be reset at any
                                                time.
                                        </Typography>

                                        <List
                                                dense
                                                sx={{
                                                        borderRadius: 1,
                                                        border: (theme) => `1px solid ${theme.palette.divider}`
                                                }}
                                                subheader={
                                                        <ListSubheader component="div" disableSticky>
                                                                Appearance
                                                        </ListSubheader>
                                                }>
                                                <ListItem
                                                        secondaryAction={
                                                                <Button variant="outlined" size="small" disabled>
                                                                        Coming soon
                                                                </Button>
                                                        }>
                                                        <ListItemText
                                                                primary="Theme"
                                                                secondary={`Currently using ${COLOR_SCHEME_LABEL[settings.appearance.colorScheme]} mode`}
                                                        />
                                                </ListItem>
                                        </List>

                                        <Box>
                                                <Typography variant="body2" color="textSecondary" gutterBottom>
                                                        Upcoming settings will offer sensible defaults while still remembering any tweaks you make.
                                                </Typography>
                                                <Typography variant="body2" color="textSecondary">
                                                        Preferences are stored securely in your browser using local storage so they stay private to you.
                                                </Typography>
                                        </Box>
                                </Stack>
                        </DialogContent>
                        <DialogActions>
                                <Button onClick={props.onDismiss}>Close</Button>
                        </DialogActions>
                </Dialog>
        );
}
