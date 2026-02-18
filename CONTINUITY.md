# CONTINUITY

## Snapshot
- 2026-02-17 [USER] Goal: Fix BlueBubbles web client so messages received while the computer/browser is offline are shown without requiring a manual page reload.
- 2026-02-17 [USER] Success criteria: After reconnect/wake, backlog messages are fetched and rendered automatically; new live messages continue arriving.
- 2026-02-17 [CODE] Root cause: Polling used `limit: 50` with `ROWID > lastRowId` and advanced cursor to newest row in the returned page, which can skip intermediate backlog pages when >50 messages arrive during downtime.
- 2026-02-17 [CODE] Secondary reliability gap: BlueBubbles retrieval hooks returned `false`, so reconnect-time missed-message requests could not explicitly trigger catch-up polling.
- 2026-02-17 [CODE] Now: Polling is paginated with cursor-safe advancement; retrieval requests prime cursors and trigger immediate catch-up; poll-cycle telemetry now logs page count/cursor movement for catch-up diagnostics.
- 2026-02-17 [CODE] Next: User validation in a real sleep/wake workflow against a BlueBubbles server (UNCONFIRMED until manual QA).
- 2026-02-17 [ASSUMPTION] `message.originalROWID` is strictly increasing and suitable as the durable poll cursor.
- 2026-02-18 [USER] Goal: Diagnose brief scroll judder near the latest-message threshold in the right message pane when scrolling back down after loading older messages.
- 2026-02-18 [CODE] Likely cause: Near-bottom threshold crossing triggers `requestFuture`, toggles `futureLoadState`, and mounts/unmounts a bottom loader in `MessageList`, changing scroll height and causing visible jump.
- 2026-02-18 [CODE] Likely cause: Threshold flags (`isFutureInThreshold` / `isHistoryInThreshold`) are stored in component state, so threshold crossing causes full message-list rerenders at the exact boundary where the judder is observed.
- 2026-02-18 [CODE] Risk amplifier: Message rows are not memoized, so these rerenders traverse all rendered messages.
- 2026-02-18 [CODE] Fix implemented: threshold tracking moved to instance refs/properties (no threshold state rerenders), near-bottom loader moved to overlay (no list-height shift), and message rows are memoized.
- 2026-02-18 [CODE] Supersedes prior UNCONFIRMED duplicate-fetch concern by writing history/future load-state refs synchronously before/after async fetches.
- 2026-02-18 [CODE] Now: Build and tests pass after the scroll/lazy-load fix.
- 2026-02-18 [CODE] Next: Manual UX validation in browser to confirm judder is resolved on long threads.
- 2026-02-18 [USER] Goal: Parse iOS emoji reaction text (example `Reacted 🎊 to “...”`) as tapbacks and attach them to the original message instead of rendering the reaction text as a standalone message.
- 2026-02-18 [CODE] Root cause: BlueBubbles emoji reaction messages can arrive with `associatedMessageGuid`/`associatedMessageType` unset, so existing logic bypassed iMessage tapback mapping and treated them as normal messages.
- 2026-02-18 [CODE] Fix implemented: Added emoji text-reaction parsing (`Reacted <emoji> to “...”` + removal form), reused target-resolution cache for all services, and threaded `tapbackEmoji` through modifier/state/UI chip rendering.
- 2026-02-18 [CODE] Now: Jest and build pass with new iMessage emoji tapback regression coverage.
- 2026-02-18 [CODE] Next: Manual QA against a live BlueBubbles server to confirm real device emoji-reaction phrasing variants map correctly.

## Invariants / Constraints
- 2026-02-17 [USER] Preserve existing architecture: UI calls `connectionManager`; transport-specific logic stays in `bluebubblesCommunicationsManager`.
- 2026-02-17 [USER] Avoid silent fallback behavior; failures should surface.

## Decisions
- 2026-02-17 [CODE] D001 ACTIVE: Keep polling model, but page until exhaustion when a cursor exists (`ASC` + `ROWID > cursor`) to prevent missed pages.
- 2026-02-17 [CODE] D002 ACTIVE: Implement BlueBubbles `requestRetrievalTime`/`requestRetrievalID` as polling cursor priming + immediate catch-up trigger instead of returning `false`.
- 2026-02-17 [CODE] D003 ACTIVE: Update poll cursor from both polling and latest-thread fetches, and emit `onIDUpdate` when row cursor advances.
- 2026-02-17 [CODE] D004 ACTIVE: Emit a lightweight `Poll cycle` debug summary only for catch-up-triggered cycles, multi-page cycles, or cursor-stall protection events to keep default polling logs low-noise.
- 2026-02-18 [CODE] D005 ACTIVE: Treat quoted text reactions without `associatedMessageGuid` as a text-tapback channel; keep legacy SMS phrase parsing and add explicit emoji reaction parsing for iMessage-era `Reacted <emoji> to “...”` messages.

## Done (recent)
- 2026-02-18 [CODE] Identified emoji reaction miss path: `associatedMessageGuid` null caused `Reacted 🎊 to “...”` payloads to render as ordinary message text.
- 2026-02-18 [CODE] Added emoji text-tapback parser and unified target-resolution path (`resolveTextTapbackTargetGuid`) with cached lookup fallback.
- 2026-02-18 [CODE] Expanded tapback domain model (`TapbackType.Emoji`, `tapbackEmoji`) and ensured reducer/sound dedupe logic account for emoji payload changes.
- 2026-02-18 [CODE] Updated tapback chip rendering to show emoji glyph chips while preserving standard icon chips.
- 2026-02-18 [CODE] Added regression coverage for iMessage emoji reactions (same-batch + cache-fallback resolution cases) and documented the milestone in `project.md`.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after emoji tapback implementation.
- 2026-02-18 [TOOL] `npm test -- --runInBand` and `npm run build` passed after emoji tapback implementation.

## Open Questions
- 2026-02-17 [ASSUMPTION] Does every target BlueBubbles server version guarantee `message.ROWID` monotonicity across all relevant queries? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Does the deployed runtime profile (browser + thread size + media load) still show perceptible judder after this patch? UNCONFIRMED pending manual QA.
- 2026-02-18 [ASSUMPTION] Do all server/device combinations use the parsed emoji-reaction prefix patterns (`Reacted <emoji> to`, `Removed ... <emoji> from`)? UNCONFIRMED pending live captures.

## Working set
- 2026-02-18 [CODE] `src/components/messaging/thread/DetailThread.tsx`
- 2026-02-18 [CODE] `src/components/messaging/thread/item/bubble/TapbackChip.tsx`
- 2026-02-18 [CODE] `src/components/messaging/thread/item/bubble/TapbackRow.tsx`
- 2026-02-18 [CODE] `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts`
- 2026-02-18 [CODE] `src/data/blocks.ts`
- 2026-02-18 [CODE] `src/data/stateCodes.ts`
- 2026-02-18 [CODE] `src/state/conversationState.ts`
- 2026-02-18 [CODE] `test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts`
- 2026-02-18 [CODE] `project.md`
- 2026-02-18 [CODE] `CONTINUITY.md`

## Receipts
- 2026-02-17 [TOOL] `npm run build` passed (webpack compile success; non-blocking asset-size warnings).
- 2026-02-17 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed.
- 2026-02-17 [TOOL] `npm test -- --runInBand` passed (11 suites, 57 tests).
- 2026-02-17 [TOOL] Re-ran targeted and full Jest after telemetry addition; both passed (`test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` and full suite).
- 2026-02-18 [TOOL] Static code trace (`rg`, `nl`, `sed`) of `MessageList`/`DetailThread`/`Message` identified threshold-state rerenders and future-loader mount/unmount as likely sources of visible near-bottom scroll judder.
- 2026-02-18 [TOOL] `npm run build` passed after scroll/lazy-load fix (same non-blocking Webpack asset-size warnings).
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after scroll/lazy-load fix (11 suites, 57 tests).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/components/messaging/thread/DetailThread.test.tsx` passed after follow-up ref-sync cleanup.
- 2026-02-18 [TOOL] Static code trace (`rg`, `nl`, `sed`) confirmed tapback flow only recognized associated-guid reactions or SMS phrase tapbacks before emoji parser change.
- 2026-02-18 [TOOL] `npm test -- --runInBand test/connection/bluebubbles/bluebubblesCommunicationsManager.test.ts` passed after adding iMessage emoji tapback coverage (20 tests in suite).
- 2026-02-18 [TOOL] `npm test -- --runInBand test/components/messaging/thread/DetailThread.test.tsx` passed after tapback emoji reconciliation update.
- 2026-02-18 [TOOL] `npm test -- --runInBand` passed after emoji tapback changes (11 suites, 60 tests).
- 2026-02-18 [TOOL] `npm run build` passed after emoji tapback changes (webpack compile success; existing non-blocking asset/perf warnings only).
