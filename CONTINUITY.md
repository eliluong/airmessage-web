# CONTINUITY

## Snapshot
- 2026-02-17 [USER] Goal: Fix BlueBubbles web client so messages received while browser/computer is offline are shown after reconnect without manual reload.
- 2026-02-17 [CODE] Completed: Poll catch-up now pages by cursor safely; retrieval hooks trigger immediate catch-up.
- 2026-02-18 [USER] Goal: Parse iMessage emoji reaction text as tapbacks.
- 2026-02-18 [CODE] Completed: Emoji text tapback parser + modifier/UI threading + regression tests landed.
- 2026-02-18 [USER] Goal: Execute realtime migration Phases 0-5.
- 2026-02-18 [CODE] Completed: Phases 1-5 landed (socket lifecycle/gating, direct socket ingestion, dedupe/reconciliation, tapback consistency, health-based polling fallback).
- 2026-02-18 [USER] Goal: Investigate why periodic REST polling is still visible despite socket-first rollout.
- 2026-02-18 [CODE] Completed: Compatibility hotfix landed: dedicated `socketGuid` credential persistence/use, socket path normalization to `<basePath>/socket.io`, and explicit degraded-mode fallback diagnostics.
- 2026-02-18 [USER] Observed: `POST /api/v1/auth/login` and `POST /api/v1/login` return 404; `/api/v1/server/features?password=...` returns 404; realtime remains in `connecting` with polling fallback `reason: channel-state-connecting`.
- 2026-02-18 [USER] Observed: runtime now reaches realtime `connected` after `connecting`; `serverVersion` logs as `1.9.7`; periodic polling is no longer visible in network panel.
- 2026-02-18 [CODE] Completed: `fetchServerMetadata` now normalizes wrapped/camelCase payloads (`{data:{...}}`), so `server_version` and feature flags parse correctly on legacy/Cloudflare-style responses.
- 2026-02-18 [CODE] Completed: Realtime channel compatibility expanded with Socket.IO Engine.IO v3 support (`allowEIO3: true`) and explicit connect timeout to avoid silent indefinite `connecting`.
- 2026-02-18 [CODE] Now: Local tests/build pass after metadata + realtime compatibility updates.
- 2026-02-18 [CODE] Next: Confirm end-to-end realtime delivery by sending/receiving live messages and verifying no sustained interval `/message/query` traffic while socket stays `connected`.
- 2026-02-18 [ASSUMPTION] Real-world frequency of encrypted socket payloads (`encrypted: true`) across target deployments is UNCONFIRMED.

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

## Done (recent)
- 2026-02-18 [CODE] Added socket URL normalization in `realtimeChannel.ts` to avoid namespace/path mismatches under subpath/proxy deployments.
- 2026-02-18 [CODE] Added fallback diagnostics in `bluebubblesCommunicationsManager.ts` when interval polling is active due to degraded realtime.
- 2026-02-18 [CODE] Added auth regression coverage for Cloudflare-style endpoint mismatch (`/api/v1/auth/login` 404 -> `/api/v1/login` success).
- 2026-02-18 [CODE] Added server metadata normalization for wrapped/camelCase payloads in `src/connection/bluebubbles/api.ts`.
- 2026-02-18 [CODE] Added realtime compatibility flags: `allowEIO3: true`, explicit connect timeout, manager-level error listener, plus server-metadata debug logging for quick runtime verification.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/api.test.ts test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts` passed after realtime compatibility updates (12 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` and `npm run build` passed after realtime compatibility updates.

## Open Questions
- 2026-02-18 [ASSUMPTION] For all target server versions, is configured password always valid as socket `guid` when token-auth endpoints are present? UNCONFIRMED.
- 2026-02-18 [CODE] Target Cloudflare deployment reports `server_version: 1.9.7`; realtime eligibility gate (`>=1.6.0`) is satisfied.
- 2026-02-18 [ASSUMPTION] Intermittent cloud tunnel reconnect behavior under longer sessions remains UNCONFIRMED.

## Working set
- 2026-02-18 [CODE] `src/components/SignInGate.tsx`
- 2026-02-18 [CODE] `src/components/messaging/master/Messaging.tsx`
- 2026-02-18 [CODE] `src/connection/connectionManager.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/api.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/session.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/realtimeChannel.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts`
- 2026-02-18 [CODE] `src/util/bluebubblesAuth.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/api.test.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/realtimeChannel.test.ts`
- 2026-02-18 [CODE] `test/util/bluebubblesAuth.test.ts`
- 2026-02-18 [CODE] `CONTINUITY.md`

## Receipts
- 2026-02-18 [TOOL] Static trace: interval polling is disabled when realtime state is `connected` in `bluebubblesCommunicationsManager.ts`.
- 2026-02-18 [TOOL] Static trace: BlueBubbles app socket uses query `guid` auth and origin-based socket URL (`bluebubbles-app/lib/services/network/socket_service.dart`).
- 2026-02-18 [TOOL] Static trace: BlueBubbles server docs describe `guid` auth for API requests.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimeChannel.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during earlier realtime phases (25 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimePayload.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 2 rollout (31 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/components/messaging/thread/DetailThread.test.tsx test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 3 rollout (33 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 4 rollout (34 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed during Phase 5 rollout (36 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed during Phase 5 rollout (13 suites, 84 tests).
- 2026-02-18 [TOOL] `npm run build` passed during Phase 5 rollout (webpack success; warnings only).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after compatibility hotfix (44 tests).
- 2026-02-18 [TOOL] Revalidated on current workspace: `npm test -- --runInBand test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed (44 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/util/bluebubblesAuth.test.ts test/connection/bluebubbles/realtimeChannel.test.ts` passed after adding login fallback regression (9 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/api.test.ts test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts` passed after server metadata normalization (11 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after server metadata normalization (36 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/api.test.ts test/connection/bluebubbles/realtimeChannel.test.ts test/util/bluebubblesAuth.test.ts` passed after `allowEIO3` + timeout updates (12 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after realtime compatibility updates (36 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after compatibility hotfix (13 suites, 86 tests).
- 2026-02-18 [TOOL] `npm run build` passed after compatibility hotfix (webpack success; warnings only).
