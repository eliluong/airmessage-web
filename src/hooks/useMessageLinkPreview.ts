import {useEffect, useMemo, useState} from "react";
import {find} from "linkifyjs";
import {logBlueBubblesDebug} from "shared/connection/bluebubbles/debugLogging";
import {
        CachedLinkPreview,
        getCachedLinkPreview,
        LinkPreviewData,
        setCachedLinkPreview
} from "shared/util/linkPreviewCache";

export type LinkPreviewStatus = "idle" | "loading" | "ready" | "error";

export interface MessageLinkPreviewState {
        status: LinkPreviewStatus;
        preview?: LinkPreviewData;
        error?: string;
}

interface LinkPreviewResponse {
        title?: string;
        description?: string;
        image?: string;
        url?: string;
        error?: string;
}

type LinkifyResult = ReturnType<typeof find>[number];

function extractFirstUrl(text: string): string | undefined {
        const links = find(text, "url");
        const first = links.find((link: LinkifyResult) => typeof link.href === "string" && link.type === "url");
        if (!first) {
                return undefined;
        }

        try {
                const parsed = new URL(first.href.startsWith("http") ? first.href : `https://${first.href}`);
                if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                        return undefined;
                }

                parsed.hash = "";
                return parsed.toString();
        } catch (error) {
                console.warn("Failed to normalize link preview URL", error);
                return undefined;
        }
}

function computeInitialState(url: string | undefined): MessageLinkPreviewState {
        if (!url) {
                return {status: "idle"};
        }

        const cached = getCachedLinkPreview(url);
        if (cached) {
                if (cached.data) {
                        return {status: "ready", preview: cached.data};
                }

                if (cached.error) {
                        return {status: "error", error: cached.error};
                }
        }

        if (!WPEnv.LINK_PREVIEW_API_KEY) {
                return {status: "idle"};
        }

        return {status: "loading"};
}

function sanitizeResponse(url: string, response: LinkPreviewResponse): LinkPreviewData | undefined {
        if (response.error) {
                throw new Error(response.error);
        }

        const title = response.title?.trim() ?? "";
        const description = response.description?.trim() ?? "";
        const image = response.image?.trim() ?? "";
        const responseUrl = response.url?.trim() ?? url;

        if (!title && !description && !image) {
                return undefined;
        }

        return {
                title,
                description,
                image,
                url: responseUrl
        };
}

export default function useMessageLinkPreview(text: string): MessageLinkPreviewState {
        const normalizedUrl = useMemo(() => extractFirstUrl(text), [text]);
        const [state, setState] = useState<MessageLinkPreviewState>(() => computeInitialState(normalizedUrl));

        useEffect(() => {
                setState(computeInitialState(normalizedUrl));
        }, [normalizedUrl]);

        useEffect(() => {
                if (state.status !== "loading" || !normalizedUrl || !WPEnv.LINK_PREVIEW_API_KEY) {
                        return;
                }

                const cached: CachedLinkPreview | undefined = getCachedLinkPreview(normalizedUrl);
                if (cached?.data) {
                        setState({status: "ready", preview: cached.data});
                        return;
                }

                if (cached?.error) {
                        setState({status: "error", error: cached.error});
                        return;
                }

                const controller = new AbortController();
                const key = WPEnv.LINK_PREVIEW_API_KEY;
                const requestUrl = `https://api.linkpreview.net/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(normalizedUrl)}`;

                logBlueBubblesDebug("Fetching link preview", {requestUrl});

                (async () => {
                        try {
                                const response = await fetch(requestUrl, {signal: controller.signal});
                                if (!response.ok) {
                                        throw new Error(`LinkPreview request failed with status ${response.status}`);
                                }

                                const payload = (await response.json()) as LinkPreviewResponse;
                                logBlueBubblesDebug("LinkPreview response", {requestUrl, payload});
                                const preview = sanitizeResponse(normalizedUrl, payload);
                                if (!preview) {
                                        throw new Error("Link preview response did not include displayable data");
                                }

                                const entry: CachedLinkPreview = {
                                        data: preview,
                                        fetchedAt: Date.now()
                                };
                                setCachedLinkPreview(normalizedUrl, entry);
                                setState({status: "ready", preview});
                        } catch (error) {
                                if ((error as DOMException)?.name === "AbortError") {
                                        return;
                                }

                                logBlueBubblesDebug("LinkPreview request failed", {requestUrl, error});
                                const message = error instanceof Error ? error.message : "Failed to load link preview";
                                setCachedLinkPreview(normalizedUrl, {
                                        data: null,
                                        error: message,
                                        fetchedAt: Date.now()
                                });
                                setState({status: "error", error: message});
                        }
                })();

                return () => {
                        controller.abort();
                };
        }, [normalizedUrl, state.status]);

        return useMemo(() => {
                if (!normalizedUrl) {
                        return {status: "idle"};
                }

                return state;
        }, [normalizedUrl, state]);
}
