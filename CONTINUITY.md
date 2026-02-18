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
- 2026-02-18 [CODE] Now: Realtime migration is documented complete through Phase 6 with residual operational unknowns explicitly tracked.
- 2026-02-18 [CODE] Next: Optional production soak/manual validation for long-session sleep/wake + cloud tunnel reconnect behavior.
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

## Done (recent)
- 2026-02-18 [CODE] Added regression test covering realtime partial-payload hydration miss fallback into catch-up polling (`bluebubblesCommunicationsManager.test.ts`).
- 2026-02-18 [CODE] Added regression test covering reconnect-triggered catch-up queueing when channel degradation occurs during an in-flight poll.
- 2026-02-18 [CODE] Updated `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md` to mark Phase 6 complete and record validation/results.
- 2026-02-18 [CODE] Updated `project.md` realtime roadmap entry from “in progress” to “Phase 1-6 complete” with residual unknowns called out.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed (38 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed (14 suites, 92 tests).
- 2026-02-18 [TOOL] `npm run build` passed (webpack success; warnings only).

## Open Questions
- 2026-02-18 [ASSUMPTION] For all target server versions, is configured password always valid as socket `guid` when token-auth endpoints are present? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Intermittent cloud tunnel reconnect behavior under longer sessions remains UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Real-world frequency of encrypted socket payloads (`encrypted: true`) across target deployments remains UNCONFIRMED.

## Working set
- 2026-02-18 [CODE] `src/connection/bluebubbles/api.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/realtimeChannel.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/realtimePayload.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts`
- 2026-02-18 [CODE] `src/components/SignInGate.tsx`
- 2026-02-18 [CODE] `src/components/messaging/master/Messaging.tsx`
- 2026-02-18 [CODE] `src/util/bluebubblesAuth.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/realtimeChannel.test.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/api.test.ts`
- 2026-02-18 [CODE] `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md`
- 2026-02-18 [CODE] `project.md`

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
