import React, {useCallback, useContext, useMemo} from "react";
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
import {SnackbarContext} from "shared/components/control/SnackbarProvider";
import {AddressBookSourceStatus, AddressBookSyncError, PeopleContext} from "shared/state/peopleState";

const COLOR_SCHEME_LABEL: Record<SettingsColorScheme, string> = {
        system: "System default",
        light: "Light",
        dark: "Dark"
};

export default function SettingsDialog(props: {isOpen: boolean; onDismiss: () => void}) {
        const {settings, updateSettings} = useSettings();
        const peopleState = useContext(PeopleContext);
        const displaySnackbar = useContext(SnackbarContext);
        const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);
        const dateFormatter = useMemo(
                () => new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}),
                []
        );
        const orderedSourceIds = useMemo(() => peopleState.sources.map((source) => source.id), [peopleState.sources]);
        const defaultEnabledIds = useMemo(
                () => peopleState.sources.filter((source) => source.defaultEnabled).map((source) => source.id),
                [peopleState.sources]
        );

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

        const handleToggleSource = useCallback(
                (sourceId: string, nextEnabled: boolean) => {
                        updateSettings((previous) => {
                                const currentSources = peopleState.sources;
                                const previousEnabled = previous.addressBook.enabledSourceIds;
                                const activeSet = new Set(
                                        previousEnabled ?? currentSources.filter((source) => source.enabled).map((source) => source.id)
                                );

                                if(nextEnabled) {
                                        activeSet.add(sourceId);
                                } else {
                                        activeSet.delete(sourceId);
                                }

                                const nextIds = orderedSourceIds.filter((id) => activeSet.has(id));
                                const matchesDefault =
                                        nextIds.length === defaultEnabledIds.length &&
                                        nextIds.every((id) => defaultEnabledIds.includes(id));

                                return {
                                        ...previous,
                                        addressBook: {
                                                ...previous.addressBook,
                                                enabledSourceIds: matchesDefault ? undefined : nextIds
                                        }
                                };
                        });
                },
                [defaultEnabledIds, orderedSourceIds, peopleState.sources, updateSettings]
        );

        const handleSourceSwitchChange = useCallback(
                (sourceId: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
                        handleToggleSource(sourceId, event.target.checked);
                },
                [handleToggleSource]
        );

        const handleSyncSource = useCallback(
                async (source: AddressBookSourceStatus) => {
                        if(peopleState.isSyncing || source.isSyncing) {
                                return;
                        }

                        try {
                                await peopleState.syncAddressBooks([source.id]);
                        } catch(error) {
                                let message = "Failed to sync address book.";
                                if(error instanceof AddressBookSyncError) {
                                        if(error.sources.length === 1) {
                                                const failed = error.sources[0];
                                                message = `Failed to sync ${failed.label}: ${failed.message}`;
                                        } else {
                                                message = error.message;
                                        }
                                } else if(error instanceof Error && error.message) {
                                        message = error.message;
                                }

                                displaySnackbar({message});
                        }
                },
                [displaySnackbar, peopleState]
        );

        const handleClearSource = useCallback(
                (source: AddressBookSourceStatus) => {
                        if(peopleState.isSyncing || source.isSyncing) {
                                return;
                        }

                        peopleState.clearAddressBookCache(source.id);
                        displaySnackbar({message: `Cleared cached contacts for ${source.label}.`});
                },
                [displaySnackbar, peopleState]
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
                                                                Contacts
                                                        </ListSubheader>
                                                }>
                                                {peopleState.sources.length === 0 ? (
                                                        <ListItem>
                                                                <ListItemText
                                                                        primary="No address books available"
                                                                        secondary="Add address book sources to your manifest to enable contact sync."
                                                                />
                                                        </ListItem>
                                                ) : (
                                                        peopleState.sources.map((source) => {
                                                                const contactCountLabel = `${numberFormatter.format(source.peopleCount)} contact${source.peopleCount === 1 ? "" : "s"}`;
                                                                let primaryStatus: string;
                                                                if(source.isSyncing) {
                                                                        primaryStatus = "Syncing…";
                                                                } else if(source.syncedAt) {
                                                                        const parsedDate = new Date(source.syncedAt);
                                                                        const formattedDate = Number.isNaN(parsedDate.getTime())
                                                                                ? source.syncedAt
                                                                                : dateFormatter.format(parsedDate);
                                                                        primaryStatus = `Last synced ${formattedDate} · ${contactCountLabel}`;
                                                                } else if(source.peopleCount > 0) {
                                                                        primaryStatus = `Cached ${contactCountLabel}`;
                                                                } else {
                                                                        primaryStatus = "Not synced yet";
                                                                }

                                                                const actionsDisabled = peopleState.isSyncing || source.isSyncing;
                                                                const canClearCache = Boolean(
                                                                        source.syncedAt ||
                                                                        source.peopleCount > 0 ||
                                                                        source.error
                                                                );

                                                                return (
                                                                        <ListItem
                                                                                key={source.id}
                                                                                alignItems="flex-start"
                                                                                secondaryAction={
                                                                                        <Stack direction="row" spacing={1} alignItems="center">
                                                                                                <Button
                                                                                                        variant="outlined"
                                                                                                        size="small"
                                                                                                        onClick={() => {
                                                                                                                void handleSyncSource(source);
                                                                                                        }}
                                                                                                        disabled={actionsDisabled}
                                                                                                >
                                                                                                        {source.isSyncing ? "Syncing…" : "Sync now"}
                                                                                                </Button>
                                                                                                <Button
                                                                                                        variant="text"
                                                                                                        size="small"
                                                                                                        color="inherit"
                                                                                                        disabled={actionsDisabled || !canClearCache}
                                                                                                        onClick={() => handleClearSource(source)}
                                                                                                >
                                                                                                        Clear data
                                                                                                </Button>
                                                                                                <Switch
                                                                                                        edge="end"
                                                                                                        checked={source.enabled}
                                                                                                        onChange={handleSourceSwitchChange(source.id)}
                                                                                                        disabled={actionsDisabled}
                                                                                                        inputProps={{"aria-label": `Toggle ${source.label}`}}
                                                                                                />
                                                                                        </Stack>
                                                                                }
                                                                        >
                                                                                <ListItemText
                                                                                        primary={source.label}
                                                                                        secondary={
                                                                                                <Stack spacing={0.5}>
                                                                                                        <Typography variant="body2" color="textSecondary">
                                                                                                                {primaryStatus}
                                                                                                        </Typography>
                                                                                                        {source.error ? (
                                                                                                                <Typography variant="body2" color="error.main">
                                                                                                                        {`Last sync failed: ${source.error}`}
                                                                                                                </Typography>
                                                                                                        ) : null}
                                                                                                        {source.needsUpdate ? (
                                                                                                                <Typography variant="caption" color="warning.main">
                                                                                                                        Update available
                                                                                                                </Typography>
                                                                                                        ) : null}
                                                                                                </Stack>
                                                                                        }
                                                                                        secondaryTypographyProps={{component: "div"}}
                                                                                />
                                                                        </ListItem>
                                                                );
                                                        })
                                                )}
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
