# Favicon New-Message Indicator Implementation Plan

## Objective
Implement a browser-tab favicon indicator that shows a small red dot when one or more new incoming messages arrive while the tab is not in focus, and clears the dot when the user returns to the tab.

## Status
- 2026-02-20: Phase 0 completed.
- 2026-02-20: `src/util/faviconBadge.ts` added with stable exported API and module-scope singleton manager ownership.
- 2026-02-20: Phase 1 completed.
- 2026-02-20: Canvas-based red-dot rendering and cached badged favicon data URL generation are now implemented in `src/util/faviconBadge.ts`.
- 2026-02-20: App wiring for incoming-message triggers and clear-on-focus behavior remains deferred to Phases 2-3.

## Requested Behavior (Source of Truth)
- Show red dot in favicon area when new incoming message(s) arrive while tab is inactive.
- Keep a single global indicator (not per-conversation badges).
- If multiple conversations receive messages while inactive, still show only one red dot.
- Clear the red dot when the tab becomes focused/visible again.
- Clearing the red dot does not need to mark all conversation unread states as read.

## Scope and Non-Goals
### In scope
- Browser favicon badge rendering and toggling.
- Hooking into existing incoming-message detection logic.
- Focus/visibility listeners for clear behavior.
- Unit/integration tests around badge state transitions.

### Out of scope
- Changing server-side read state.
- Altering existing per-conversation unread logic.
- Reworking browser notification permission flows.

## Current Architecture Notes
- Incoming new-message qualification already exists in `src/state/conversationState.ts` (interactive path with `notificationMessages` and `hasFocus` check).
- Focus for browser platform is currently derived from page visibility in `src/interface/platform/browserPlatformUtils.ts`.
- Favicon links are static in `public/index.html`.

This feature should extend current behavior, not duplicate message-detection logic elsewhere.

## Implementation Phases

## Phase 0: Design and Contracts
### Goal
Define a minimal API for favicon badge state management and select integration points.

### Tasks
- Add a small utility module (proposed: `src/util/faviconBadge.ts`) with explicit API:
  - `initializeFaviconBadge(): void`
  - `setFaviconBadgeVisible(visible: boolean): void`
  - `clearFaviconBadge(): void`
- Decide singleton ownership in module scope (one badge manager for entire app runtime).
- Confirm behavior when favicon links are missing or image load fails: fail silently and keep app functional.

### Exit Criteria
- API and ownership agreed.
- Utility file scaffolded with no app wiring yet.

### Phase 0 Outcome (2026-02-20)
- Added `src/util/faviconBadge.ts` with module-level singleton ownership (`FaviconBadgeManager`).
- Exported API contract is finalized as planned:
  - `initializeFaviconBadge(): void`
  - `setFaviconBadgeVisible(visible: boolean): void`
  - `clearFaviconBadge(): void`
- Missing favicon links are treated as safe no-op behavior.
- Rendering/apply-badge logic is intentionally deferred to Phase 1.

## Phase 1: Favicon Badge Rendering
### Goal
Render a red-dot favicon variant and support toggling between base and badged icon.

### Tasks
- Read existing `link[rel~="icon"]` nodes and store original href(s).
- Load base 32x32 icon (or first suitable icon).
- Use canvas to draw base icon and a red dot in top-right corner.
- Produce data URL for badged icon once and cache it.
- Update favicon link(s) to badged or original href based on visibility flag.
- Add idempotency guards to avoid redundant DOM writes.

### Exit Criteria
- Calling `setFaviconBadgeVisible(true)` reliably shows a badged favicon.
- Calling `setFaviconBadgeVisible(false)` restores original favicon href(s).

### Phase 1 Outcome (2026-02-20)
- `src/util/faviconBadge.ts` now:
  - captures all `link[rel~="icon"]` nodes and preserves original hrefs.
  - selects the 32x32 favicon when available (otherwise first icon link) as rendering source.
  - generates a 32x32 canvas variant with a red top-right badge dot and white stroke.
  - caches the generated badged data URL and reuses it across toggles.
  - applies idempotent link updates when showing/hiding the badge and safely no-ops on icon load/canvas failures.

## Phase 2: Trigger on Background Incoming Messages
### Goal
Turn the badge on only when qualifying incoming messages arrive while tab is inactive.

### Tasks
- In `src/state/conversationState.ts`, use existing branch where:
  - messages are determined to be new incoming messages, and
  - `hasFocus` is false.
- Add a single call to `setFaviconBadgeVisible(true)` in that branch.
- Keep current notification sound and browser notification behavior unchanged.

### Exit Criteria
- Badge is activated for background new-message events.
- No regression to existing notification/sound logic.

## Phase 3: Clear Badge on Tab Return
### Goal
Clear the badge when the user returns to the tab.

### Tasks
- In `src/components/messaging/master/Messaging.tsx`, register listeners for:
  - `document.visibilitychange`
  - `window.focus`
- On each event, if tab is currently focused/visible, call `clearFaviconBadge()`.
- Clear badge in cleanup/unmount path to avoid stale indicator across session transitions.

### Exit Criteria
- Badge clears immediately on tab return regardless of conversation-level unread flags.
- Behavior matches requested global “considered seen on return” semantics.

## Phase 4: Test Coverage
### Goal
Add deterministic tests for badge state transitions and integration hooks.

### Tasks
- Add utility tests (proposed: `test/util/faviconBadge.test.ts`) covering:
  - initialization with icon links
  - show/hide transitions
  - no-op behavior before initialization
  - failure tolerance when icon cannot load
- Add integration-style test for clear-on-focus/visibility event in messaging layer (new or existing component test file).
- Validate no TypeScript/lint issues.

### Exit Criteria
- New tests pass with `npm test -- --runInBand`.
- Existing relevant tests remain green.

## Phase 5: Manual Validation and Documentation
### Goal
Verify runtime behavior in browser and record implementation status.

### Tasks
- Manual QA with active logged-in session:
  - Keep tab inactive, send/receive message, confirm dot appears.
  - Receive multiple messages/conversations while inactive, confirm single dot persists.
  - Return to tab, confirm dot clears immediately.
- Capture Playwright evidence (screenshots/network notes as needed).
- Update `project.md` with implementation status once feature lands.

### Exit Criteria
- Manual behavior matches requested semantics.
- Docs updated with completion status and any residual caveats.

## Risk Register
- Browser favicon caching may delay visible updates in some browsers.
  - Mitigation: write data URL href and avoid relying on path-only cache busting.
- Multiple icon tags (`32x32`, `57x57`, etc.) can cause inconsistent tab rendering.
  - Mitigation: update all relevant `rel~="icon"` links uniformly.
- Timing race between message arrival and document visibility changes.
  - Mitigation: centralized clear logic on visibility/focus events, idempotent toggles.

## Deliverables Checklist
- [x] `src/util/faviconBadge.ts` added.
- [x] Phase 1 rendering/toggle internals implemented in `src/util/faviconBadge.ts`.
- [ ] `src/state/conversationState.ts` wired to set badge on background incoming messages.
- [ ] `src/components/messaging/master/Messaging.tsx` wired to clear badge on tab return.
- [ ] Tests added and passing.
- [ ] Manual QA evidence captured.
- [ ] `project.md` updated after implementation completion.
