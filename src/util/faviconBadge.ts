type FaviconLinkSnapshot = {
	linkElement: HTMLLinkElement;
	originalHref: string;
};

const BADGE_CANVAS_SIZE = 32;
const BADGE_RADIUS = 5;
const BADGE_OFFSET = 2;
const BADGE_COLOR = "#ff3b30";
const BADGE_BORDER_COLOR = "#ffffff";
const BADGE_BORDER_WIDTH = 1.5;

class FaviconBadgeManager {
	private initialized = false;
	private badgeVisible = false;
	private faviconLinks: FaviconLinkSnapshot[] = [];
	private badgedHref: string | undefined;
	private badgedHrefPromise: Promise<string | undefined> | undefined;

	initialize(): void {
		if(this.initialized) return;
		if(typeof document === "undefined") return;

		const faviconLinks = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~=\"icon\"]"));
		this.faviconLinks = faviconLinks
			.filter((linkElement) => linkElement.href.length > 0)
			.map((linkElement) => ({
				linkElement,
				originalHref: linkElement.href
			}));

		this.initialized = true;
		this.applyCurrentVisibility();
	}

	setVisible(visible: boolean): void {
		if(this.badgeVisible === visible && (visible === false || this.badgedHref !== undefined || this.badgedHrefPromise !== undefined)) {
			return;
		}

		this.badgeVisible = visible;
		if(!this.initialized) return;

		this.applyCurrentVisibility();
	}

	clear(): void {
		this.setVisible(false);
	}

	private applyCurrentVisibility(): void {
		if(!this.initialized) return;
		if(!this.badgeVisible) {
			this.applyOriginalHrefs();
			return;
		}

		if(this.badgedHref !== undefined) {
			this.applyHrefToLinks(this.badgedHref);
			return;
		}

		void this.ensureBadgedHref().then((badgedHref) => {
			if(!this.initialized || !this.badgeVisible || badgedHref === undefined) {
				return;
			}

			this.applyHrefToLinks(badgedHref);
		});
	}

	private ensureBadgedHref(): Promise<string | undefined> {
		if(this.badgedHref !== undefined) {
			return Promise.resolve(this.badgedHref);
		}

		if(this.badgedHrefPromise !== undefined) {
			return this.badgedHrefPromise;
		}

		this.badgedHrefPromise = this.renderBadgedHref()
			.then((badgedHref) => {
				this.badgedHref = badgedHref;
				return badgedHref;
			})
			.finally(() => {
				this.badgedHrefPromise = undefined;
			});

		return this.badgedHrefPromise;
	}

	private async renderBadgedHref(): Promise<string | undefined> {
		if(typeof document === "undefined") {
			return undefined;
		}

		const baseFaviconHref = this.selectBaseFaviconHref();
		if(baseFaviconHref === undefined) {
			return undefined;
		}

		const baseIconImage = await this.loadImage(baseFaviconHref);
		if(baseIconImage === undefined) {
			return undefined;
		}

		const canvas = document.createElement("canvas");
		canvas.width = BADGE_CANVAS_SIZE;
		canvas.height = BADGE_CANVAS_SIZE;

		const context = canvas.getContext("2d");
		if(context === null) {
			return undefined;
		}

		context.clearRect(0, 0, BADGE_CANVAS_SIZE, BADGE_CANVAS_SIZE);
		context.drawImage(baseIconImage, 0, 0, BADGE_CANVAS_SIZE, BADGE_CANVAS_SIZE);
		this.drawBadgeDot(context);

		try {
			return canvas.toDataURL("image/png");
		} catch(_error) {
			return undefined;
		}
	}

	private drawBadgeDot(context: CanvasRenderingContext2D): void {
		const centerX = BADGE_CANVAS_SIZE - BADGE_RADIUS - BADGE_OFFSET;
		const centerY = BADGE_RADIUS + BADGE_OFFSET;

		context.beginPath();
		context.fillStyle = BADGE_COLOR;
		context.arc(centerX, centerY, BADGE_RADIUS, 0, Math.PI * 2);
		context.fill();

		context.beginPath();
		context.lineWidth = BADGE_BORDER_WIDTH;
		context.strokeStyle = BADGE_BORDER_COLOR;
		context.arc(centerX, centerY, BADGE_RADIUS, 0, Math.PI * 2);
		context.stroke();
	}

	private async loadImage(href: string): Promise<HTMLImageElement | undefined> {
		return await new Promise((resolve) => {
			const image = new Image();
			image.decoding = "async";
			image.onload = () => resolve(image);
			image.onerror = () => resolve(undefined);
			image.src = href;
		});
	}

	private selectBaseFaviconHref(): string | undefined {
		const favicon32 = this.faviconLinks.find((faviconLink) => {
			const sizes = faviconLink.linkElement.getAttribute("sizes");
			return sizes !== null && sizes.split(" ").includes("32x32");
		});

		if(favicon32 !== undefined) {
			return favicon32.originalHref;
		}

		return this.faviconLinks[0]?.originalHref;
	}

	private applyOriginalHrefs(): void {
		for(const faviconLink of this.faviconLinks) {
			if(faviconLink.linkElement.href === faviconLink.originalHref) {
				continue;
			}

			faviconLink.linkElement.href = faviconLink.originalHref;
		}
	}

	private applyHrefToLinks(href: string): void {
		for(const faviconLink of this.faviconLinks) {
			if(faviconLink.linkElement.href === href) {
				continue;
			}

			faviconLink.linkElement.href = href;
		}
	}
}

let faviconBadgeManager: FaviconBadgeManager | undefined;

function getFaviconBadgeManager(): FaviconBadgeManager {
	if(faviconBadgeManager === undefined) {
		faviconBadgeManager = new FaviconBadgeManager();
	}

	return faviconBadgeManager;
}

export function initializeFaviconBadge(): void {
	getFaviconBadgeManager().initialize();
}

export function setFaviconBadgeVisible(visible: boolean): void {
	getFaviconBadgeManager().setVisible(visible);
}

export function clearFaviconBadge(): void {
	getFaviconBadgeManager().clear();
}
