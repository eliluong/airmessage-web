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

## Invariants / Constraints
- 2026-02-17 [USER] Preserve existing architecture: UI calls `connectionManager`; transport-specific logic stays in `bluebubblesCommunicationsManager`.
- 2026-02-17 [USER] Avoid silent fallback behavior; failures should surface.

## Decisions
- 2026-02-17 [CODE] D001 ACTIVE: Keep polling model, but page until exhaustion when a cursor exists (`ASC` + `ROWID > cursor`) to prevent missed pages.
- 2026-02-17 [CODE] D002 ACTIVE: Implement BlueBubbles `requestRetrievalTime`/`requestRetrievalID` as polling cursor priming + immediate catch-up trigger instead of returning `false`.
- 2026-02-17 [CODE] D003 ACTIVE: Update poll cursor from both polling and latest-thread fetches, and emit `onIDUpdate` when row cursor advances.
- 2026-02-17 [CODE] D004 ACTIVE: Emit a lightweight `Poll cycle` debug summary only for catch-up-triggered cycles, multi-page cycles, or cursor-stall protection events to keep default polling logs low-noise.

## Done (recent)
- 2026-02-17 [CODE] Added regression test covering >1 poll page catch-up without row skips.
- 2026-02-17 [CODE] Updated `project.md` roadmap with PR #41 note and retrieval-parity wording.
- 2026-02-17 [CODE] Added `Poll cycle` debug telemetry (source/pages/messages/items/modifiers/cursor movement/end reason) and test assertion that multi-page catch-up emits expected metrics.
- 2026-02-18 [CODE] Traced message-pane scroll/lazy-load path and identified threshold-induced reflow/rerender sources of judder.
- 2026-02-18 [CODE] Refactored `MessageList` threshold tracking to instance properties (removed scroll-threshold React state updates).
- 2026-02-18 [CODE] Moved near-bottom future loader out of flow layout in `DetailThread` and into an overlay.
- 2026-02-18 [CODE] Memoized `Message` rows and synchronized history/future load-state refs to reduce redundant near-threshold work.

## Open Questions
- 2026-02-17 [ASSUMPTION] Does every target BlueBubbles server version guarantee `message.ROWID` monotonicity across all relevant queries? UNCONFIRMED.
- 2026-02-18 [ASSUMPTION] Does the deployed runtime profile (browser + thread size + media load) still show perceptible judder after this patch? UNCONFIRMED pending manual QA.

## Working set
- 2026-02-18 [CODE] `src/components/messaging/thread/MessageList.tsx`
- 2026-02-18 [CODE] `src/components/messaging/thread/DetailThread.tsx`
- 2026-02-18 [CODE] `src/components/messaging/thread/item/Message.tsx`
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
