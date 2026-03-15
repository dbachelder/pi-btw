---
id: T03
parent: S03
milestone: M002
provides:
  - Runtime proof that BTW overlay submits do not block main-session input while the BTW sub-session is streaming
key_files:
  - tests/btw.runtime.test.ts
  - README.md
  - .gsd/DECISIONS.md
key_decisions:
  - Proved parallelism in the runtime harness by exercising the fire-and-forget overlay submit path and an independent simulated main-session input instead of adding production-only blocking state
patterns_established:
  - Prove cross-session concurrency by asserting both sub-session streaming state and main-session idle/input state in the same runtime test
observability_surfaces:
  - BtwOverlayComponent.getTranscriptEntries(), overlay status text, and sub-session streaming state exposed via the fake AgentSession record in tests
duration: 50m
verification_result: passed
completed_at: 2026-03-15T19:08:39Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T03: Prove parallel execution

**Added a runtime concurrency proof that BTW streaming and main-session input can proceed simultaneously, and updated the README to match the shipped slash-command behavior.**

## What Happened

The task-plan file `.gsd/milestones/M002/slices/S03/tasks/T03-PLAN.md` was not present on disk, so execution used the slice plan plus the T01/T02 carry-forward summaries as the local contract.

I extended `tests/btw.runtime.test.ts` with a blocking-success BTW stream helper and a small main-session input seam in the harness, then added a named runtime assertion proving that:

- the overlay submit path is fire-and-forget (`onSubmit` returns immediately)
- the BTW sub-session can still be actively streaming/tool-running
- the main session can accept new input and flip its own idle state independently while BTW is still running
- the BTW turn still completes normally and persists hidden thread state afterward

No production runtime change in `extensions/btw.ts` was required for T03; the shipped behavior was already correct and the missing work was proof. I also updated `README.md` because its in-modal slash section still described the old unsupported-slash fallback instead of the current sub-session routing behavior.

## Verification

Passed:

- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"`
- `npm test -- tests/btw.runtime.test.ts -t "allows main-session input to proceed while the BTW sub-session is streaming|preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"`

Observed in the new concurrency proof:

- BTW overlay status shows active tool work while the sub-session is streaming
- `subSessionRecords[n].getIsStreaming()` remains `true` while the simulated main session accepts input
- `baseCtx.isIdle()` can change independently of the BTW sub-session state
- the BTW turn finishes and persists a hidden `btw-thread-entry`

Attempted but blocked:

- Live/manual `pi` verification was attempted via `pi --help`, but the local runtime failed while loading unrelated globally installed extensions (`@gsd/pi-coding-agent` / `@gsd/pi-ai` export errors), so a trustworthy live UAT pass was not possible from this environment during this unit

## Diagnostics

Use these surfaces if parallel execution regresses later:

- `tests/btw.runtime.test.ts` — `allows main-session input to proceed while the BTW sub-session is streaming`
- `subSessionRecords[n].getIsStreaming()` — test-visible sub-session streaming state
- `overlay.statusText.text` — first-line runtime signal for tool execution/ready/failure state
- `overlay.getTranscriptEntries()` — inspectable transcript proof of in-flight tool activity and final completion

## Deviations

- The task-plan source file referenced by dispatch (`.gsd/milestones/M002/slices/S03/tasks/T03-PLAN.md`) was missing, so execution followed the slice plan and prior task summaries instead
- Updated `README.md` within T03 because it still documented the pre-S03 unsupported-slash behavior and would otherwise contradict the shipped runtime

## Known Issues

- Live manual/UAT for the slice is still pending in a clean `pi` runtime; the local machine’s global `pi` startup currently fails before a real BTW flow can be exercised because unrelated extensions fail to load

## Files Created/Modified

- `tests/btw.runtime.test.ts` — added the blocking-success stream helper, a simulated main-session input seam, and the named runtime proof for parallel execution
- `README.md` — updated the in-modal slash behavior docs to match sub-session prompt routing and real failure surfacing
- `.gsd/DECISIONS.md` — recorded the proof strategy for BTW/main-session parallelism
