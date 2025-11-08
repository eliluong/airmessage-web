import React from "react";
import {createRoot} from "react-dom/client";
import * as Sentry from "@sentry/react";
import SignInGate from "shared/components/SignInGate";
import AppTheme from "./components/control/AppTheme";
import {SettingsProvider} from "shared/components/settings/SettingsProvider";
import {setNotificationUtils} from "shared/interface/notification/notificationUtils";
import BrowserNotificationUtils from "shared/interface/notification/browserNotificationUtils";
import {setPlatformUtils} from "shared/interface/platform/platformUtils";
import BrowserPlatformUtils from "shared/interface/platform/browserPlatformUtils";

//Set platform-specific utilities
setNotificationUtils(new BrowserNotificationUtils());
setPlatformUtils(new BrowserPlatformUtils());

//Initializing Sentry
const sentryDSN = WPEnv.SENTRY_DSN;
if(WPEnv.ENVIRONMENT === "production" && sentryDSN) {
        Sentry.init({
                dsn: sentryDSN,
                release: "airmessage-web@" + WPEnv.PACKAGE_VERSION,
                environment: WPEnv.ENVIRONMENT
        });
}

// Check that service workers are supported
if(WPEnv.ENVIRONMENT === "production" && "serviceWorker" in navigator) {
	// Use the window load event to keep the page load performant
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/service-worker.js");
	});
}

//Initializing React
const root = createRoot(document.getElementById("root")!);
root.render(
        <React.StrictMode>
                <SettingsProvider>
                        <AppTheme>
                                <SignInGate />
                        </AppTheme>
                </SettingsProvider>
        </React.StrictMode>
);