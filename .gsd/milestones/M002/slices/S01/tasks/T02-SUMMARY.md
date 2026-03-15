---
id: T02
parent: S01
milestone: M002
provides:
  - BTW now aborts, disposes, and unsubscribes its real sub-session on Escape, /btw:clear, and thread replacement flows
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S01/S01-PLAN.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
key_decisions:
  - D016: make the BTW session runtime own event unsubscription and awaited abort/dispose during reset and replacement
patterns_established:
  - Centralize BTW sub-session teardown in one dispose helper, clear event subscriptions before dispose, and await cleanup before creating replacement sessions
observability_surfaces:
  - tests/btw.runtime.test.ts now exposes per-sub-session listener counts and streaming state so Escape/clear cleanup can be asserted directly
duration: 1h
verification_result: passed
completed_at: 2026-03-15T18:04:58Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T02: Sub-session dispose on Escape and /btw:clear

**BTW now tears down its live AgentSession cleanly on Escape, `/btw:clear`, and `/btw:new`, including explicit abort/dispose and listener cleanup.**

## What Happened

I hardened the BTW session lifecycle in `extensions/btw.ts` so the active sub-session runtime now owns a subscription set and disposes through a single awaited cleanup path. That path clears event listeners first, then aborts the agent loop, then disposes the `AgentSession`, and nulls the active runtime reference.

Escape dismissal now routes through that cleanup instead of only hiding the overlay. `/btw:clear`, `/btw:new`, and the reset paths used by inject/summarize now await sub-session disposal before clearing thread state or creating a replacement session. I also updated session restore/shutdown flows to await the same cleanup helper so branch changes do not leave a stale BTW sub-session behind.

In `tests/btw.runtime.test.ts`, I extended the fake sub-session harness with observable listener-count and streaming-state accessors, then added assertions for three cleanup contracts: Escape during an in-flight tool execution aborts/disposes and leaves no listeners behind, Escape after a completed turn still disposes cleanly while preserving hidden thread state, and `/btw:clear` plus `/btw:new` dispose the old sub-session before reuse.

The task-specific plan file referenced by dispatch (`.gsd/milestones/M002/slices/S01/tasks/T02-PLAN.md`) was still absent, so I executed against `.gsd/milestones/M002/slices/S01/S01-PLAN.md` as the authoritative local contract.

## Verification

- `npm test -- tests/btw.runtime.test.ts`
  - passed; includes cleanup assertions for Escape mid-stream, Escape after completion, `/btw:clear`, `/btw:new`, and no lingering sub-session listeners
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure"`
  - passed; confirms the failure-path overlay/status behavior remains reusable after the cleanup refactor
- Observability checks covered through runtime assertions:
  - `session.abort()` called on Escape/clear/replacement
  - `session.dispose()` called during teardown
  - mocked `session.isStreaming` flips false after abort in the mid-stream Escape case
  - per-session listener count returns to `0` after disposal
- Manual slice verification (`open BTW in live pi, verify tool execution appears in the overlay`) not run in this task unit

## Diagnostics

- Runtime cleanup is centralized in `extensions/btw.ts` via the BTW dispose helper and the per-session `subscriptions` set on `BtwSessionRuntime`
- `tests/btw.runtime.test.ts` exposes direct inspection points for later debugging:
  - `subSessionRecords[n].session.abort`
  - `subSessionRecords[n].session.dispose`
  - `subSessionRecords[n].getIsStreaming()`
  - `subSessionRecords[n].getListenerCount()`
- User-visible status remains available through the BTW overlay status line; tool activity still flows from `session.subscribe()` events into the transcript bridge

## Deviations

- The referenced task plan file `.gsd/milestones/M002/slices/S01/tasks/T02-PLAN.md` did not exist, so execution followed `.gsd/milestones/M002/slices/S01/S01-PLAN.md`

## Known Issues

- Manual live-pi verification of tool activity in the BTW overlay is still outstanding for the slice
- T03 mode-specific context hardening remains open

## Files Created/Modified

- `extensions/btw.ts` — centralized BTW sub-session teardown, wired Escape to dispose, and awaited cleanup on reset/replacement flows
- `tests/btw.runtime.test.ts` — added listener/streaming observability to the fake session harness and asserted Escape/clear/new cleanup behavior
- `.gsd/milestones/M002/slices/S01/S01-PLAN.md` — marked T02 complete
- `.gsd/DECISIONS.md` — recorded the disposal-ownership pattern as D016
- `.gsd/STATE.md` — advanced next action to T03 and recorded the new decision
- `.gsd/milestones/M002/slices/S01/tasks/T02-SUMMARY.md` — recorded shipped behavior, verification, diagnostics, and remaining slice work
