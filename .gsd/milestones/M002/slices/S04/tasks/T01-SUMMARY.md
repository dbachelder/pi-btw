---
id: T01
parent: S04
milestone: M002
provides:
  - Verified that the existing BTW runtime harness already satisfies the sub-session lifecycle contract for S04/T01 and recorded the slice's observability/verification surfaces
key_files:
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S04/S04-PLAN.md
  - .gsd/STATE.md
key_decisions:
  - No new architectural change was needed; the existing `createAgentSessionMock` + `subSessionRecords` harness remains the contract seam for BTW sub-session lifecycle assertions
patterns_established:
  - Use the fake `AgentSession` harness plus overlay status/transcript inspection as the authoritative runtime proof surface before rewriting BTW runtime code
observability_surfaces:
  - `overlay.statusText.text`, `BtwOverlayComponent.getTranscriptEntries()`, and `subSessionRecords` in `tests/btw.runtime.test.ts`
duration: 30m
verification_result: passed
completed_at: 2026-03-15T19:19:10Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T01: Update test harness for sub-session model

**Confirmed that the existing BTW runtime harness already exercises the sub-session lifecycle contract, then closed T01 with explicit observability and state bookkeeping.**

## What Happened

I started by reading the dispatch-referenced task plan path, but `.gsd/milestones/M002/slices/S04/tasks/T01-PLAN.md` does not exist in this branch. Following the same pattern used in earlier M002 units, I treated `.gsd/milestones/M002/slices/S04/S04-PLAN.md` as the authoritative local contract.

Before touching task bookkeeping, I fixed the pre-flight plan issue in `.gsd/milestones/M002/slices/S04/S04-PLAN.md`: the slice now has a `## Observability / Diagnostics` section and an explicit failure-path verification command tied to inspectable overlay/transcript state.

I then audited `tests/btw.runtime.test.ts` against the T01 contract instead of rewriting it blindly. The current harness already uses `createAgentSessionMock`, `sessionManagerInMemoryMock`, and `subSessionRecords`; the fake session exposes `prompt()`, `subscribe()`, `dispose()`, `abort()`, `state.messages`, `state.tools`, and `isStreaming`; and the named assertions already cover the required lifecycle behaviors for sub-session creation, coding tools, Escape disposal, `/btw:clear`, `/btw:new`, contextual vs tangent mode recreation, and context filtering.

Because that contract was already satisfied and the test file was green, no runtime or test-code change was needed in this unit. I marked T01 complete in the slice plan, wrote this task summary, and recreated `.gsd/STATE.md` for the current S04/T02-next state because the file was absent in this worktree.

## Verification

- `npm test -- tests/btw.runtime.test.ts`
  - passed; the full BTW runtime suite is green with the existing AgentSession-based harness
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state|summarize failure preserves BTW thread state and keeps the overlay recoverable"`
  - passed; the inspectable failure-path checks required by the slice plan are green
- `npm test`
  - passed; the full repository test suite is green in this unit
- `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts`
  - failed because `completeSimple` is still present in `extensions/btw.ts`; this is expected at T01 and remains slice work for T03, not a blocker to closing T01
- Manual slice verification (`open BTW, ask with tool use, slash command, inject, dismiss`)
  - not run in this unit

## Diagnostics

- `tests/btw.runtime.test.ts` is already the contract-grade inspection surface for T01:
  - `subSessionRecords[n].session` for creation/disposal assertions
  - `subSessionRecords[n].promptCalls` for prompt/context inspection
  - `subSessionRecords[n].getIsStreaming()` and `getListenerCount()` for lifecycle/leak checks
  - `overlay.statusText.text` and `overlay.getTranscriptEntries()` for visible failure/recovery state
- `.gsd/milestones/M002/slices/S04/S04-PLAN.md` now documents those observability surfaces explicitly so later S04 tasks can reuse them instead of inventing new debug-only hooks

## Deviations

- The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S04/tasks/T01-PLAN.md` did not exist, so execution followed `.gsd/milestones/M002/slices/S04/S04-PLAN.md`
- No code rewrite was needed because the existing runtime harness already met the written T01 contract; this unit closed the task by re-verifying that fact and fixing missing project artifacts

## Known Issues

- Slice-level dead-code cleanup is still pending: `extensions/btw.ts` still contains `completeSimple`, so the S04 cleanup verification remains open for T03
- Manual live-pi verification for S04 is still outstanding

## Files Created/Modified

- `.gsd/milestones/M002/slices/S04/S04-PLAN.md` — added observability/failure-path expectations and marked T01 complete
- `.gsd/milestones/M002/slices/S04/tasks/T01-SUMMARY.md` — recorded the verified T01 outcome, diagnostics, and remaining slice work
- `.gsd/STATE.md` — recreated current execution state for M002/S04 with T02 as the next task
