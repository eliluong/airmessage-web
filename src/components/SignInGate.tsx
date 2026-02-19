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
import type {BlueBubblesTransportMode} from "shared/connection/bluebubbles/session";
import {getConfiguredBlueBubblesTransportMode} from "shared/connection/bluebubbles/transport";
import {
        BFF_SESSION_ACCESS_TOKEN_PLACEHOLDER,
        fetchBffSessionStatus,
        loginBffSession,
        logoutBffSession
} from "shared/connection/bluebubbles/bff/sessionApi";
import {BffApiError} from "shared/connection/bluebubbles/bff/api";
import {BffSessionStatusData} from "shared/connection/bluebubbles/bff/contracts";

interface BlueBubblesSessionState {
        serverUrl: string;
        accessToken: string;
        socketGuid?: string;
        refreshToken?: string;
        expiresAt?: number;
        deviceName?: string;
        legacyPasswordAuth?: boolean;
        transportMode: BlueBubblesTransportMode;
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
        const transportMode = getConfiguredBlueBubblesTransportMode();
        const [state, setState] = useState(SignInState.Waiting);
        const [session, setSession] = useState<BlueBubblesSessionState | null>(null);
        const [submitState, setSubmitState] = useState<SubmitState>({submitting: false});
        const [initialValues, setInitialValues] = useState<BlueBubblesCredentialValues>({
                serverUrl: "",
                password: "",
                deviceName: ""
        });

        const loadStoredSession = useCallback(async () => {
                const [serverUrl, token, socketGuid, refreshToken, deviceName, expiresAt, legacyAuth] = await Promise.all([
                        getSecureLS(SecureStorageKey.BlueBubblesServerUrl),
                        getSecureLS(SecureStorageKey.BlueBubblesToken),
                        getSecureLS(SecureStorageKey.BlueBubblesSocketGuid),
                        getSecureLS(SecureStorageKey.BlueBubblesRefreshToken),
                        getSecureLS(SecureStorageKey.BlueBubblesDeviceName),
                        getSecureLS(SecureStorageKey.BlueBubblesTokenExpiry),
                        getSecureLS(SecureStorageKey.BlueBubblesLegacyAuth)
                ]);

                const initialServerUrl = serverUrl ?? "";
                const initialDeviceName = deviceName ?? "";
                setInitialValues({
                        serverUrl: initialServerUrl,
                        password: "",
                        deviceName: initialDeviceName
                });

                if(transportMode === "bff") {
                        const status = await fetchBffSessionStatus();
                        const bffSession = buildBffSession(status, transportMode, initialServerUrl, initialDeviceName);
                        if(bffSession) {
                                setSession(bffSession);
                                setState(SignInState.SignedIn);
                                applySentryUser(bffSession);
                        } else {
                                setSession(null);
                                setState(SignInState.SignedOut);
                                applySentryUser(null);
                        }
                        return;
                }

                if(serverUrl && token) {
                        const parsedExpiry = expiresAt !== undefined ? Number(expiresAt) : undefined;
                        const storedSession: BlueBubblesSessionState = {
                                serverUrl,
                                accessToken: token,
                                socketGuid: socketGuid ?? undefined,
                                refreshToken: refreshToken ?? undefined,
                                expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : undefined,
                                deviceName: deviceName ?? undefined,
                                legacyPasswordAuth: legacyAuth === "true",
                                transportMode
                        };

                        setSession(storedSession);
                        setState(SignInState.SignedIn);
                        applySentryUser(storedSession);
                } else {
                        setSession(null);
                        setState(SignInState.SignedOut);
                        applySentryUser(null);
                }
        }, [transportMode]);

        useEffect(() => {
                loadStoredSession().catch((error: unknown) => {
                        console.warn("Failed to load stored BlueBubbles session", error);
                        setState(SignInState.SignedOut);
                });
        }, [loadStoredSession]);

        const persistSession = useCallback(async (value: BlueBubblesSessionState | null) => {
                if(transportMode === "bff") {
                        await Promise.all([
                                setSecureLS(SecureStorageKey.BlueBubblesServerUrl, value?.serverUrl),
                                setSecureLS(SecureStorageKey.BlueBubblesToken, undefined),
                                setSecureLS(SecureStorageKey.BlueBubblesSocketGuid, undefined),
                                setSecureLS(SecureStorageKey.BlueBubblesRefreshToken, undefined),
                                setSecureLS(SecureStorageKey.BlueBubblesDeviceName, value?.deviceName),
                                setSecureLS(SecureStorageKey.BlueBubblesTokenExpiry, undefined),
                                setSecureLS(SecureStorageKey.BlueBubblesLegacyAuth, undefined)
                        ]);
                        return;
                }

                await Promise.all([
                        setSecureLS(SecureStorageKey.BlueBubblesServerUrl, value?.serverUrl),
                        setSecureLS(SecureStorageKey.BlueBubblesToken, value?.accessToken),
                        setSecureLS(SecureStorageKey.BlueBubblesSocketGuid, value?.socketGuid),
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
        }, [transportMode]);

        const handleAuthResult = useCallback(async (
                credentials: BlueBubblesCredentialValues,
                authResult: BlueBubblesAuthResult,
                fallbackSocketGuid?: string
        ) => {
                const sanitizedServerUrl = credentials.serverUrl.trim();
                const sanitizedDevice = credentials.deviceName?.trim() ?? undefined;
                const sanitizedSocketGuid = normalizeSocketGuid(authResult.socketGuid) ?? normalizeSocketGuid(fallbackSocketGuid);
                const nextSession: BlueBubblesSessionState = {
                        serverUrl: sanitizedServerUrl,
                        accessToken: authResult.accessToken,
                        socketGuid: sanitizedSocketGuid,
                        refreshToken: authResult.refreshToken,
                        expiresAt: authResult.expiresAt,
                        deviceName: sanitizedDevice,
                        legacyPasswordAuth: authResult.legacyPasswordAuth,
                        transportMode
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
        }, [persistSession, transportMode]);

        const handleError = useCallback((error: unknown) => {
                let message = "Unable to connect to the BlueBubbles server.";
                if(error instanceof InvalidCertificateError) {
                        message = "The server certificate is invalid or untrusted. Try installing a trusted certificate or connecting over http:// if your network is secure.";
                } else if(error instanceof MissingPrivateApiError) {
                        message = "This BlueBubbles server is missing required private API features.";
                } else if(error instanceof BlueBubblesAuthError || error instanceof BffApiError) {
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

                        if(transportMode === "bff") {
                                const sessionStatus = await loginBffSession({
                                        serverUrl: payload.serverUrl,
                                        password: payload.password,
                                        deviceName: payload.deviceName,
                                        action
                                });
                                const bffSession = buildBffSession(sessionStatus, transportMode, payload.serverUrl, payload.deviceName ?? "");
                                if(!bffSession) {
                                        throw new Error("BFF login succeeded but no authenticated session was returned.");
                                }

                                await persistSession(bffSession);
                                setSession(bffSession);
                                setState(SignInState.SignedIn);
                                setInitialValues({
                                        serverUrl: bffSession.serverUrl,
                                        password: "",
                                        deviceName: bffSession.deviceName ?? ""
                                });
                                applySentryUser(bffSession);
                        } else {
                                const authResult = action === "register"
                                        ? await registerBlueBubblesDevice(payload)
                                        : await loginBlueBubblesDevice(payload);
                                await handleAuthResult(payload, authResult, payload.password);
                        }

                        setSubmitState({submitting: false});
                } catch(error) {
                        handleError(error);
                        setState(SignInState.SignedOut);
                }
        }, [handleAuthResult, handleError, persistSession, transportMode]);

        const signOutAccount = useCallback(async () => {
                if(transportMode === "bff") {
                        try {
                                await logoutBffSession();
                        } catch(error) {
                                console.warn("Failed to sign out BFF session", error);
                        }
                }

                await persistSession(null);
                setSession(null);
                setState(SignInState.SignedOut);
                setSubmitState({submitting: false});
                applySentryUser(null);
        }, [persistSession, transportMode]);

        useEffect(() => {
                if(transportMode === "bff") return;
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
                                }, refreshed, session.socketGuid);
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
        }, [state, session, handleAuthResult, handleError, signOutAccount, transportMode]);

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
                                        transportMode={transportMode}
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
                                                socketGuid={session.socketGuid}
                                                refreshToken={session.refreshToken}
                                                legacyPasswordAuth={session.legacyPasswordAuth}
                                                deviceName={session.deviceName}
                                                transportMode={session.transportMode}
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

function normalizeSocketGuid(value: string | undefined): string | undefined {
        const normalized = value?.trim();
        return normalized && normalized.length > 0 ? normalized : undefined;
}

function buildBffSession(
        status: BffSessionStatusData,
        transportMode: BlueBubblesTransportMode,
        fallbackServerUrl: string,
        fallbackDeviceName: string
): BlueBubblesSessionState | null {
        if(!status.authenticated) return null;

        const serverUrl = status.serverUrl?.trim() || fallbackServerUrl.trim();
        if(!serverUrl) {
                throw new Error("BFF session status is missing server URL.");
        }

        const deviceName = status.deviceName?.trim() || fallbackDeviceName.trim() || undefined;
        return {
                serverUrl,
                accessToken: BFF_SESSION_ACCESS_TOKEN_PLACEHOLDER,
                deviceName,
                transportMode
        };
}
