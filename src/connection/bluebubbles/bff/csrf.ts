let currentBffCsrfToken: string | undefined;

export function setBffCsrfToken(token: string | undefined): void {
        const normalized = token?.trim();
        currentBffCsrfToken = normalized && normalized.length > 0 ? normalized : undefined;
}

export function getBffCsrfToken(): string | undefined {
        return currentBffCsrfToken;
}
