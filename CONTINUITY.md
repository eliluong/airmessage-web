# CONTINUITY

## Snapshot
- 2026-02-17 [USER] Goal: Fix BlueBubbles web client so messages received while the computer/browser is offline are shown without requiring a manual page reload.
- 2026-02-17 [CODE] Completed: polling catch-up now pages by cursor safely and retrieval hooks trigger immediate catch-up.
- 2026-02-18 [USER] Goal: Remove right-pane near-bottom scroll judder after lazy-load.
- 2026-02-18 [CODE] Completed: threshold refs, overlay loader, and message row memoization landed; build/tests passed.
- 2026-02-18 [USER] Goal: Parse iMessage emoji reaction text as tapbacks.
- 2026-02-18 [CODE] Completed: emoji text tapback parser + modifier/UI threading + regression tests landed; build/tests passed.
- 2026-02-18 [USER] Goal: Plan and execute Phase 0 for socket-first realtime migration.
- 2026-02-18 [USER] Constraint: Scope is core message/attachment/tapback-receive only; exclude typing indicators, unsend/edit, and tapback sending; URL+password sign-in only.
- 2026-02-18 [CODE] Completed: Phase 1 realtime channel foundation landed (`socket.io-client`, `realtimeChannel.ts`, manager lifecycle wiring, and `>=1.6.0` server gating).
- 2026-02-18 [USER] Goal: Execute Phase 2 realtime socket ingestion and update migration documentation.
- 2026-02-18 [CODE] Completed: Phase 2 direct socket ingestion landed (`new-message` / `updated-message` parsing, optional decrypt, partial GUID hydration, cursor updates, and overlap dedupe).
- 2026-02-18 [USER] Goal: Phase 2 is implemented/validated; proceed with Phase 3 and update migration docs.
- 2026-02-18 [CODE] Completed: Phase 3 outbound/attachment stability landed (thread-level confirmed-message identity merge, transport identity hardening for temp-guid/serverID transitions, and outbound+attachment regression coverage).
- 2026-02-18 [USER] Goal: Phases 0-3 implemented/validated; proceed with Phase 4 and update migration docs.
- 2026-02-18 [CODE] Completed: Phase 4 tapback/modifier consistency landed (reaction GUID+fingerprint dedupe, same-GUID updated-message add/remove support, and overlap modifier regression coverage).
- 2026-02-18 [CODE] Now: Realtime Phases 1-4 are complete; inbound path is socket-first with polling fallback/reconnect catch-up, outbound remains REST.
- 2026-02-18 [CODE] Next: Execute Phase 5 fallback/catch-up resilience tuning (socket-healthy polling reduction + degraded-mode recovery rules).
- 2026-02-18 [CODE] Phase 0 outcome: socket auth uses query `guid` credential; bearer auth is not required for handshake.
- 2026-02-18 [CODE] Phase 0 outcome: existing `BlueBubblesAuthState.accessToken` is the socket `guid` source; no new credential persistence key is required.
- 2026-02-18 [CODE] Phase 0 outcome: message events are `new-message` and `updated-message`; payload may be raw message or an envelope containing `data` plus optional `encrypted`/`partial` metadata.
- 2026-02-18 [CODE] Phase 0 outcome: realtime mode is gated to BlueBubbles server version `>= 1.6.0`; older versions stay polling-only.
- 2026-02-18 [ASSUMPTION] Real-world frequency/coverage of `encrypted: true` socket payloads across deployed servers is UNCONFIRMED.

## Invariants / Constraints
- 2026-02-17 [USER] Preserve existing architecture: UI calls `connectionManager`; transport-specific logic stays in `bluebubblesCommunicationsManager`.
- 2026-02-17 [USER] Avoid silent fallback behavior; failures should surface.

## Decisions
- 2026-02-17 [CODE] D001 ACTIVE: Keep polling model, but page until exhaustion when a cursor exists (`ASC` + `ROWID > cursor`) to prevent missed pages.
- 2026-02-17 [CODE] D002 ACTIVE: Implement BlueBubbles `requestRetrievalTime`/`requestRetrievalID` as polling cursor priming + immediate catch-up trigger instead of returning `false`.
- 2026-02-17 [CODE] D003 ACTIVE: Update poll cursor from both polling and latest-thread fetches, and emit `onIDUpdate` when row cursor advances.
- 2026-02-17 [CODE] D004 ACTIVE: Emit a lightweight `Poll cycle` debug summary only for catch-up-triggered cycles, multi-page cycles, or cursor-stall protection events to keep default polling logs low-noise.
- 2026-02-18 [CODE] D005 ACTIVE: Treat quoted text reactions without `associatedMessageGuid` as a text-tapback channel; keep legacy SMS phrase parsing and add explicit emoji reaction parsing for iMessage-era `Reacted <emoji> to “...”` messages.
- 2026-02-18 [CODE] D006 ACTIVE: Realtime migration scope is core chat/attachment/tapback-receive only; defer typing indicators, unsend/edit, and tapback-sending features.
- 2026-02-18 [CODE] D007 ACTIVE: Socket auth uses query param `guid` sourced from `BlueBubblesAuthState.accessToken`; do not add separate raw-password persistence.
- 2026-02-18 [CODE] D008 ACTIVE: Enable socket-first realtime only for server versions `>= 1.6.0`; keep polling-only mode below that floor.
- 2026-02-18 [CODE] D009 ACTIVE: Hydrate socket payloads by GUID conditionally (partial/incomplete payloads only), not always-on.
- 2026-02-18 [CODE] D010 SUPERSEDED: Phase 1 socket event handling used hint-triggered catch-up polling only.
- 2026-02-18 [CODE] D011 ACTIVE: Realtime payload normalization/decryption lives in `src/connection/bluebubbles/realtimePayload.ts` and supports raw/envelope + `JSON_STRING`/`BASE64` + CryptoJS AES envelope decrypt.
- 2026-02-18 [CODE] D012 ACTIVE: Duplicate suppression is fingerprint-based at message emission time to suppress socket/poll overlap while still allowing material message updates.
- 2026-02-18 [CODE] D013 ACTIVE: Thread-level message reconciliation merges server updates by identity (`serverID`/`guid`) even after initial confirmation, preventing temp-guid/final-guid split messages.
- 2026-02-18 [CODE] D014 ACTIVE: Message emission identity now prefers `serverID` keys and records GUID/temp-guid aliases to stabilize dedupe/reconciliation under mixed realtime+poll timing.
- 2026-02-18 [CODE] D015 ACTIVE: Tapback dedupe keys reaction events by reaction GUID + tapback fingerprint so duplicate payloads are suppressed without dropping same-GUID add/remove updated-message transitions.

## Done (recent)
- 2026-02-18 [CODE] Updated BlueBubbles reaction dedupe to fingerprint by logical tapback state while keyed by reaction GUID.
- 2026-02-18 [CODE] Added same-GUID emoji tapback update regression coverage in `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`.
- 2026-02-18 [CODE] Added realtime/poll overlap modifier dedupe regression coverage in `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`.
- 2026-02-18 [CODE] Updated `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md` + `project.md` for Phase 4 completion and Phase 5/6 focus.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed (34 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after Phase 4 work (13 suites, 82 tests).
- 2026-02-18 [TOOL] `npm run build` passed after Phase 4 work (webpack success; non-blocking size/precache warnings only).

## Open Questions
- 2026-02-17 [ASSUMPTION] Does every target BlueBubbles server version guarantee `message.ROWID` monotonicity across relevant queries? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Does deployed runtime profile still show perceptible scroll judder after the recent fix? UNCONFIRMED pending manual QA.
- 2026-02-18 [ASSUMPTION] Do all server/device combinations use currently parsed emoji-reaction prefix patterns (`Reacted <emoji> to`, `Removed ... <emoji> from`)? UNCONFIRMED pending live captures.
- 2026-02-18 [ASSUMPTION] For target deployments, how often are socket events delivered with `encrypted: true` requiring client-side decrypt before hydration? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] How frequently do deployed servers emit same-GUID tapback state transitions via `updated-message` (add -> remove) versus distinct reaction rows? UNCONFIRMED.

## Working set
- 2026-02-18 [CODE] `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts`
- 2026-02-18 [CODE] `src/components/messaging/thread/DetailThread.tsx`
- 2026-02-18 [CODE] `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`
- 2026-02-18 [CODE] `test/components/messaging/thread/DetailThread.test.tsx`
- 2026-02-18 [CODE] `src/connection/bluebubbles/realtimeChannel.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/realtimePayload.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/realtimePayload.test.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/realtimeChannel.test.ts`
- 2026-02-18 [CODE] `src/connection/bluebubbles/api.ts`
- 2026-02-18 [CODE] `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md`
- 2026-02-18 [CODE] `project.md`
- 2026-02-18 [CODE] `CONTINUITY.md`

## Receipts
- 2026-02-17 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed.
- 2026-02-17 [TOOL] `npm test -- --runInBand` passed (11 suites, 57 tests).
- 2026-02-18 [TOOL] `npm run build` passed after scroll/lazy-load fix (non-blocking webpack asset/perf warnings only).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after scroll/lazy-load fix (11 suites, 57 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after emoji tapback updates (20 tests in suite).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after emoji tapback updates (11 suites, 60 tests).
- 2026-02-18 [TOOL] `npm run build` passed after emoji tapback updates (non-blocking webpack asset/perf warnings only).
- 2026-02-18 [TOOL] Static trace: `bluebubbles-app/lib/services/network/socket_service.dart` confirms websocket query auth `guid` and event listeners for `new-message` / `updated-message`.
- 2026-02-18 [TOOL] Static trace: `bluebubbles-app/lib/services/backend/action_handler.dart` + `lib/database/global/server_payload.dart` confirms envelope parsing via `data` with optional metadata.
- 2026-02-18 [TOOL] Static trace: `src/components/SignInGate.tsx` + `src/util/bluebubblesAuth.ts` confirms persisted `accessToken`/legacy auth model is sufficient for socket credential source.
- 2026-02-18 [TOOL] Updated `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md`, `project.md`, and `CONTINUITY.md` to mark Phase 0 completion and Phase 1 readiness.
- 2026-02-18 [TOOL] User-installed dependency confirmed: `socket.io-client` present in `package.json` and `package-lock.json`.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimeChannel.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed (25 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed (12 suites, 65 tests).
- 2026-02-18 [TOOL] `npm run build` passed after realtime-channel integration (non-blocking warnings only).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/realtimePayload.test.ts test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed (31 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after Phase 2 implementation (13 suites, 74 tests).
- 2026-02-18 [TOOL] `npm run build` passed after Phase 2 implementation (webpack success; non-blocking size/precache warnings only).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/components/messaging/thread/DetailThread.test.tsx test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after Phase 3 changes (33 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after Phase 3 changes (13 suites, 79 tests).
- 2026-02-18 [TOOL] `npm run build` passed after Phase 3 changes (webpack success; non-blocking size/precache warnings only).
- 2026-02-18 [CODE] Updated `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md` + `project.md` + `CONTINUITY.md` to mark Phase 3 completion and Phase 4 next steps.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after Phase 4 changes (34 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after Phase 4 changes (13 suites, 82 tests).
- 2026-02-18 [TOOL] `npm run build` passed after Phase 4 changes (webpack success; non-blocking warnings only).
- 2026-02-18 [CODE] Updated `BLUEBUBBLES_REALTIME_IMPLEMENTATION_PLAN.md` + `project.md` + `CONTINUITY.md` to mark Phase 4 completion and Phase 5 next steps.
