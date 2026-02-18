# BlueBubbles Realtime Implementation Plan

## Objective
Replace interval-only polling with a socket-driven realtime channel while preserving REST for request/response workflows.

## Scope
### In Scope
- URL + password authentication flow only (no Google sign-in).
- Send message (REST), receive message (socket with REST hydration fallback).
- Send attachment (REST), receive attachment updates/messages (socket).
- Display received tapbacks (including existing emoji/text tapback handling).
- Keep app functional across reconnects and offline/online transitions.
- Keep `connectionManager` entrypoints stable; transport logic remains in BlueBubbles transport modules.

### Out of Scope
- Typing indicators.
- Unsend/edit flows.
- Sending tapbacks.
- FaceTime/webhook relay/Firebase integration for this phase.

## Success Criteria
- New inbound messages appear without waiting for the 5s poll interval.
- Outbound message and attachment sending behavior remains unchanged.
- Received tapbacks render correctly and do not duplicate sounds/modifiers.
- Reconnect reliably catches up missed messages after temporary disconnects.
- Polling remains as a controlled fallback, not the primary realtime path.

## Phase 0: Contract And Auth Decisions
### Status
- Completed on 2026-02-18.

### Decisions
- Socket auth uses websocket query param `guid` with the same credential currently used for REST auth (`accessToken` in this client, legacy password in legacy mode).
- Socket auth does not depend on an `Authorization: Bearer ...` header.
- Event names for message ingress are `new-message` and `updated-message`.
- Event payload can be either a raw message object or an envelope object containing `data` plus optional metadata (`encrypted`, `partial`, `type`, `subtype`, `encoding`, `encryptionType`).
- Existing stored sessions do not require credential migration; token-based sessions already persist `accessToken`, and legacy sessions already persist password-equivalent auth in `accessToken` with `legacyPasswordAuth=true`.
- Minimum supported server version for socket-first realtime mode is `>= 1.6.0`.
- Servers below `1.6.0` remain on polling-only behavior.
- GUID hydration policy is conditional: hydrate by GUID only when socket payload is partial or missing fields required by `processMessages(...)`.

### Baseline Phase 0 Fixtures
- `new-message/raw-full`: raw `MessageResponse` JSON object.
- `new-message/envelope-full`: `{data: MessageResponse, encrypted?: false, partial?: false}`.
- `updated-message/envelope-partial`: `{data: {guid, chats}, partial: true}` requiring GUID hydration.
- `updated-message/envelope-string`: `{data: "<json-string>", encoding: "JSON_STRING"}`.

### Exit Criteria
- [x] Auth approach is finalized and documented.
- [x] Event payload contract is captured and baseline fixtures are defined.

## Phase 1: Realtime Channel Foundation
### Status
- Completed on 2026-02-18.

### Goals
- Introduce a socket channel abstraction used by `BlueBubblesCommunicationsManager`.

### Delivered
- Added `socket.io-client` dependency.
- Added `src/connection/bluebubbles/realtimeChannel.ts` with connect/disconnect lifecycle, reconnect/backoff behavior, event subscription/unsubscription (`new-message`, `updated-message`), and socket health/error callbacks.
- Integrated channel startup/teardown into `BlueBubblesCommunicationsManager.initialize()` / `disconnect()`.
- Added server-version gate (`>= 1.6.0`) before enabling realtime channel.
- Kept polling active as fallback, with channel health/event hooks triggering immediate catch-up polls.
- Added unit coverage for channel behavior and manager lifecycle wiring.

### Exit Criteria
- [x] Manager can establish and tear down socket connection cleanly.
- [x] Connection state transitions remain visible through existing `connectionManager` listeners.

## Phase 2: Realtime Message Ingestion
### Status
- Completed on 2026-02-18.

### Goals
- Route socket message events through the same canonical parsing/reconciliation path used today.

### Delivered
- Replaced Phase 1 hint-only socket hooks with queued direct ingestion of `new-message` and `updated-message` events in `BlueBubblesCommunicationsManager`.
- Added `src/connection/bluebubbles/realtimePayload.ts` to normalize raw/envelope payloads, decode `JSON_STRING` / `BASE64`, and decrypt `encrypted` payloads using the BlueBubbles CryptoJS-compatible AES format.
- Added conditional GUID hydration via `/message/query` when socket payloads are partial/incomplete before passing data to `processMessages(...)`.
- Routed realtime-ingested messages through existing `processMessages(...)` and modifier emission flow (`onMessageUpdate` / `onModifierUpdate`).
- Advanced polling cursor markers (`lastRowId`, `lastMessageTimestamp`) from realtime events to keep catch-up behavior deterministic.
- Added duplicate suppression for overlapping socket/poll/outbound message emissions using item fingerprinting.
- Added unit coverage in `test/connection/bluebubbles/realtimePayload.test.ts` and expanded realtime manager ingestion tests in `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`.

### Exit Criteria
- [x] Inbound messages render in near realtime.
- [x] No duplicate conversation items/modifiers under mixed socket/poll conditions.

## Phase 3: Outbound And Attachment Stability
### Status
- Completed on 2026-02-18.

### Goals
- Keep outbound behavior stable while moving inbound updates to socket.

### Delivered
- Kept existing REST send paths in place for `sendMessage` and `sendFile`; no socket-based outbound send path was introduced.
- Hardened outbound reconciliation in thread state to merge confirmed message updates by identity (`serverID` / `guid`) even after initial confirmation, fixing temp-guid-to-final-guid transitions under mixed realtime/poll timing.
- Updated transport duplicate identity handling to prefer stable `serverID` fingerprint keys for message emission dedupe and to track GUID/temp-guid aliases during reconciliation.
- Preserved existing attachment download and thumbnail fetch paths (`requestAttachmentDownload`, `fetchAttachmentThumbnail`) without API contract changes.
- Added Phase 3 coverage in:
  - `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` (REST outbound send, upload progress/completion, attachment download stream callbacks, thumbnail fetch).
  - `test/components/messaging/thread/DetailThread.test.tsx` (confirmed message merge by `serverID` with guid transition).

### Exit Criteria
- [x] Sending messages and attachments behaves the same or better than current baseline.
- [x] No regressions in upload progress, completion, or error handling.

## Phase 4: Tapback And Modifier Consistency
### Status
- Completed on 2026-02-18.

### Goals
- Ensure received tapbacks continue to work across realtime and fallback paths.

### Delivered
- Updated tapback dedupe to key reaction events by reaction GUID plus tapback fingerprint (`messageGuid`/sender/type/emoji/index/add-vs-remove), so exact duplicates are suppressed while same-GUID `updated-message` transitions (add -> remove) still emit modifiers.
- Preserved existing emoji/SMS text tapback parsing behavior and added regression coverage for same-GUID emoji text reaction updates.
- Added realtime overlap coverage proving duplicate modifiers are suppressed when the same tapback arrives from socket first and polling second.

### Exit Criteria
- [x] Received tapbacks display correctly in thread bubbles.
- [x] No duplicate tapback chips or repeated notification sounds.

## Phase 5: Fallback, Catch-Up, And Resilience
### Status
- Completed on 2026-02-18.

### Goals
- Make socket primary and polling secondary without losing reliability.

### Delivered
- Added polling mode synchronization in `BlueBubblesCommunicationsManager` so interval polling is suspended when realtime socket state is healthy (`connected`) and resumed when degraded (`idle`/`connecting`/`disconnected`/`error`) or when realtime is unsupported.
- Kept explicit catch-up triggers active (`requestRetrievalID` / `requestRetrievalTime`) while preserving cursor priming behavior.
- Added resilient catch-up queueing (`pendingCatchupPoll`) so catch-up requests raised during an in-flight poll execute immediately after that cycle finishes.
- Kept reconnect behavior deterministic by continuing immediate catch-up on realtime state transitions (`connected`, `disconnected`, `error`) before steady-state polling mode is re-applied.
- Added Phase 5 regression coverage in `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` for healthy/degraded polling mode switching and queued catch-up execution.

### Exit Criteria
- [x] Offline/online transitions recover without page reload.
- [x] Missed-message recovery remains deterministic with socket interruptions.

## Phase 6: QA, Rollout, And Documentation
### Goals
- Validate behavior and land with clear operational guidance.

### Progress
- 2026-02-18: Added realtime compatibility hardening to reduce false degraded-mode polling on compatible servers:
  - Socket auth now uses a dedicated `socketGuid` credential when available (persisted from auth/password flow), with `accessToken` retained as a fallback source.
  - Socket target normalization now connects to URL origin with explicit `path` (`<basePath>/socket.io`) for subpath/proxy deployments.
  - Realtime channel now enables Engine.IO v3 compatibility (`allowEIO3`) and explicit connect timeout handling to avoid indefinite `connecting` states on mixed-version deployments.
  - Polling fallback transitions now emit explicit diagnostics when interval polling is active because realtime is degraded/unsupported.
  - Server metadata parsing now normalizes wrapped/camelCase responses (`{data:{...}}`) so realtime version gating reads `server_version` correctly instead of defaulting to `undefined`.
  - Added regression coverage in `test/connection/bluebubbles/realtimeChannel.test.ts`, `test/util/bluebubblesAuth.test.ts`, and `test/connection/bluebubbles/api.test.ts`.

### Tasks
- Extend integration tests for mixed socket + poll scenarios and reconnect catch-up edge cases.
- Manual validation matrix:
- normal inbound/outbound text.
- normal inbound/outbound attachments.
- received tapbacks.
- browser sleep/wake and temporary network loss.
- Finalize migration docs (`project.md`) with implementation status and follow-up work.

### Exit Criteria
- Test suite passes.
- Manual validation confirms realtime delivery and reconnect recovery.
- Roadmap/documentation updated with final behavior and known limitations.

## Phase 0 Decision Log
- Socket auth credential source and persistence model: resolved (use `socketGuid` when available; otherwise fall back to `accessToken` for socket `guid` query auth).
- Minimum supported BlueBubbles server version for realtime mode: resolved (`>= 1.6.0`).
- Payload hydration strategy: resolved (conditional by payload completeness, not always-on).
