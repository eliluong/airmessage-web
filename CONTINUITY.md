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
- 2026-02-19 [CODE] Completed: Phase 5 landed; BFF is default-on, direct browser auth is explicit emergency opt-in only, onboarding shows direct-mode deprecation warnings.
- 2026-02-19 [TOOL] Validation: Phase-5 transport tests passed; web production build passed (existing webpack asset-size warnings only).
- 2026-02-19 [USER] Deployment delta: Cloudflare/Nginx path (`air.thecemetary.org`) can show transient `ERR_QUIC_PROTOCOL_ERROR` while tunnel path is steadier; root cause remains UNCONFIRMED.
- 2026-02-19 [USER] Local-dev regression: login on `http://debian-dev.lan:8080` shows `Not Found` due to `/bff/session/*` returning `404`.
- 2026-02-19 [CODE] Local-dev fix: webpack `/bff` proxy now defaults to `BFF_ENABLED` when `BFF_DEV_PROXY_ENABLED` is unset, with explicit env override retained.
- 2026-02-19 [USER] Local-dev workflow request: run web dev server and BFF dev server with one root command.
- 2026-02-19 [CODE] Local-dev workflow update: root `npm run dev` now launches both (`npm run dev:web` + `npm run dev:bff`) via `concurrently`.
- 2026-02-19 [TOOL] Reproduced `https://air2.thecemetary.org` login-page websocket failures: repeated `wss://air2.thecemetary.org:8080/ws` -> `net::ERR_SSL_PROTOCOL_ERROR`, emitted by `webpack-dev-server` client in `index.js`.
- 2026-02-19 [USER] Confirmed: this recurring `air2` websocket error pattern is expected for dev-bundle hosting and does not affect normal application function.
- 2026-02-19 [CODE] Supersedes prior assumption: `wss://air2.thecemetary.org:8080/ws` failures are expected webpack HMR/dev-server reconnect noise, not a `/bff/socket` or BlueBubbles transport fault.
- 2026-02-19 [USER] Goal: add a browser-tab favicon red-dot indicator for incoming messages received while the tab is unfocused; clear the dot when the tab regains focus/visibility even if per-conversation unread state is unchanged.
- 2026-02-19 [CODE] Research complete: incoming-message eligibility is already filtered in `useConversationState` interactive notification flow; focus detection currently uses page visibility via `BrowserPlatformUtils.hasFocus()`.
- 2026-02-20 [USER] Direction: proceed with favicon Phase 0 edits only and ignore unrelated dirty-worktree files.
- 2026-02-20 [CODE] Completed: favicon Phase 0 contract scaffold landed in `src/util/faviconBadge.ts`; app wiring/rendering intentionally deferred to Phase 1.
- 2026-02-20 [CODE] Completed: favicon Phases 1-4 landed (rendering/toggle internals + background-trigger wiring + clear-on-return lifecycle + deterministic test coverage) (`src/util/faviconBadge.ts`, `src/state/conversationState.ts`, `src/components/messaging/master/Messaging.tsx`, `test/util/faviconBadge.test.ts`, `test/components/messaging/master/Messaging.faviconBadge.test.tsx`).

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
- 2026-02-19 [CODE] D029 ACTIVE: recurring `wss://<host>:8080/ws` `ERR_SSL_PROTOCOL_ERROR` logs on publicly hosted dev bundles are classified as expected webpack HMR noise unless accompanied by `/bff/*` or `/bff/socket` failures.
- 2026-02-20 [CODE] D030 ACTIVE: favicon badge state is owned by a module-scope singleton utility with explicit APIs (`initializeFaviconBadge`, `setFaviconBadgeVisible`, `clearFaviconBadge`) and safe no-op behavior when favicon links are unavailable.
- 2026-02-20 [CODE] D031 ACTIVE: favicon badge renderer prefers the `32x32` favicon source, caches a single generated badged data URL, and applies href changes idempotently across all `rel~="icon"` links.
- 2026-02-20 [CODE] D032 ACTIVE: favicon badge activation for background message arrivals is sourced from the existing interactive `notificationMessages` path in `useConversationState`, avoiding duplicate new-message qualification logic.
- 2026-02-20 [CODE] D033 ACTIVE: clear-on-return ownership lives in `Messaging` lifecycle (mount initializes favicon manager; `visibilitychange` + `focus` clear badge when tab is active; unmount cleanup clears stale badge state).

## Done (recent)
- 2026-02-19 [CODE] Added transport configuration regression coverage and updated existing BlueBubbles manager tests to set explicit direct mode where intended (`test/connection/bluebubbles/transportConfig.test.ts`, `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`).
- 2026-02-19 [CODE] Updated BFF rollout docs/roadmap to mark Phase 5 complete and refresh post-rollout work (`BLUEBUBBLES_BFF_IMPLEMENTATION_PLAN.md`, `project.md`).
- 2026-02-19 [CODE] Added one-command local-dev orchestration scripts in root package (`dev`, `dev:web`, `dev:bff`) for concurrent web+BFF startup (`package.json`).
- 2026-02-20 [CODE] Implemented favicon indicator Phase 0 utility scaffold and updated plan status notes (`src/util/faviconBadge.ts`, `FAVICON_BADGE_IMPLEMENTATION_PLAN.md`).
- 2026-02-20 [CODE] Implemented favicon indicator Phase 1 rendering plus Phase 2 background-trigger wiring, and updated implementation status notes (`src/util/faviconBadge.ts`, `src/state/conversationState.ts`, `FAVICON_BADGE_IMPLEMENTATION_PLAN.md`).
- 2026-02-20 [CODE] Implemented favicon indicator Phase 3 clear-on-return lifecycle wiring in `Messaging` and updated implementation status notes (`src/components/messaging/master/Messaging.tsx`, `FAVICON_BADGE_IMPLEMENTATION_PLAN.md`).
- 2026-02-20 [CODE] Implemented favicon indicator Phase 4 deterministic test coverage and updated implementation status notes (`test/util/faviconBadge.test.ts`, `test/components/messaging/master/Messaging.faviconBadge.test.tsx`, `FAVICON_BADGE_IMPLEMENTATION_PLAN.md`).

## Open Questions
- 2026-02-19 [ASSUMPTION] Root cause and frequency of Cloudflare/Nginx `ERR_QUIC_PROTOCOL_ERROR` on `air.thecemetary.org` remain UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Frequency of encrypted realtime payloads (`encrypted: true`) across target deployments remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Stability/support level of legacy socket query handlers (`get-chats`, `get-chat-messages`) across all target server versions remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Final production preference for same-origin vs strict cross-origin BFF deployment remains UNCONFIRMED.

## Working set
- 2026-02-20 [CODE] `src/util/faviconBadge.ts`
- 2026-02-20 [CODE] `src/state/conversationState.ts`
- 2026-02-20 [CODE] `src/components/messaging/master/Messaging.tsx`
- 2026-02-20 [CODE] `test/util/faviconBadge.test.ts`
- 2026-02-20 [CODE] `test/components/messaging/master/Messaging.faviconBadge.test.tsx`
- 2026-02-20 [CODE] `FAVICON_BADGE_IMPLEMENTATION_PLAN.md`
- 2026-02-20 [CODE] `CONTINUITY.md`
- 2026-02-20 [CODE] `project.md`

## Receipts
- 2026-02-19 [TOOL] `npm run build` and `npm --prefix bff run build` passed after nullable-MIME preview hotfix (success; existing warnings only).
- 2026-02-19 [TOOL] Playwright follow-up on `air.thecemetary.org` observed transient `ERR_QUIC_PROTOCOL_ERROR` but subsequent `/chat/query` and `/message/query` calls recovered with `200`.
- 2026-02-19 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/transportConfig.test.ts test/connection/bluebubbles/transport.test.ts test/connection/bluebubbles/bffSessionApi.test.ts test/connection/bluebubbles/bffApi.test.ts` passed after Phase 5 updates (4 suites, 13 tests).
- 2026-02-19 [TOOL] `npm run build` passed after Phase 5 updates (webpack success; existing asset-size/service-worker warnings only).
- 2026-02-19 [TOOL] First post-Phase-5 `npm test -- --runInBand` run failed in `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` because implicit transport default switched to BFF (`fetch` missing / CSRF expectations), confirming tests relied on old default assumptions.
- 2026-02-19 [TOOL] After setting explicit direct transport in that suite, `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` and full `npm test -- --runInBand` both passed (26 suites, 130 tests).
- 2026-02-19 [TOOL] Playwright local-dev reproduction on `http://debian-dev.lan:8080` captured duplicate `GET /bff/session/status -> 404 Not Found` while login UI loaded.
- 2026-02-19 [TOOL] `npm run build` passed after webpack proxy-default fix (webpack success; existing asset-size/service-worker warnings only).
- 2026-02-19 [TOOL] Playwright reproduction on `https://air2.thecemetary.org` captured `webpack-dev-server` reconnect loop with `WebSocket connection to 'wss://air2.thecemetary.org:8080/ws' failed: net::ERR_SSL_PROTOCOL_ERROR`; concurrent network traces still showed healthy `GET /bff/session/status -> 200` on login load.
- 2026-02-19 [TOOL] Playwright check on `https://air2.thecemetary.org` confirmed favicon links are static (`favicon-32/57/76/96/128/192.png`) and same-origin canvas overlay generation (`toDataURL`) succeeds for `/favicon-32.png`.
- 2026-02-19 [TOOL] Created phased execution plan for favicon badge feature in `FAVICON_BADGE_IMPLEMENTATION_PLAN.md`.
- 2026-02-20 [TOOL] `npx tsc --noEmit` passed after implementing favicon Phase 1 rendering/toggle internals.
- 2026-02-20 [TOOL] `npx tsc --noEmit` passed after wiring favicon Phase 2 background incoming-message activation.
- 2026-02-20 [TOOL] `npm run build` passed after favicon Phase 2 updates (webpack success; existing asset-size/service-worker warnings only).
- 2026-02-20 [TOOL] `npm test -- --runInBand` passed after favicon Phase 2 updates (26 suites, 130 tests).
- 2026-02-20 [TOOL] `npx tsc --noEmit` passed after implementing favicon Phase 3 clear-on-return lifecycle wiring.
- 2026-02-20 [TOOL] `npm run build` passed after favicon Phase 3 updates (webpack success; existing asset-size/service-worker warnings only).
- 2026-02-20 [TOOL] `npm test -- --runInBand test/util/faviconBadge.test.ts test/components/messaging/master/Messaging.faviconBadge.test.tsx` passed after favicon Phase 4 test coverage updates (2 suites, 4 tests).
- 2026-02-20 [TOOL] `npx tsc --noEmit` passed after favicon Phase 4 test coverage updates.
- 2026-02-20 [TOOL] `npm test -- --runInBand` passed after favicon Phase 4 updates (28 suites, 134 tests).
