type FaviconLinkSnapshot = {
	linkElement: HTMLLinkElement;
	originalHref: string;
};

class FaviconBadgeManager {
	private initialized = false;
	private badgeVisible = false;
	private faviconLinks: FaviconLinkSnapshot[] = [];

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
	}

	setVisible(visible: boolean): void {
		this.badgeVisible = visible;
		if(!this.initialized) return;

		if(!visible) {
			this.restoreOriginalHrefs();
			return;
		}

		// Phase 0 contract only: rendering and applying the badged icon is introduced in Phase 1.
	}

	clear(): void {
		this.setVisible(false);
	}

	private restoreOriginalHrefs(): void {
		for(const faviconLink of this.faviconLinks) {
			faviconLink.linkElement.href = faviconLink.originalHref;
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
