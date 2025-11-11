import {
        clearLinkPreviewCache,
        getCachedLinkPreview,
        LINK_PREVIEW_CACHE_TTL_MS,
        setCachedLinkPreview
} from "shared/util/linkPreviewCache";
import {LinkPreviewData} from "shared/util/linkPreviewCache";

describe("linkPreviewCache", () => {
        const samplePreview: LinkPreviewData = {
                title: "AirMessage",
                description: "iMessage in your browser",
                image: "https://example.com/image.png",
                url: "https://airmessage.org"
        };

        beforeEach(() => {
                jest.restoreAllMocks();
                clearLinkPreviewCache();
                window.localStorage.clear();
        });

        it("stores and retrieves cached previews", () => {
                const url = "https://example.com";
                const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);

                setCachedLinkPreview(url, {data: samplePreview, fetchedAt: Date.now()});

                const cached = getCachedLinkPreview(url);
                expect(cached).toBeDefined();
                expect(cached?.data).toEqual(samplePreview);

                const persisted = window.localStorage.getItem("linkPreviewCache");
                expect(persisted).not.toBeNull();
                expect(persisted && JSON.parse(persisted)[url].data.title).toBe(samplePreview.title);

                nowSpy.mockRestore();
        });

        it("expires cache entries after the TTL", () => {
                const url = "https://example.com/post";
                const nowSpy = jest.spyOn(Date, "now");

                nowSpy.mockReturnValue(5_000);
                setCachedLinkPreview(url, {data: samplePreview, fetchedAt: Date.now()});

                nowSpy.mockReturnValue(5_000 + LINK_PREVIEW_CACHE_TTL_MS + 1);
                expect(getCachedLinkPreview(url)).toBeUndefined();
                expect(window.localStorage.getItem("linkPreviewCache")).toBe("{}");

                nowSpy.mockRestore();
        });

        it("clears cached previews", () => {
                const url = "https://example.com/another";
                setCachedLinkPreview(url, {data: samplePreview, fetchedAt: Date.now()});

                clearLinkPreviewCache();
                expect(getCachedLinkPreview(url)).toBeUndefined();
                expect(window.localStorage.getItem("linkPreviewCache")).toBeNull();
        });
});
