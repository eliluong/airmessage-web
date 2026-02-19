# CONTINUITY

## Snapshot
- 2026-02-18 [USER] Goal: remove plaintext BlueBubbles credential exposure in browser request surfaces while supporting legacy-auth deployments.
- 2026-02-18 [USER] Constraint: target deployment returns `404` for `/api/v1/auth/login` and `/api/v1/login`; token-only browser auth is not viable.
- 2026-02-18 [CODE] Completed: Node BFF implementation plan established with Phases 0-5.
- 2026-02-18 [CODE] Completed: Phase 0 landed (`/bff` contracts, transport seam, rollout flag plumbing).
- 2026-02-19 [CODE] Completed: Phase 1 landed (BFF session routes + core read/bootstrap proxy routes + web BFF sign-in/status path).
- 2026-02-19 [CODE] Completed: Phase 2 landed (send/search/media parity routes + CSRF enforcement + web transport wiring).
- 2026-02-19 [CODE] Completed: Phase 3 landed (`/bff/socket` realtime bridge + browser BFF realtime channel + health propagation).
- 2026-02-19 [CODE] Completed: Phase 4 landed (Redis session-store option, rate limits, upstream allowlist, `/bff/metrics`, security checklist).
- 2026-02-19 [TOOL] Operational evidence: Playwright BFF run captured login/bootstrap/send/realtime/upload/download with browser traffic on `/bff/*`.
- 2026-02-19 [CODE] Completed: nullable attachment MIME sidebar crash hotfix landed.
- 2026-02-19 [USER] Goal: execute Phase 5 and update implementation docs.
- 2026-02-19 [CODE] Completed: Phase 5 landed; BFF is default-on, direct browser auth is explicit emergency opt-in only, onboarding shows direct-mode deprecation warnings.
- 2026-02-19 [TOOL] Validation: Phase-5 transport tests passed; web production build passed (existing webpack asset-size warnings only).
- 2026-02-19 [USER] Deployment delta: Cloudflare/Nginx path (`air.thecemetary.org`) can show transient `ERR_QUIC_PROTOCOL_ERROR` while tunnel path is steadier; root cause remains UNCONFIRMED.
- 2026-02-19 [CODE] Next: add deeper route-level BFF integration coverage and capture longer-session reconnect evidence under default-on rollout.
- 2026-02-19 [USER] Local-dev regression: login on `http://debian-dev.lan:8080` shows `Not Found` due to `/bff/session/*` returning `404`.
- 2026-02-19 [CODE] Local-dev fix: webpack `/bff` proxy now defaults to `BFF_ENABLED` when `BFF_DEV_PROXY_ENABLED` is unset, with explicit env override retained.

## Invariants / Constraints
- 2026-02-17 [USER] Preserve architecture: UI calls `connectionManager`; transport-specific behavior stays in `bluebubblesCommunicationsManager`.
- 2026-02-17 [USER] Avoid silent fallback behavior; failures should surface explicitly.
- 2026-02-19 [USER] Direct-mode browser auth should be treated as deprecated, not default.

## Decisions
- 2026-02-18 [CODE] D016 ACTIVE: polling fallback is socket-health-driven (interval off when healthy, on when degraded/unsupported) with queued catch-up.
- 2026-02-18 [CODE] D019 ACTIVE: query-style bootstrap/history/media remain REST-backed until a documented socket query contract provides pagination parity.
- 2026-02-18 [CODE] D020 ACTIVE: legacy-auth environments use a Node BFF credential boundary (browser keeps only BFF session state; upstream secrets stay server-side).
- 2026-02-19 [CODE] D023 ACTIVE: BFF serves send/search/media with CSRF-enforced mutating routes; `createChat` in BFF remains intentionally unsupported.
- 2026-02-19 [CODE] D024 ACTIVE: client poll fallback tracks upstream socket health via bridged `bff-realtime-state` events.
- 2026-02-19 [CODE] D025 ACTIVE: upstream validation is policy-driven by `BFF_UPSTREAM_ALLOWED_HOSTS` / `BFF_UPSTREAM_ALLOWED_CIDRS`.
- 2026-02-19 [CODE] D026 ACTIVE: observability baseline is Prometheus-style `/bff/metrics` for auth failures, upstream latency/errors, and realtime reconnect churn.
- 2026-02-19 [CODE] D027 ACTIVE: default web transport is BFF; direct browser mode requires explicit dual-flag opt-in (`BFF_ENABLED=false` and `BFF_DIRECT_MODE_ENABLED=true`) and otherwise fails closed.
- 2026-02-19 [CODE] D028 ACTIVE: onboarding copy must surface direct-mode deprecation warnings whenever direct mode is intentionally enabled.

## Done (recent)
- 2026-02-19 [CODE] Fixed local-dev BFF routing mismatch by defaulting webpack `/bff` proxy enablement to the resolved BFF transport mode (`webpack.config.js`).
- 2026-02-19 [TOOL] Reproduced local `404` failure in Playwright (`GET /bff/session/status` on `http://debian-dev.lan:8080`) and validated root-cause signal.
- 2026-02-19 [CODE] Implemented Phase 5 transport default/gating (`src/connection/bluebubbles/transport.ts`, `webpack.config.js`, `index.d.ts`, `.env.example`).
- 2026-02-19 [CODE] Updated onboarding UX for BFF-first messaging with direct-mode deprecation warning states (`src/components/Onboarding.tsx`, `src/components/SignInGate.tsx`).
- 2026-02-19 [CODE] Updated media-cache scope fallback to configured transport mode rather than hardcoded direct fallback (`src/state/mediaCache.ts`).
- 2026-02-19 [CODE] Added transport configuration regression coverage and updated existing BlueBubbles manager tests to set explicit direct mode where intended (`test/connection/bluebubbles/transportConfig.test.ts`, `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`).
- 2026-02-19 [CODE] Updated BFF rollout docs/roadmap to mark Phase 5 complete and refresh post-rollout work (`BLUEBUBBLES_BFF_IMPLEMENTATION_PLAN.md`, `project.md`).

## Open Questions
- 2026-02-19 [ASSUMPTION] Root cause and frequency of Cloudflare/Nginx `ERR_QUIC_PROTOCOL_ERROR` on `air.thecemetary.org` remain UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Frequency of encrypted realtime payloads (`encrypted: true`) across target deployments remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Stability/support level of legacy socket query handlers (`get-chats`, `get-chat-messages`) across all target server versions remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Final production preference for same-origin vs strict cross-origin BFF deployment remains UNCONFIRMED.

## Working set
- 2026-02-19 [CODE] `src/connection/bluebubbles/transport.ts`
- 2026-02-19 [CODE] `src/components/Onboarding.tsx`
- 2026-02-19 [CODE] `src/components/SignInGate.tsx`
- 2026-02-19 [CODE] `src/state/mediaCache.ts`
- 2026-02-19 [CODE] `test/connection/bluebubbles/transportConfig.test.ts`
- 2026-02-19 [CODE] `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`
- 2026-02-19 [CODE] `.env.example`
- 2026-02-19 [CODE] `webpack.config.js`
- 2026-02-19 [CODE] `index.d.ts`
- 2026-02-19 [CODE] `BLUEBUBBLES_BFF_IMPLEMENTATION_PLAN.md`
- 2026-02-19 [CODE] `project.md`
- 2026-02-19 [CODE] `README.md`

## Receipts
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/bffRealtimeChannel.test.ts` passed during Phase 1 rollout (3 suites, 6 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/transport.test.ts` passed during Phase 2 rollout (3 suites, 9 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffRealtimeChannel.test.ts test/bff/upstream/realtimeSocket.test.ts test/bff/realtime/bridge.test.ts` passed during Phase 3 rollout (3 suites, 12 tests).
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bffApi.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/bffRealtimeChannel.test.ts test/connection/bluebubbles/transport.test.ts test/bff/realtime/bridge.test.ts test/bff/upstream/realtimeSocket.test.ts test/bff/security/urlValidation.test.ts test/bff/security/rateLimit.test.ts test/bff/observability/metrics.test.ts test/bff/observability/logger.test.ts` passed during Phase 4 rollout (10 suites, 30 tests).
- 2026-02-19 [TOOL] `npm run build` passed during Phase 4 rollout (webpack success; existing warnings only).
- 2026-02-19 [TOOL] Playwright Phase 4 evidence run recorded `/bff/*` login/bootstrap/send/realtime/upload/download activity with no direct browser->upstream REST traffic (`evidence/phase4-playwright-evidence.md`).
- 2026-02-19 [TOOL] `npm run build` and `npm --prefix bff run build` passed after nullable-MIME preview hotfix (success; existing warnings only).
- 2026-02-19 [TOOL] Playwright follow-up on `air.thecemetary.org` observed transient `ERR_QUIC_PROTOCOL_ERROR` but subsequent `/chat/query` and `/message/query` calls recovered with `200`.
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/transportConfig.test.ts test/connection/bluebubbles/transport.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/bffApi.test.ts` passed after Phase 5 updates (4 suites, 13 tests).
- 2026-02-19 [TOOL] `npm run build` passed after Phase 5 updates (webpack success; existing asset-size/service-worker warnings only).
- 2026-02-19 [TOOL] First post-Phase-5 `npm test -- --runInBand` run failed in `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` because implicit transport default switched to BFF (`fetch` missing / CSRF expectations), confirming tests relied on old default assumptions.
- 2026-02-19 [TOOL] After setting explicit direct transport in that suite, `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` and full `npm test -- --runInBand` both passed (26 suites, 130 tests).
- 2026-02-19 [TOOL] Playwright local-dev reproduction on `http://debian-dev.lan:8080` captured duplicate `GET /bff/session/status -> 404 Not Found` while login UI loaded.
- 2026-02-19 [TOOL] `npm run build` passed after webpack proxy-default fix (webpack success; existing asset-size/service-worker warnings only).
