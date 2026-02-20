type FaviconBadgeModule = typeof import("shared/util/faviconBadge");

const ORIGINAL_IMAGE = global.Image;
const MOCK_BADGED_DATA_URL = "data:image/png;base64,badged-favicon";

class MockImage {
        static failLoads = false;

        public onload: ((event: Event) => void) | null = null;
        public onerror: ((event: Event) => void) | null = null;
        public decoding = "";

        private _src = "";

        set src(value: string) {
                this._src = value;

                setTimeout(() => {
                        if(MockImage.failLoads) {
                                this.onerror?.(new Event("error"));
                                return;
                        }

                        this.onload?.(new Event("load"));
                }, 0);
        }

        get src(): string {
                return this._src;
        }
}

function createIconLinks(): {primaryLink: HTMLLinkElement; secondaryLink: HTMLLinkElement} {
        const primaryLink = document.createElement("link");
        primaryLink.rel = "icon";
        primaryLink.setAttribute("sizes", "32x32");
        primaryLink.href = "/favicon-32.png";

        const secondaryLink = document.createElement("link");
        secondaryLink.rel = "shortcut icon";
        secondaryLink.setAttribute("sizes", "57x57");
        secondaryLink.href = "/favicon-57.png";

        document.head.appendChild(primaryLink);
        document.head.appendChild(secondaryLink);

        return {primaryLink, secondaryLink};
}

async function flushAsync(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
}

async function importFaviconBadgeModule(): Promise<FaviconBadgeModule> {
        return await import("shared/util/faviconBadge");
}

describe("faviconBadge utility", () => {
        beforeEach(() => {
                jest.resetModules();
                jest.restoreAllMocks();

                MockImage.failLoads = false;
                Object.defineProperty(global, "Image", {
                        configurable: true,
                        writable: true,
                        value: MockImage
                });

                const mockContext = {
                        clearRect: jest.fn(),
                        drawImage: jest.fn(),
                        beginPath: jest.fn(),
                        arc: jest.fn(),
                        fill: jest.fn(),
                        stroke: jest.fn(),
                        fillStyle: "",
                        strokeStyle: "",
                        lineWidth: 0
                } as unknown as CanvasRenderingContext2D;

                jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockContext);
                jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(MOCK_BADGED_DATA_URL);

                document.head.innerHTML = "";
        });

        afterEach(() => {
                jest.restoreAllMocks();

                Object.defineProperty(global, "Image", {
                        configurable: true,
                        writable: true,
                        value: ORIGINAL_IMAGE
                });

                document.head.innerHTML = "";
        });

        it("initializes icon links and toggles between original and badged favicon hrefs", async () => {
                const {primaryLink, secondaryLink} = createIconLinks();
                const originalPrimaryHref = primaryLink.href;
                const originalSecondaryHref = secondaryLink.href;

                const faviconBadge = await importFaviconBadgeModule();
                faviconBadge.initializeFaviconBadge();

                faviconBadge.setFaviconBadgeVisible(true);
                await flushAsync();

                expect(primaryLink.href).toBe(MOCK_BADGED_DATA_URL);
                expect(secondaryLink.href).toBe(MOCK_BADGED_DATA_URL);

                faviconBadge.setFaviconBadgeVisible(false);

                expect(primaryLink.href).toBe(originalPrimaryHref);
                expect(secondaryLink.href).toBe(originalSecondaryHref);
        });

        it("is a no-op before initialization", async () => {
                const {primaryLink, secondaryLink} = createIconLinks();
                const originalPrimaryHref = primaryLink.href;
                const originalSecondaryHref = secondaryLink.href;

                const faviconBadge = await importFaviconBadgeModule();
                faviconBadge.setFaviconBadgeVisible(true);
                faviconBadge.clearFaviconBadge();
                await flushAsync();

                expect(primaryLink.href).toBe(originalPrimaryHref);
                expect(secondaryLink.href).toBe(originalSecondaryHref);
        });

        it("tolerates image-load failure and keeps original favicon hrefs", async () => {
                const {primaryLink, secondaryLink} = createIconLinks();
                const originalPrimaryHref = primaryLink.href;
                const originalSecondaryHref = secondaryLink.href;

                MockImage.failLoads = true;

                const faviconBadge = await importFaviconBadgeModule();
                faviconBadge.initializeFaviconBadge();

                faviconBadge.setFaviconBadgeVisible(true);
                await flushAsync();

                expect(primaryLink.href).toBe(originalPrimaryHref);
                expect(secondaryLink.href).toBe(originalSecondaryHref);
        });
});
