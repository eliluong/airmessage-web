import React, {useCallback, useEffect, useMemo, useState} from "react";
import * as Sentry from "@sentry/react";
import Onboarding, {BlueBubblesCredentialValues} from "shared/components/Onboarding";
import Messaging from "shared/components/messaging/master/Messaging";
import LoginContext from "shared/components/LoginContext";
import {
        getSecureLS,
        SecureStorageKey,
        setSecureLS
} from "shared/util/secureStorageUtils";
import {
        BlueBubblesAuthError,
        BlueBubblesAuthResult,
        InvalidCertificateError,
        MissingPrivateApiError,
        loginBlueBubblesDevice,
        refreshBlueBubblesToken,
        registerBlueBubblesDevice,
        shouldRefreshToken
} from "shared/util/bluebubblesAuth";

interface BlueBubblesSessionState {
        serverUrl: string;
        accessToken: string;
        refreshToken?: string;
        expiresAt?: number;
        deviceName?: string;
        legacyPasswordAuth?: boolean;
}

enum SignInState {
        Waiting,
        SignedOut,
        SignedIn
}

interface SubmitState {
        submitting: boolean;
        error?: string;
}

export default function SignInGate() {
        const [state, setState] = useState(SignInState.Waiting);
        const [session, setSession] = useState<BlueBubblesSessionState | null>(null);
        const [submitState, setSubmitState] = useState<SubmitState>({submitting: false});
        const [initialValues, setInitialValues] = useState<BlueBubblesCredentialValues>({
                serverUrl: "",
                password: "",
                deviceName: ""
        });

        const loadStoredSession = useCallback(async () => {
                const [serverUrl, token, refreshToken, deviceName, expiresAt, legacyAuth] = await Promise.all([
                        getSecureLS(SecureStorageKey.BlueBubblesServerUrl),
                        getSecureLS(SecureStorageKey.BlueBubblesToken),
                        getSecureLS(SecureStorageKey.BlueBubblesRefreshToken),
                        getSecureLS(SecureStorageKey.BlueBubblesDeviceName),
                        getSecureLS(SecureStorageKey.BlueBubblesTokenExpiry),
                        getSecureLS(SecureStorageKey.BlueBubblesLegacyAuth)
                ]);

                setInitialValues({
                        serverUrl: serverUrl ?? "",
                        password: "",
                        deviceName: deviceName ?? ""
                });

                if(serverUrl && token) {
                        const parsedExpiry = expiresAt !== undefined ? Number(expiresAt) : undefined;
                        const storedSession: BlueBubblesSessionState = {
                                serverUrl,
                                accessToken: token,
                                refreshToken: refreshToken ?? undefined,
                                expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : undefined,
                                deviceName: deviceName ?? undefined,
                                legacyPasswordAuth: legacyAuth === "true"
                        };

                        setSession(storedSession);
                        setState(SignInState.SignedIn);
                        applySentryUser(storedSession);
                } else {
                        setSession(null);
                        setState(SignInState.SignedOut);
                        applySentryUser(null);
                }
        }, []);

        useEffect(() => {
                loadStoredSession().catch((error: unknown) => {
                        console.warn("Failed to load stored BlueBubbles session", error);
                        setState(SignInState.SignedOut);
                });
        }, [loadStoredSession]);

        const persistSession = useCallback(async (value: BlueBubblesSessionState | null) => {
                await Promise.all([
                        setSecureLS(SecureStorageKey.BlueBubblesServerUrl, value?.serverUrl),
                        setSecureLS(SecureStorageKey.BlueBubblesToken, value?.accessToken),
                        setSecureLS(SecureStorageKey.BlueBubblesRefreshToken, value?.refreshToken),
                        setSecureLS(SecureStorageKey.BlueBubblesDeviceName, value?.deviceName),
                        setSecureLS(
                                SecureStorageKey.BlueBubblesTokenExpiry,
                                value?.expiresAt !== undefined ? value.expiresAt.toString() : undefined
                        ),
                        setSecureLS(
                                SecureStorageKey.BlueBubblesLegacyAuth,
                                value?.legacyPasswordAuth ? "true" : undefined
                        )
                ]);
        }, []);

        const handleAuthResult = useCallback(async (
                credentials: BlueBubblesCredentialValues,
                authResult: BlueBubblesAuthResult
        ) => {
                const sanitizedServerUrl = credentials.serverUrl.trim();
                const sanitizedDevice = credentials.deviceName?.trim() ?? undefined;
                const nextSession: BlueBubblesSessionState = {
                        serverUrl: sanitizedServerUrl,
                        accessToken: authResult.accessToken,
                        refreshToken: authResult.refreshToken,
                        expiresAt: authResult.expiresAt,
                        deviceName: sanitizedDevice,
                        legacyPasswordAuth: authResult.legacyPasswordAuth
                };

                await persistSession(nextSession);
                setSession(nextSession);
                setState(SignInState.SignedIn);
                setInitialValues({
                        serverUrl: sanitizedServerUrl,
                        password: "",
                        deviceName: sanitizedDevice ?? ""
                });
                applySentryUser(nextSession);
        }, [persistSession]);

        const handleError = useCallback((error: unknown) => {
                let message = "Unable to connect to the BlueBubbles server.";
                if(error instanceof InvalidCertificateError) {
                        message = "The server certificate is invalid or untrusted. Try installing a trusted certificate or connecting over http:// if your network is secure.";
                } else if(error instanceof MissingPrivateApiError) {
                        message = "This BlueBubbles server is missing required private API features.";
                } else if(error instanceof BlueBubblesAuthError) {
                        message = error.message;
                } else if(error instanceof Error && error.message) {
                        message = error.message;
                }

                console.warn("BlueBubbles authentication failed", error);
                setSubmitState({submitting: false, error: message});
        }, []);

        const handleSubmit = useCallback(async (values: BlueBubblesCredentialValues, action: "login" | "register") => {
                setSubmitState({submitting: true});

                try {
                        const payload: BlueBubblesCredentialValues = {
                                serverUrl: values.serverUrl.trim(),
                                password: values.password.trim(),
                                deviceName: values.deviceName?.trim() ?? undefined
                        };

                        const authResult = action === "register"
                                ? await registerBlueBubblesDevice(payload)
                                : await loginBlueBubblesDevice(payload);

                        await handleAuthResult(payload, authResult);
                        setSubmitState({submitting: false});
                } catch(error) {
                        handleError(error);
                        setState(SignInState.SignedOut);
                }
        }, [handleAuthResult, handleError]);

        const signOutAccount = useCallback(async () => {
                await persistSession(null);
                setSession(null);
                setState(SignInState.SignedOut);
                setSubmitState({submitting: false});
                applySentryUser(null);
        }, [persistSession]);

        useEffect(() => {
                if(state !== SignInState.SignedIn || !session?.refreshToken || session.legacyPasswordAuth) return;
                if(!shouldRefreshToken({
                        accessToken: session.accessToken,
                        refreshToken: session.refreshToken,
                        expiresAt: session.expiresAt,
                        legacyPasswordAuth: session.legacyPasswordAuth
                })) return;

                let cancelled = false;
                (async () => {
                        try {
                                const refreshed = await refreshBlueBubblesToken(session.serverUrl, session.refreshToken!);
                                if(cancelled) return;
                                await handleAuthResult({
                                        serverUrl: session.serverUrl,
                                        password: "",
                                        deviceName: session.deviceName
                                }, refreshed);
                        } catch(error) {
                                if(cancelled) return;
                                console.warn("Failed to refresh BlueBubbles token", error);
                                handleError(error);
                                await signOutAccount();
                        }
                })();

                return () => {
                        cancelled = true;
                };
        }, [state, session, handleAuthResult, handleError, signOutAccount]);

        const onboardingInitialValues = useMemo<BlueBubblesCredentialValues>(() => initialValues, [initialValues]);

        let main: React.ReactElement | null;
        switch(state) {
                case SignInState.Waiting:
                        main = null;
                        break;
                case SignInState.SignedOut:
                        main = (
                                <Onboarding
                                        initialValues={onboardingInitialValues}
                                        submitting={submitState.submitting}
                                        error={submitState.error}
                                        onSubmit={handleSubmit}
                                />
                        );
                        break;
                case SignInState.SignedIn:
                        if(session === null) {
                                main = null;
                        } else {
                                main = (
                                        <Messaging
                                                serverUrl={session.serverUrl}
                                                accessToken={session.accessToken}
                                                refreshToken={session.refreshToken}
                                                legacyPasswordAuth={session.legacyPasswordAuth}
                                                deviceName={session.deviceName}
                                                onReset={signOutAccount}
                                        />
                                );
                        }
                        break;
        }

        return (
                <LoginContext.Provider value={{
                        signOut: () => {
                                void signOutAccount();
                        }
                }}>
                        {main}
                </LoginContext.Provider>
        );
}

function applySentryUser(session: BlueBubblesSessionState | null) {
        if(session === null) {
                Sentry.setUser(null);
        } else {
                Sentry.setUser({
                        id: session.serverUrl,
                        username: session.deviceName
                });
        }
}
