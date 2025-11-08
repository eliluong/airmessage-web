import React, {useCallback, useEffect, useMemo, useState} from "react";
import {
        Alert,
        Box,
        Button,
        Divider,
        Stack,
        TextField,
        Typography
} from "@mui/material";
import AirMessageLogo from "shared/components/logo/AirMessageLogo";

export interface BlueBubblesCredentialValues {
        serverUrl: string;
        password: string;
        deviceName?: string;
}

export interface OnboardingProps {
        initialValues: BlueBubblesCredentialValues;
        submitting?: boolean;
        error?: string;
        onSubmit: (values: BlueBubblesCredentialValues, action: "login" | "register") => void;
}

interface ValidationState {
        serverUrl?: string;
        serverUrlWarning?: string;
        password?: string;
}

export default function Onboarding(props: OnboardingProps) {
        const [values, setValues] = useState<BlueBubblesCredentialValues>(props.initialValues);
        const [touched, setTouched] = useState<{[K in keyof ValidationState]?: boolean}>({});

        useEffect(() => {
                setValues(props.initialValues);
                setTouched({});
        }, [props.initialValues]);

        const validation = useMemo<ValidationState>(() => {
                const result: ValidationState = {};
                const trimmedUrl = values.serverUrl.trim();
                if(trimmedUrl.length === 0) {
                        result.serverUrl = "Enter the address of your BlueBubbles server.";
                } else {
                        try {
                                const url = new URL(trimmedUrl);
                                if(url.protocol !== "https:" && url.protocol !== "http:") {
                                        result.serverUrl = "Enter a valid HTTP or HTTPS address.";
                                } else if(url.protocol === "http:") {
                                        result.serverUrlWarning = "Connections over HTTP are not encrypted.";
                                }
                        } catch {
                                result.serverUrl = "Enter a valid server URL.";
                        }
                }

                if(values.password.trim().length === 0) {
                        result.password = "Enter the API password or token configured on your server.";
                }

                return result;
        }, [values]);

        const updateField = useCallback(<K extends keyof BlueBubblesCredentialValues>(field: K, value: BlueBubblesCredentialValues[K]) => {
                setValues((current) => ({
                        ...current,
                        [field]: value
                }));
        }, []);

        const handleBlur = useCallback((field: keyof ValidationState) => {
                setTouched((current) => ({
                        ...current,
                        [field]: true
                }));
        }, []);

        const handleSubmit = useCallback((action: "login" | "register") => {
                setTouched({serverUrl: true, password: true});
                if(validation.serverUrl || validation.password) return;
                props.onSubmit(values, action);
        }, [props, validation, values]);

        const submitting = props.submitting ?? false;

        return (
                <Stack
                        sx={{width: "100%", height: "100%"}}
                        alignItems="center"
                        justifyContent="center"
                        padding={4}>
                        <Box sx={{position: "absolute", top: 0, left: 0}} padding={2}>
                                <AirMessageLogo />
                        </Box>

                        <Stack spacing={4} maxWidth={520} width="100%">
                                <Stack spacing={1}>
                                        <Typography variant="h4">Connect to your BlueBubbles server</Typography>
                                        <Typography color="text.secondary">
                                                Enter your server information to sign in. You can register a new device label, or sign in with an existing one.
                                        </Typography>
                                </Stack>

                                {props.error && (
                                        <Alert severity="error">{props.error}</Alert>
                                )}

                                <Stack spacing={3}>
                                        <TextField
                                                label="Server URL"
                                                placeholder="https://example.bubbles.app"
                                                value={values.serverUrl}
                                                onChange={(event) => updateField("serverUrl", event.target.value)}
                                                onBlur={() => handleBlur("serverUrl")}
                                                error={touched.serverUrl && Boolean(validation.serverUrl)}
                                                helperText={touched.serverUrl ? (validation.serverUrl ?? validation.serverUrlWarning) : undefined}
                                                disabled={submitting}
                                                fullWidth
                                        />
                                        <TextField
                                                label="API password or token"
                                                type="password"
                                                value={values.password}
                                                onChange={(event) => updateField("password", event.target.value)}
                                                onBlur={() => handleBlur("password")}
                                                error={touched.password && Boolean(validation.password)}
                                                helperText={touched.password ? validation.password : undefined}
                                                disabled={submitting}
                                                fullWidth
                                        />
                                        <TextField
                                                label="Device label (optional)"
                                                value={values.deviceName ?? ""}
                                                onChange={(event) => updateField("deviceName", event.target.value)}
                                                disabled={submitting}
                                                fullWidth
                                                helperText="Used to identify this browser in the BlueBubbles server UI."
                                        />
                                </Stack>

                                <Divider flexItem />

                                <Stack direction={{xs: "column", sm: "row"}} spacing={2}>
                                        <Button
                                                variant="contained"
                                                color="primary"
                                                onClick={() => handleSubmit("login")}
                                                disabled={submitting}
                                                fullWidth>
                                                Sign in
                                        </Button>
                                        <Button
                                                variant="outlined"
                                                color="primary"
                                                onClick={() => handleSubmit("register")}
                                                disabled={submitting}
                                                fullWidth>
                                                Register device
                                        </Button>
                                </Stack>
                        </Stack>
                </Stack>
        );
}
