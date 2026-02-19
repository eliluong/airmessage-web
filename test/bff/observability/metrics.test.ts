/** @jest-environment node */
import {
        recordAuthFailure,
        recordRealtimeReconnect,
        recordUpstreamRequest,
        recordUpstreamTransportFailure,
        renderMetrics,
        resetMetricsForTests
} from "../../../bff/src/observability/metrics";

describe("bff metrics", () => {
        beforeEach(() => {
                resetMetricsForTests();
        });

        it("tracks auth failures and upstream status classes", async () => {
                recordAuthFailure("BFF_UPSTREAM_AUTH_FAILED");
                recordUpstreamRequest("GET", "/api/v1/server/info", 200, 25);
                recordUpstreamRequest("GET", "/api/v1/server/info", 503, 90);
                recordUpstreamTransportFailure("POST", "/api/v1/message/text");
                recordRealtimeReconnect("reconnect");

                const metrics = await renderMetrics();
                expect(metrics).toContain("bff_auth_failures_total");
                expect(metrics).toContain("reason=\"bff_upstream_auth_failed\"");
                expect(metrics).toContain("bff_upstream_requests_total");
                expect(metrics).toContain("status_class=\"5xx\"");
                expect(metrics).toContain("bff_upstream_errors_total");
                expect(metrics).toContain("status_class=\"network\"");
                expect(metrics).toContain("bff_realtime_reconnect_total");
                expect(metrics).toContain("event=\"reconnect\"");
        });
});
