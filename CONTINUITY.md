# CONTINUITY

## Snapshot
- 2026-02-17 [USER] Goal: Fix missed-message recovery after offline gaps without manual reload.
- 2026-02-17 [CODE] Completed: Poll catch-up now pages by cursor; retrieval hooks trigger immediate catch-up.
- 2026-02-18 [USER] Goal: Parse iMessage emoji reaction text as tapbacks.
- 2026-02-18 [CODE] Completed: Emoji text tapback parser + UI/modifier threading + regression tests landed.
- 2026-02-18 [USER] Goal: Execute BlueBubbles realtime migration Phases 0-5.
- 2026-02-18 [CODE] Completed: Phases 1-5 landed (socket lifecycle/gating, direct ingestion, dedupe/reconciliation, tapback consistency, health-driven polling fallback).
- 2026-02-18 [USER] Goal: Eliminate sustained poll traffic when realtime is healthy.
- 2026-02-18 [CODE] Completed: Compatibility hardening landed (`socketGuid`, `<basePath>/socket.io`, `allowEIO3`, explicit connect timeout, metadata normalization, fallback diagnostics).
- 2026-02-18 [USER] Observed: Runtime reaches realtime `connected` with `serverVersion: 1.9.7` and no sustained periodic polling.
- 2026-02-18 [USER] Goal: Proceed with Phase 6.
- 2026-02-18 [CODE] Completed: Phase 6 code/test/doc closure implemented (new mixed socket/poll edge tests + roadmap updates).
- 2026-02-18 [USER] Goal: Eliminate plaintext password usage from browser BlueBubbles REST requests (e.g., `query`, `download`).
- 2026-02-18 [USER] Constraint: Target deployment consistently returns `404` for `/api/v1/auth/login` and `/api/v1/login`; token-only browser flow is not viable.
- 2026-02-18 [CODE] Completed: Node BFF Phase 0 landed (route/error contract scaffold + `BFF_ENABLED` flag + swappable transport seam in web client).
- 2026-02-19 [CODE] Completed: Node BFF Phase 1 landed (session auth routes + read/bootstrap proxy routes + web BFF login/bootstrap path).
- 2026-02-19 [CODE] Completed: Node BFF Phase 2 landed (send/search/media parity routes + CSRF + web transport wiring + regression coverage).
- 2026-02-19 [USER] Goal: Proceed with Node BFF Phase 3 (`/bff/socket` realtime bridge) and update roadmap docs.
- 2026-02-19 [CODE] Completed: Node BFF Phase 3 landed (server-side socket bridge + browser BFF realtime channel + regression tests).
- 2026-02-19 [USER] Goal: Proceed with Node BFF Phase 4 and update implementation roadmap docs.
- 2026-02-19 [CODE] Completed: Node BFF Phase 4 landed (Redis session-store support + rate limits + upstream allowlist + metrics + security checklist + verification tests).
- 2026-02-19 [CODE] Now: Phase 5 rollout planning remains (default-on BFF transport + direct-mode deprecation).
- 2026-02-19 [CODE] Next: Capture Playwright BFF-mode E2E evidence for login/bootstrap/send/realtime/upload/download and then execute Phase 5 defaults cleanup.
- 2026-02-18 [ASSUMPTION] Frequency of encrypted realtime payloads (`encrypted: true`) across deployments is UNCONFIRMED.

## Invariants / Constraints
- 2026-02-17 [USER] Preserve architecture: UI calls `connectionManager`; transport-specific logic stays in `bluebubblesCommunicationsManager`.
- 2026-02-17 [USER] Avoid silent fallback behavior; failures should surface.

## Decisions
- 2026-02-17 [CODE] D001 ACTIVE: Polling catch-up pages forward until exhaustion when cursor exists (`ASC` + `ROWID > cursor`).
- 2026-02-17 [CODE] D002 ACTIVE: `requestRetrievalTime`/`requestRetrievalID` prime cursors and trigger immediate catch-up.
- 2026-02-17 [CODE] D003 ACTIVE: Poll cursor advances from poll + latest thread fetch and emits `onIDUpdate`.
- 2026-02-18 [CODE] D006 ACTIVE: Realtime scope is core receive-path (messages/attachments/tapbacks); typing/unsend/edit/tapback-send deferred.
- 2026-02-18 [CODE] D008 ACTIVE: Socket-first realtime enabled only for server versions `>= 1.6.0`.
- 2026-02-18 [CODE] D011 ACTIVE: Realtime payload normalization/decrypt is centralized in `src/connection/bluebubbles/realtimePayload.ts`.
- 2026-02-18 [CODE] D016 ACTIVE: Polling mode is socket-health-driven (interval off when connected; on when degraded/unsupported) with queued catch-up.
- 2026-02-18 [CODE] D017 ACTIVE: Socket auth/routing compatibility prefers persisted `socketGuid` for query `guid` (fallback `accessToken`) and resolves socket target as `origin + <basePath>/socket.io`.
- 2026-02-18 [CODE] D018 ACTIVE: Phase 6 closure requires explicit documentation of remaining realtime risks (no silent “fully done” claims when behavior is UNCONFIRMED).
- 2026-02-18 [CODE] D019 ACTIVE: Query-style bootstrap/history/media retrieval remains REST-backed until server provides a documented, versioned socket query contract with `where`/pagination parity.
- 2026-02-18 [CODE] D020 ACTIVE: Legacy-auth environments use a Node BFF credential boundary (browser holds only BFF session state; BlueBubbles password/guid/token stays server-side).
- 2026-02-18 [CODE] D021 SUPERSEDED: Pre-Phase-1 guardrail that hard-failed all BFF runtime usage is retired after Phase 1 implementation.
- 2026-02-19 [CODE] D022 SUPERSEDED: Phase-1 guardrail that left BFF mutation/media actions explicitly not-implemented was retired once Phase 2 parity landed.
- 2026-02-19 [CODE] D023 ACTIVE: BFF mode now serves send/search/media via `/bff` routes with CSRF-enforced mutating endpoints (`session/logout`, `message/text`, `message/attachment`); `createChat` remains explicitly unsupported in BFF until a later phase.
- 2026-02-19 [CODE] D024 ACTIVE: BFF realtime health is bridged via explicit `bff-realtime-state` events so client poll fallback tracks upstream BlueBubbles socket health (not merely browser-to-BFF socket transport status).
- 2026-02-19 [CODE] D025 ACTIVE: Upstream target validation is policy-driven (`BFF_UPSTREAM_ALLOWED_HOSTS` / `BFF_UPSTREAM_ALLOWED_CIDRS`) and can be enforced in production to block non-allowlisted hosts at login boundary.
- 2026-02-19 [CODE] D026 ACTIVE: Phase 4 observability standard uses Prometheus-style `/bff/metrics` counters/histograms for auth failures, upstream latency/errors, and realtime reconnect churn.

## Done (recent)
- 2026-02-19 [CODE] Added configurable Redis-backed session runtime with TTL and clean shutdown lifecycle (`bff/src/session/middleware.ts`, `bff/src/server.ts`).
- 2026-02-19 [CODE] Added upstream allowlist policy parsing + enforcement (`bff/src/config.ts`, `bff/src/security/urlValidation.ts`, `bff/src/routes/sessionRoutes.ts`, `bff/src/upstream/auth.ts`).
- 2026-02-19 [CODE] Added hardened auth/proxy rate limiting middleware (`bff/src/security/rateLimit.ts`, `bff/src/app.ts`).
- 2026-02-19 [CODE] Added Prometheus-style metrics collection and `/bff/metrics` route with optional bearer-token protection (`bff/src/observability/metrics.ts`, `bff/src/app.ts`, `bff/src/upstream/client.ts`, `bff/src/realtime/bridge.ts`).
- 2026-02-19 [CODE] Expanded logger redaction coverage and added redaction verification test (`bff/src/observability/logger.ts`, `test/bff/observability/logger.test.ts`).
- 2026-02-19 [CODE] Added Phase 4 regression coverage for URL allowlist, rate limiting, and metrics (`test/bff/security/urlValidation.test.ts`, `test/bff/security/rateLimit.test.ts`, `test/bff/observability/metrics.test.ts`).
- 2026-02-19 [CODE] Updated roadmap and operations docs for Phase 4 completion (`BLUEBUBBLES_BFF_IMPLEMENTATION_PLAN.md`, `project.md`, `bff/SECURITY_CHECKLIST.md`, `bff/.env.example`).

## Open Questions
- 2026-02-18 [ASSUMPTION] For all target server versions, is configured password always valid as socket `guid` when token-auth endpoints are present? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Intermittent cloud tunnel reconnect behavior under longer sessions remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Real-world frequency of encrypted socket payloads (`encrypted: true`) across target deployments remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Are legacy socket query handlers (`get-chats`, `get-chat-messages`) stable/supported across all target server versions (including 1.9.7) for production usage? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Should BFF deployment be same-origin with web assets (recommended) or cross-origin with strict CORS/cookie policy? UNCONFIRMED.

## Working set
- 2026-02-19 [CODE] `bff/src/app.ts`
- 2026-02-19 [CODE] `bff/src/config.ts`
- 2026-02-19 [CODE] `bff/src/session/middleware.ts`
- 2026-02-19 [CODE] `bff/src/security/urlValidation.ts`
- 2026-02-19 [CODE] `bff/src/security/rateLimit.ts`
- 2026-02-19 [CODE] `bff/src/observability/metrics.ts`
- 2026-02-19 [CODE] `bff/src/observability/logger.ts`
- 2026-02-19 [CODE] `bff/src/upstream/client.ts`
- 2026-02-19 [CODE] `bff/SECURITY_CHECKLIST.md`
- 2026-02-19 [CODE] `test/bff/security/urlValidation.test.ts`
- 2026-02-19 [CODE] `test/bff/security/rateLimit.test.ts`
- 2026-02-19 [CODE] `BLUEBUBBLES_BFF_IMPLEMENTATION_PLAN.md`

## Receipts
- 2026-02-18 [TOOL] Static trace: interval polling is disabled when realtime state is `connected` in `bluebubblesCommunicationsManager.ts`.
- 2026-02-18 [TOOL] Static trace: BlueBubbles app socket uses query `guid` auth and origin-based socket URL (`bluebubbles-app/lib/services/network/socket_service.dart`).
- 2026-02-18 [TOOL] Static trace: BlueBubbles server docs describe `guid` auth for API requests.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimePayload.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 2 rollout (31 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/components/messaging/thread/DetailThread.test.tsx test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 3 rollout (33 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 5 rollout (36 tests).
- 2026-02-18 [TOOL] `npm run build` passed during Phase 5 rollout (webpack success; warnings only).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after compatibility hotfix (44 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/api.test.ts test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts` passed after metadata + realtime compatibility updates (12 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after adding Phase 6 edge-case coverage (38 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after Phase 6 updates (14 suites, 92 tests).
- 2026-02-18 [TOOL] `npm run build` passed after Phase 6 updates (webpack success; warnings only).
- 2026-02-18 [TOOL] Static trace: reported request payloads align with `fetchChats` (`with: participants,lastmessage`, default `limit: 1000`), `fetchThread` (`limit: 50`, `ROWID` anchor paging), and `fetchConversationMedia` (`attachment.mimeType LIKE image/%`, `limit: 30`).
- 2026-02-18 [TOOL] Static trace: native app currently performs chat/message queries via REST (`http.chats`, `http.chatMessages`, `http.messages`) and only uses socket emits for typing + limited settings commands.
- 2026-02-18 [TOOL] External docs trace: integration docs advertise REST + webhooks; server README documents legacy socket query handlers (`get-chats`, `get-chat-messages`) but support level across modern versions is UNCONFIRMED.
- 2026-02-18 [TOOL] Static trace: web client password query-string usage is centralized in `appendLegacyAuthParams`; it activates only when `legacyPasswordAuth` is persisted and impacts `/chat/query`, `/message/query`, attachment download, and attachment upload.
- 2026-02-18 [TOOL] Static trace: web auth fallback to legacy mode is triggered by auth endpoint 404s and validated by a legacy ping probe that includes `password` query auth.
- 2026-02-18 [TOOL] Static trace: native app API layer still injects `guid` query auth broadly (`HttpService.buildQueryParams`) and redacts `guid`/`password` in interceptor error logs.
- 2026-02-18 [CODE] Added `BLUEBUBBLES_BFF_IMPLEMENTATION_PLAN.md` documenting phased Node BFF implementation (auth/session boundary, route contracts, socket proxying, rollout, and test strategy).
- 2026-02-18 [CODE] Updated `project.md` to register BFF credential-boundary work under outstanding integration gaps.
- 2026-02-18 [TOOL] Static trace: direct BlueBubbles REST/realtime callsites now route through `src/connection/bluebubbles/transport.ts` (manager + connection manager).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after Phase 0 seam changes (14 suites, 92 tests).
- 2026-02-18 [TOOL] `npm run build` passed after Phase 0 seam changes (webpack success; warnings only).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/bffRealtimeChannel.test.ts` passed (3 suites, 6 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand` passed after Phase 1 updates (17 suites, 98 tests).
- 2026-02-19 [TOOL] `npm run build` passed after Phase 1 updates (webpack success; warnings only).
- 2026-02-19 [CODE] Added Node BFF package scaffold (`bff/package.json`, `bff/tsconfig.json`) and Phase 1 route implementation under `bff/src/*`.
- 2026-02-19 [TOOL] `npm --prefix bff run build` passed after Phase 2 implementation (TypeScript compile success).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/transport.test.ts` passed (3 suites, 9 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand` passed after Phase 2 implementation (18 suites, 103 tests).
- 2026-02-19 [TOOL] `npm run build` passed after Phase 2 implementation (webpack success; warnings only).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffRealtimeChannel.test.ts test/bff/upstream/realtimeSocket.test.ts test/bff/realtime/bridge.test.ts` passed after Phase 3 bridge implementation (3 suites, 12 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/transport.test.ts test/connection/bluebubbles/bffRealtimeChannel.test.ts test/bff/upstream/realtimeSocket.test.ts test/bff/realtime/bridge.test.ts` passed (6 suites, 21 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand` passed after Phase 3 implementation (20 suites, 113 tests).
- 2026-02-19 [TOOL] `npm run build` and `npm --prefix bff run build` passed after Phase 3 implementation (webpack success with existing warnings; BFF TypeScript build success).
- 2026-02-19 [TOOL] `npm --prefix bff run build` passed after Phase 4 hardening implementation (TypeScript compile success).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/bffRealtimeChannel.test.ts test/connection/bluebubbles/transport.test.ts test/bff/realtime/bridge.test.ts test/bff/upstream/realtimeSocket.test.ts test/bff/security/urlValidation.test.ts test/bff/security/rateLimit.test.ts test/bff/observability/metrics.test.ts test/bff/observability/logger.test.ts` passed (10 suites, 30 tests).
- 2026-02-19 [TOOL] `npm run build` passed after Phase 4 hardening updates (webpack success; existing asset-size warnings).
