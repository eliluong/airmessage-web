import React, {useCallback} from "react";
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
        Switch,
        TextField,
        Typography
} from "@mui/material";
import {SettingsColorScheme, useSettings} from "shared/components/settings/SettingsProvider";

const COLOR_SCHEME_LABEL: Record<SettingsColorScheme, string> = {
        system: "System default",
        light: "Light",
        dark: "Dark"
};

export default function SettingsDialog(props: {isOpen: boolean; onDismiss: () => void}) {
        const {settings, updateSettings} = useSettings();

        const handleInitialLoadCountChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
                const value = Number.parseInt(event.target.value, 10);
                updateSettings((previous) => {
                        const nextValue = Number.isFinite(value) ? Math.min(1000, Math.max(1, value)) : previous.conversations.initialLoadCount;
                        return {
                                ...previous,
                                conversations: {
                                        initialLoadCount: nextValue
                                }
                        };
                });
        }, [updateSettings]);

        const handleBlueBubblesDebugLoggingChange = useCallback(
                (event: React.ChangeEvent<HTMLInputElement>) => {
                        const isEnabled = event.target.checked;
                        updateSettings((previous) => ({
                                ...previous,
                                developer: {
                                        ...previous.developer,
                                        blueBubblesDebugLogging: isEnabled
                                }
                        }));
                },
                [updateSettings]
        );

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

                                        <List
                                                dense
                                                sx={{
                                                        borderRadius: 1,
                                                        border: (theme) => `1px solid ${theme.palette.divider}`
                                                }}
                                                subheader={
                                                        <ListSubheader component="div" disableSticky>
                                                                Conversations
                                                        </ListSubheader>
                                                }>
                                                <ListItem
                                                        secondaryAction={
                                                                <TextField
                                                                        type="number"
                                                                        inputProps={{min: 1, max: 1000}}
                                                                        size="small"
                                                                        value={settings.conversations.initialLoadCount}
                                                                        onChange={handleInitialLoadCountChange}
                                                                />
                                                        }>
                                                        <ListItemText
                                                                primary="Initial load count"
                                                                secondary="Controls how many conversations load in the sidebar at a time"
                                                        />
                                                </ListItem>
                                        </List>

                                        <List
                                                dense
                                                sx={{
                                                        borderRadius: 1,
                                                        border: (theme) => `1px solid ${theme.palette.divider}`
                                                }}
                                                subheader={
                                                        <ListSubheader component="div" disableSticky>
                                                                Debugging
                                                        </ListSubheader>
                                                }>
                                                <ListItem
                                                        secondaryAction={
                                                                <Switch
                                                                        edge="end"
                                                                        checked={settings.developer.blueBubblesDebugLogging}
                                                                        onChange={handleBlueBubblesDebugLoggingChange}
                                                                />
                                                        }>
                                                        <ListItemText
                                                                primary="BlueBubbles console logs"
                                                                secondary="Toggle diagnostic messages from BlueBubbles"
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
