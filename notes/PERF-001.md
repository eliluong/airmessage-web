# PERF-001 Deep Dive: Promise map cleanup bug in conversation info handler

Date: 2026-02-20
Status: Done

## Summary
`connectionManager` resolved conversation info promises but deleted the wrong map entry in `onConversationUpdate`. This left resolved executors inside `conversationDetailsPromiseMap`, causing unbounded array growth for repeated requests on the same key.

## Why this is a problem
- Repeated `fetchConversationInfo` calls for the same conversation key appended additional executors to a map entry that was never removed.
- Every later update re-iterated all historical executors for that key, increasing per-update work over time.
- Long-lived sessions could accumulate unnecessary executor references, increasing memory pressure.

## Root cause
- `onConversationUpdate` looked up pending executors in `conversationDetailsPromiseMap`.
- After resolving, it called `threadPromiseMap.delete(promiseMapKey)` instead of `conversationDetailsPromiseMap.delete(promiseMapKey)`.
- Result: thread map delete call was usually a no-op, while conversation details executors stayed retained.

## Fix implemented
- Updated cleanup in `onConversationUpdate` to delete from `conversationDetailsPromiseMap`.
- Added `connectionManager.__testables` helpers to introspect pending queue sizes for deterministic regression tests.

## Validation
- Added/updated tests in `test/connection/connectionManager.test.ts`:
  - cleanup after successful conversation-info updates
  - cleanup after timeout failure
  - thread promise lifecycle remains intact
- Command results:
  - `npm test -- --runInBand test/connection/connectionManager.test.ts` passed
  - `npx tsc --noEmit` passed
  - `npm run build` passed (existing bundle/asset warnings unchanged)
  - `npm test -- --runInBand` passed

## Files touched
- `src/connection/connectionManager.ts`
- `test/connection/connectionManager.test.ts`
- `OPTIMIZATION_DEEP_DIVE_BACKLOG.md`
