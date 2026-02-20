# AirMessage Web Optimization and Feature Deep-Dive Backlog

Date: 2026-02-20  
Source: planning-only architecture/code review (no runtime code changes)

## Purpose
This document captures the current optimization, revision, and feature opportunities as independent deep-dive items so each can be investigated and executed individually.

## How to use this backlog
1. Pick one item ID.
2. Run the checklist under that item.
3. Capture findings in a short design note and decide go/no-go.
4. Implement in a focused PR with tests/validation.
5. Mark status and record follow-up IDs if split.

## Status legend
- `Backlog`: not started
- `Investigating`: deep-dive in progress
- `Planned`: scoped and accepted
- `In Progress`: implementation active
- `Done`: validated and merged
- `Deferred`: intentionally postponed

## Priority legend
- `P0`: bug, security, or major reliability/perf risk
- `P1`: high-value optimization
- `P2`: meaningful but not urgent

## Item index
| ID | Priority | Type | Title | Status |
|---|---|---|---|---|
| PERF-001 | P0 | Finding | Promise map cleanup bug in conversation info handler | Done |
| PERF-002 | P0 | Finding | Debug logging default-on with high-volume payload logs | Backlog |
| PERF-003 | P0 | Finding | Client-side LinkPreview key exposure and sensitive URL logging | Backlog |
| PERF-004 | P1 | Finding | Overly coarse chat/query scan pagination defaults | Backlog |
| PERF-005 | P1 | Finding | Sidebar/search lists are not virtualized | Planned |
| PERF-006 | P1 | Finding | O(n^2)-style merge/update paths in state reducers | Backlog |
| PERF-007 | P1 | Finding | Realtime hydration is serial and queue backpressure is weak | Backlog |
| PERF-008 | P1 | Finding | Several caches can grow unbounded in long sessions | Backlog |
| PERF-009 | P2 | Finding | Direct/BFF API normalization logic duplicated across modules | Backlog |
| PERF-010 | P1 | Finding | Bundle and static assets are oversized for initial load | Backlog |
| REV-001 | P1 | Revision | Rework contact search to server-assisted model | Backlog |
| REV-002 | P1 | Revision | Rework link scanning to incremental index model | Backlog |
| REV-003 | P2 | Revision | Rework edited-message grouping to incremental processing | Backlog |
| REV-004 | P1 | Revision | Simplify transport surface for single-user deployment | Backlog |
| REV-005 | P2 | Revision | Move toward normalized store + selector architecture | Backlog |
| NEW-001 | P2 | Feature | Typing indicators and presence | Backlog |
| NEW-002 | P1 | Feature | Offline-first storage and reconnect diff-sync | Backlog |
| NEW-003 | P2 | Feature | Connection health and diagnostics panel | Backlog |
| NEW-004 | P2 | Feature | Bandwidth-aware media and preload modes | Backlog |
| NEW-005 | P2 | Feature | Advanced message search UX | Backlog |

---

## PERF-001: Promise map cleanup bug in conversation info handler
- Priority: `P0`
- Status: `Done` (2026-02-20)
- Problem: `onConversationUpdate` clears `threadPromiseMap` instead of `conversationDetailsPromiseMap`, leaving stale entries and possible memory growth.
- Evidence:
- `src/connection/connectionManager.ts:350`
- `src/connection/connectionManager.ts:356`
- Design note: `notes/PERF-001.md`
- Deep-dive checklist:
- [x] Reproduce stale map entries with repeated conversation info requests.
- [x] Confirm timeout path and cleanup behavior under failure.
- [x] Validate no regression in thread fetch promise lifecycle.
- [x] Add targeted unit test for correct map cleanup.
- Exit criteria:
- `conversationDetailsPromiseMap` is correctly cleaned in success/error/timeout paths.

## PERF-002: Debug logging default-on with high-volume payload logs
- Priority: `P0`
- Status: `Backlog`
- Problem: Debug logging starts enabled and emits large message/tapback/realtime payload logs in normal runs.
- Evidence:
- `src/connection/bluebubbles/debugLogging.ts:3`
- `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts:1277`
- `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts:1329`
- Deep-dive checklist:
- [ ] Measure console volume and CPU cost during busy sessions.
- [ ] Audit logs for sensitive payload fields.
- [ ] Decide default (`false` recommended for production-like builds).
- [ ] Keep explicit settings toggle and document intended usage.
- Exit criteria:
- Default runtime has low/no verbose transport logs unless explicitly enabled.

## PERF-003: Client-side LinkPreview key exposure and sensitive URL logging
- Priority: `P0`
- Status: `Backlog`
- Problem: Link preview API key is used directly in browser requests and full request URL is logged.
- Evidence:
- `src/hooks/useMessageLinkPreview.ts:121`
- `src/hooks/useMessageLinkPreview.ts:123`
- `src/hooks/useMessageLinkPreview.ts:133`
- Deep-dive checklist:
- [ ] Verify key exposure in network traces.
- [ ] Design BFF proxy endpoint with server-side caching and rate limit.
- [ ] Remove or redact URL/key logging.
- [ ] Define fallback behavior for proxy failures.
- Exit criteria:
- Browser no longer carries third-party preview API key; logs redact sensitive query data.

## PERF-004: Overly coarse chat/query scan pagination defaults
- Priority: `P1`
- Status: `Backlog`
- Problem: Several flows default to very large pages (`1000`), increasing payload size and latency.
- Evidence:
- `src/connection/bluebubbles/api.ts:326`
- `src/connection/bluebubbles/bff/api.ts:252`
- `src/state/useConversationContactSearch.ts:34`
- Deep-dive checklist:
- [ ] Collect payload/latency baselines for current page sizes.
- [ ] Tune page size per workflow (initial load, infinite list, scan).
- [ ] Confirm UX with progressive rendering.
- [ ] Ensure parity between direct and BFF transport behavior.
- Exit criteria:
- Initial load uses targeted page sizes and avoids large monolithic fetches.

## PERF-005: Sidebar/search lists are not virtualized
- Priority: `P1`
- Status: `Planned` (2026-02-20)
- Problem: Full lists render all rows and use transitions/highlighting work that scales poorly.
- Evidence:
- `src/components/messaging/master/Sidebar.tsx:686`
- `src/components/messaging/master/Sidebar.tsx:820`
- `src/components/messaging/master/ListConversation.tsx:44`
- `src/components/messaging/master/Sidebar.tsx:922`
- `src/util/dateUtils.ts:58`
- Runtime evidence (Playwright deep-dive, 2026-02-20, `https://air2.thecemetary.org`):
- People mode row growth loaded into one non-virtualized DOM list: `50 rows / 745 nodes` -> `250 rows / 3812 nodes` -> `300 rows / 4557 nodes`.
- Viewport shows about `12` conversation rows while up to `238` rows remain mounted offscreen.
- At `300` rows, wrapper overhead from transitions is significant: `300` `.MuiCollapse-root`, `300` `.MuiCollapse-wrapper`, `300` `.MuiCollapse-wrapperInner`.
- Message search with query `the` rendered `89` rows and `840` nodes with only about `11` visible rows; highlight segmentation added `128` `<mark>` nodes.
- Approximate conversation-list DOM growth rate is linear at about `15.3` nodes per additional row.
- Proposed fix (planning-only, no code changes yet):
- Implementation prerequisite: install `@tanstack/react-virtual` (`npm install @tanstack/react-virtual`).
- Replace people-mode conversation rendering (`TransitionGroup` + full `map`) with a virtualized window that renders only visible rows plus overscan.
- Replace message-search results full `map` with the same virtualization model and maintain scroll persistence with existing `searchCache` view state.
- Keep infinite loading behavior by triggering `onLoadMoreConversations` when the virtualizer nears the loaded range end.
- Replace per-row `useLiveLastUpdateStatusTime` timers with a shared minute ticker per list surface so timestamp updates do not scale linearly with row count.
- Deep-dive checklist:
- [x] Measure render and scroll performance with large datasets.
- [x] Introduce list virtualization plan for conversations and search results.
- [x] Replace per-row live timers with shared ticker plan.
- [ ] Validate keyboard navigation and focus behavior post-virtualization.
- Exit criteria:
- Stable scroll and low commit cost on large conversation/search result sets.

## PERF-006: O(n^2)-style merge/update paths in state reducers
- Priority: `P1`
- Status: `Backlog`
- Problem: Multiple update paths repeatedly search arrays during message/conversation reconciliation.
- Evidence:
- `src/state/conversationState.ts:96`
- `src/state/conversationState.ts:199`
- `src/components/messaging/thread/DetailThread.tsx:474`
- `src/components/messaging/thread/DetailThread.tsx:577`
- Deep-dive checklist:
- [ ] Profile hot paths under bursty inbound updates.
- [ ] Introduce temporary index maps (`guid`, `serverID`, `localID`) per update cycle.
- [ ] Validate ordering rules and dedupe correctness.
- [ ] Add regression tests for duplicate suppression and reorder behavior.
- Exit criteria:
- Update complexity reduced and behavior preserved under load.

## PERF-007: Realtime hydration is serial and queue backpressure is weak
- Priority: `P1`
- Status: `Backlog`
- Problem: Realtime candidate hydration executes sequentially and queue chaining can backlog during high event rates.
- Evidence:
- `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts:672`
- `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts:686`
- `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts:757`
- Deep-dive checklist:
- [ ] Benchmark event throughput and queue delay under synthetic bursts.
- [ ] Add bounded concurrency for hydration fetches.
- [ ] Add queue depth metrics/logging and overload safeguards.
- [ ] Verify no ordering regressions for modifiers/tapbacks.
- Exit criteria:
- Realtime processing keeps up under expected message burst levels.

## PERF-008: Several caches can grow unbounded in long sessions
- Priority: `P1`
- Status: `Backlog`
- Problem: Some in-memory caches are not bounded by entry count/size and can grow over long runtimes.
- Evidence:
- `src/hooks/useConversationLinks.ts:35`
- `src/state/useAttachmentThumbnails.ts:24`
- `src/util/linkPreviewCache.ts:17`
- Deep-dive checklist:
- [ ] Quantify memory growth over prolonged active sessions.
- [ ] Add size-limited LRU strategy to relevant caches.
- [ ] Define eviction metrics and observability hooks.
- [ ] Consider IndexedDB for larger persistent payload classes.
- Exit criteria:
- Cache growth is bounded and predictable across long sessions.

## PERF-009: Direct/BFF API normalization logic duplicated across modules
- Priority: `P2`
- Status: `Backlog`
- Problem: Metadata/features normalization and request shaping are duplicated in direct and BFF clients, increasing drift risk.
- Evidence:
- `src/connection/bluebubbles/api.ts:230`
- `src/connection/bluebubbles/bff/api.ts:167`
- Deep-dive checklist:
- [ ] Enumerate duplicated transforms and schema assumptions.
- [ ] Extract shared normalizers into common module.
- [ ] Add contract tests to keep direct/BFF parity.
- [ ] Verify unchanged error surfaces to UI.
- Exit criteria:
- Shared normalization layer with reduced duplication and parity tests.

## PERF-010: Bundle and static assets are oversized for initial load
- Priority: `P1`
- Status: `Backlog`
- Problem: Main bundle and font/audio assets are heavy; warnings indicate startup and caching impact.
- Evidence:
- `webpack.config.js:122`
- `public/index.css:7`
- `public/fonts/noto-glyf_colr_1.ttf`
- `public/fonts/noto-glyf_colr_1.woff2`
- `public/fonts/noto-color-emoji-v36-emoji-regular.woff2`
- Deep-dive checklist:
- [ ] Produce bundle analyzer snapshot and route-level chunk map.
- [ ] Split low-frequency UI surfaces via dynamic import.
- [ ] Reduce or subset emoji/font assets; evaluate fallback strategy.
- [ ] Revisit audio/font preload and service-worker precache policy.
- Exit criteria:
- Main entry size and critical path transfer size are materially reduced.

---

## REV-001: Rework contact search to server-assisted model
- Priority: `P1`
- Status: `Backlog`
- Problem: Contact search currently mixes local filtering with large remote scans.
- Evidence:
- `src/state/useConversationContactSearch.ts:69`
- `src/state/useConversationContactSearch.ts:85`
- Deep-dive checklist:
- [ ] Define BFF search contract for conversation lookup.
- [ ] Move expensive scan/filter server-side with pagination.
- [ ] Preserve local instant results while remote augment loads.
- Exit criteria:
- Contact search latency and network cost scale with query intent, not full dataset size.

## REV-002: Rework link scanning to incremental index model
- Priority: `P1`
- Status: `Backlog`
- Problem: Link extraction repeatedly scans message text for current lists and backfills.
- Evidence:
- `src/hooks/useConversationLinks.ts:54`
- `src/hooks/useConversationLinks.ts:247`
- Deep-dive checklist:
- [ ] Design per-conversation link index update on message ingress.
- [ ] Keep deep-history backfill optional and resumable.
- [ ] Add cache invalidation rules for edited/deleted messages.
- Exit criteria:
- Link drawer avoids repeated full re-scan of existing message arrays.

## REV-003: Rework edited-message grouping to incremental processing
- Priority: `P2`
- Status: `Backlog`
- Problem: Edited message grouping currently reprocesses full item sets.
- Evidence:
- `src/components/messaging/thread/hooks/useEditedMessageGroups.ts:94`
- `src/components/messaging/thread/hooks/useEditedMessageGroups.ts:208`
- Deep-dive checklist:
- [ ] Evaluate incremental algorithm keyed by message identity.
- [ ] Persist edit metadata alongside message state updates.
- [ ] Preserve heuristic correctness for ambiguous edit strings.
- Exit criteria:
- Edit grouping cost scales with deltas, not entire thread size.

## REV-004: Simplify transport surface for single-user deployment
- Priority: `P1`
- Status: `Backlog`
- Problem: Fork currently carries direct-mode, legacy compatibility, and Comm5 pathways not central to single-user BFF-first usage.
- Evidence:
- `src/connection/bluebubbles/transport.ts:79`
- `src/connection/connectionManager.ts:77`
- `project.md` outstanding/future sections
- Deep-dive checklist:
- [ ] Confirm required compatibility matrix for your deployment only.
- [ ] Decide whether to gate or remove unused transport branches.
- [ ] Quantify resulting reduction in code surface and test matrix.
- Exit criteria:
- Transport behavior is intentionally minimal for actual deployment needs.

## REV-005: Move toward normalized store plus selector architecture
- Priority: `P2`
- Status: `Backlog`
- Problem: Global emitter + array mutation paths make selective rerender control and instrumentation harder at scale.
- Evidence:
- `src/state/conversationState.ts:61`
- `src/components/messaging/thread/DetailThread.tsx:456`
- Deep-dive checklist:
- [ ] Define normalized entities (`conversation`, `message`, `modifier`) and indexes.
- [ ] Introduce selectors for targeted UI subscriptions.
- [ ] Migrate incrementally, preserving current event contracts during transition.
- Exit criteria:
- State updates are more explicit, testable, and render-efficient.

---

## NEW-001: Typing indicators and presence
- Priority: `P2`
- Status: `Backlog`
- Problem: Server capabilities suggest support, but UI/client flow is not implemented.
- Evidence:
- `project.md` future enhancements
- `src/connection/bluebubbles/types.ts`
- Deep-dive checklist:
- [ ] Confirm event contracts from BlueBubbles/BFF.
- [ ] Define debounce/timeout behavior for typing presence.
- [ ] Implement UX and accessibility semantics in thread UI.
- Exit criteria:
- Typing state is accurate, timely, and non-disruptive.

## NEW-002: Offline-first storage and reconnect diff-sync
- Priority: `P1`
- Status: `Backlog`
- Problem: Session resilience and cold-start speed can improve with persistent indexed storage.
- Evidence:
- `src/state/localMessageCache.ts:4`
- `src/state/mediaCache.ts:20`
- Deep-dive checklist:
- [ ] Define IndexedDB schema for conversations/messages/media metadata.
- [ ] Implement startup hydration with freshness/consistency checks.
- [ ] Reconcile reconnect deltas and conflict strategy.
- Exit criteria:
- Fast startup with meaningful offline readability and safe resync.

## NEW-003: Connection health and diagnostics panel
- Priority: `P2`
- Status: `Backlog`
- Problem: Connection state transitions are observable internally but not surfaced as user diagnostics.
- Evidence:
- `src/connection/bluebubbles/bluebubblesCommunicationsManager.ts:569`
- `src/connection/bluebubbles/bff/realtimeChannel.ts:133`
- Deep-dive checklist:
- [ ] Define user-facing health model (socket, polling fallback, last sync).
- [ ] Surface key events with concise troubleshooting hints.
- [ ] Avoid noisy alerts during expected transient reconnects.
- Exit criteria:
- Users can self-diagnose common connection states without logs.

## NEW-004: Bandwidth-aware media and preload modes
- Priority: `P2`
- Status: `Backlog`
- Problem: Media warmup exists but can be expanded into explicit user-selectable data modes.
- Evidence:
- `src/state/useConversationMedia.ts:118`
- `src/state/useAttachmentThumbnails.ts:67`
- Deep-dive checklist:
- [ ] Define data mode settings (auto/low/high quality).
- [ ] Apply to thumbnail size, prefetch behavior, and retry policy.
- [ ] Validate UX impact on constrained networks.
- Exit criteria:
- Users can trade quality vs bandwidth predictably.

## NEW-005: Advanced message search UX
- Priority: `P2`
- Status: `Backlog`
- Problem: Base search exists but lacks richer filters and pagination affordances.
- Evidence:
- `src/state/useMessageSearch.ts:29`
- `src/components/messaging/master/Sidebar.tsx:649`
- Deep-dive checklist:
- [ ] Add sender/attachment/service filters.
- [ ] Add pageable/infinite search result navigation.
- [ ] Preserve scroll state and quick jump-to-thread behavior.
- Exit criteria:
- Search supports deeper historical investigation with responsive UX.

---

## Suggested execution order
1. `PERF-001`
2. `PERF-002`
3. `PERF-003`
4. `PERF-004`
5. `PERF-005`
6. `PERF-006`
7. `PERF-007`
8. `PERF-008`
9. `PERF-010`
10. `REV-001` through `REV-005`
11. `NEW-001` through `NEW-005`

## Notes
- This backlog is intentionally implementation-agnostic; it is for investigation sequencing and scoping.
- When starting any item, create a short design note named `notes/<ID>.md` to capture decision rationale and metrics.
