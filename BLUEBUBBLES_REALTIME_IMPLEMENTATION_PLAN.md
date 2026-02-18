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
### Goals
- Ensure received tapbacks continue to work across realtime and fallback paths.

### Tasks
- Route reaction-bearing `updated-message` events through existing modifier generation.
- Preserve current emoji/text tapback parsing behavior.
- Ensure modifier dedupe avoids repeated sound/playback side effects.

### Exit Criteria
- Received tapbacks display correctly in thread bubbles.
- No duplicate tapback chips or repeated notification sounds.

## Phase 5: Fallback, Catch-Up, And Resilience
### Goals
- Make socket primary and polling secondary without losing reliability.

### Tasks
- Define socket-healthy behavior (reduce/disable interval poll while healthy).
- Define degraded behavior (resume periodic poll when socket fails).
- Keep explicit catch-up triggers (`requestRetrievalID` / `requestRetrievalTime`) active.
- On reconnect, run immediate catch-up poll cycle before returning to steady-state.
- Maintain existing debug telemetry for cursor movement and cycle summaries.

### Exit Criteria
- Offline/online transitions recover without page reload.
- Missed-message recovery remains deterministic with socket interruptions.

## Phase 6: QA, Rollout, And Documentation
### Goals
- Validate behavior and land with clear operational guidance.

### Tasks
- Unit tests for socket event mapping, dedupe, cursor advancement, and fallback switching.
- Integration tests for mixed socket + poll scenarios and reconnect catch-up.
- Manual validation matrix:
- normal inbound/outbound text.
- normal inbound/outbound attachments.
- received tapbacks.
- browser sleep/wake and temporary network loss.
- Update migration docs (`project.md`) with implementation status and follow-up work.

### Exit Criteria
- Test suite passes.
- Manual validation confirms realtime delivery and reconnect recovery.
- Roadmap/documentation updated with final behavior and known limitations.

## Phase 0 Decision Log
- Socket auth credential source and persistence model: resolved (reuse `BlueBubblesAuthState.accessToken` as socket `guid`; no new credential storage key).
- Minimum supported BlueBubbles server version for realtime mode: resolved (`>= 1.6.0`).
- Payload hydration strategy: resolved (conditional by payload completeness, not always-on).
