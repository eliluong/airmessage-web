import {Counter, Histogram, Registry, collectDefaultMetrics} from "prom-client";

const METRIC_PREFIX = "bff_";
const defaultRegistry = new Registry();

collectDefaultMetrics({
        prefix: `${METRIC_PREFIX}process_`,
        register: defaultRegistry
});

const authFailuresCounter = new Counter({
        name: `${METRIC_PREFIX}auth_failures_total`,
        help: "Count of failed upstream authentication attempts",
        labelNames: ["reason"] as const,
        registers: [defaultRegistry]
});

const upstreamRequestsCounter = new Counter({
        name: `${METRIC_PREFIX}upstream_requests_total`,
        help: "Total proxied upstream requests grouped by status class",
        labelNames: ["method", "route", "status_class"] as const,
        registers: [defaultRegistry]
});

const upstreamErrorsCounter = new Counter({
        name: `${METRIC_PREFIX}upstream_errors_total`,
        help: "Total proxied upstream errors grouped by class",
        labelNames: ["method", "route", "status_class"] as const,
        registers: [defaultRegistry]
});

const upstreamLatencyHistogram = new Histogram({
        name: `${METRIC_PREFIX}upstream_latency_seconds`,
        help: "Proxy latency for upstream requests",
        labelNames: ["method", "route"] as const,
        buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
        registers: [defaultRegistry]
});

const realtimeReconnectCounter = new Counter({
        name: `${METRIC_PREFIX}realtime_reconnect_total`,
        help: "Realtime reconnect lifecycle events observed by BFF bridge",
        labelNames: ["event"] as const,
        registers: [defaultRegistry]
});

export function getMetricsContentType(): string {
        return defaultRegistry.contentType;
}

export async function renderMetrics(): Promise<string> {
        return defaultRegistry.metrics();
}

export function recordAuthFailure(reason: string): void {
        authFailuresCounter.inc({reason: normalizeLabel(reason)});
}

export function recordUpstreamRequest(
        method: string,
        route: string,
        status: number,
        durationMs: number
): void {
        const methodLabel = normalizeLabel(method).toUpperCase();
        const routeLabel = normalizeRouteLabel(route);
        const statusClass = statusToClass(status);
        const durationSeconds = Math.max(0, durationMs) / 1000;

        upstreamRequestsCounter.inc({
                method: methodLabel,
                route: routeLabel,
                status_class: statusClass
        });
        upstreamLatencyHistogram.observe({
                method: methodLabel,
                route: routeLabel
        }, durationSeconds);

        if(status >= 400) {
                upstreamErrorsCounter.inc({
                        method: methodLabel,
                        route: routeLabel,
                        status_class: statusClass
                });
        }
}

export function recordUpstreamTransportFailure(method: string, route: string): void {
        const methodLabel = normalizeLabel(method).toUpperCase();
        const routeLabel = normalizeRouteLabel(route);

        upstreamErrorsCounter.inc({
                method: methodLabel,
                route: routeLabel,
                status_class: "network"
        });
}

export function recordRealtimeReconnect(eventName: string): void {
        realtimeReconnectCounter.inc({event: normalizeLabel(eventName)});
}

export function resetMetricsForTests(): void {
        defaultRegistry.resetMetrics();
}

function normalizeLabel(value: string): string {
        const normalized = value.trim().toLowerCase();
        if(normalized.length === 0) return "unknown";
        return normalized.slice(0, 64);
}

function statusToClass(status: number): string {
        if(status >= 100 && status < 200) return "1xx";
        if(status >= 200 && status < 300) return "2xx";
        if(status >= 300 && status < 400) return "3xx";
        if(status >= 400 && status < 500) return "4xx";
        if(status >= 500 && status < 600) return "5xx";
        return "unknown";
}

function normalizeRouteLabel(route: string): string {
        const normalizedPath = route.trim().split("?")[0] ?? "";
        if(normalizedPath.length === 0) return "unknown";

        const parts = normalizedPath
                .split("/")
                .filter((segment) => segment.length > 0)
                .map((segment) => normalizePathSegment(segment));
        return `/${parts.join("/")}`;
}

function normalizePathSegment(segment: string): string {
        if(/^\d+$/.test(segment)) {
                return ":number";
        }
        if(segment.length > 32 && /^[a-z0-9_-]+$/i.test(segment)) {
                return ":id";
        }
        return segment;
}
