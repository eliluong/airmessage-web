import React from "react";
import {createTheme, ThemeProvider} from "@mui/material/styles";
import {CssBaseline, useMediaQuery} from "@mui/material";
import {useSettings} from "shared/components/settings/SettingsProvider";

export default function AppTheme(props: {children: React.ReactNode}) {
        const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
        const {settings} = useSettings();

        const paletteMode = settings.appearance.colorScheme === "system"
                ? (prefersDarkMode ? "dark" : "light")
                : settings.appearance.colorScheme;

        const theme = React.useMemo(() => createTheme({
                typography: {
                        fontFamily: [
				'"Noto Emoji COLRv1"',
				"-apple-system",
				"BlinkMacSystemFont",
				'"Segoe UI"',
				"Roboto",
				'"Helvetica Neue"',
				"Arial",
				"sans-serif",
				'"Apple Color Emoji"',
                '"Segoe UI Emoji"',
                '"Segoe UI Symbol"',
                        ].join(","),
		},
                palette: {
                        mode: paletteMode,
                        primary: {
                                main: "#448AFF",
                                dark: "#366FCC",
                                light: "#52A7FF",
                        },
                        messageIncoming: paletteMode === "dark" ? {
                                main: "#393939",
                                contrastText: "#FFF"
                        } : {
                                main: "#EDEDED",
                                contrastText: "rgba(0, 0, 0, 0.87)"
                        },
			messageOutgoing: {
				main: "#448AFF",
				contrastText: "#FFF",
			},
			messageOutgoingTextMessage: {
				main: "#2ECC71",
				contrastText: "#FFF",
			},
                        divider: paletteMode === "dark" ? "rgba(255, 255, 255, 0.1)" : "#EEEEEE",
                        background: {
                                default: paletteMode === "dark" ? "#1E1E1E" : "#FFFFFF",
                                sidebar: paletteMode === "dark" ? "#272727" : "#FAFAFA"
                        }
                },
		components: {
                        MuiCssBaseline: {
                                styleOverrides: {
                                        "@global": {
                                                html: {
                                                        scrollbarColor: paletteMode === "dark" ? "#303030 #424242" : undefined
                                                }
                                        }
                                }
                        }
                }
        }), [paletteMode]);

        return (
                <ThemeProvider theme={theme}>
			<CssBaseline />
			{props.children}
		</ThemeProvider>
	);
}

declare module "@mui/material/styles/createPalette" {
	interface Palette {
		messageIncoming: Palette["primary"];
		messageOutgoing: Palette["primary"];
		messageOutgoingTextMessage: Palette["primary"];
	}
	
	interface PaletteOptions {
		messageIncoming?: PaletteOptions["primary"];
		messageOutgoing?: PaletteOptions["primary"];
		messageOutgoingTextMessage?: PaletteOptions["primary"];
	}
	
	interface TypeBackground {
		sidebar: string;
	}
}
