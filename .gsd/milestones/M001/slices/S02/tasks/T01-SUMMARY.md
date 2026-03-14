---
id: T01
parent: S02
milestone: M001
provides:
  - Executable contract proof for BTW reset, restore, mode-switch, and context-boundary behavior through the runtime harness
key_files:
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M001/slices/S02/S02-PLAN.md
key_decisions:
  - Reused the existing Vitest runtime harness and extended it with direct event-handler execution instead of adding separate fake production wiring.
patterns_established:
  - Prove BTW runtime contracts by inspecting hidden custom entries, registered event outputs, and context-hook results directly rather than relying on transcript text alone.
observability_surfaces:
  - Harness-visible session entries, event-handler return values, and context-hook filtering output
duration: 1h
verification_result: passed
completed_at: 2026-03-13T20:18:30-07:00
blocker_discovered: false
---

# T01: Add executable proof for BTW command and restore contracts

**Extended `tests/btw.runtime.test.ts` into a contract-proof harness that directly exercises BTW restore handlers, command reset behavior, and context filtering, then verified the targeted and full test suites pass.**

## What Happened

I first patched the slice plan’s verification section to include an explicit inspectable failure-path check, since the pre-flight flagged the lack of a diagnostic-oriented verification item.

Then I expanded the existing BTW runtime harness instead of replacing it. The harness now supports direct execution of registered event handlers, including `session_start`, `session_switch`, `session_tree`, and `context`, so tests can inspect restore outputs and context-hook results without depending on live TUI state.

In `tests/btw.runtime.test.ts`, I added focused contract coverage for the S02 seams:
- `/btw:new` reset-marker appends, hidden-thread clearing, and fresh-thread reopen behavior
- `/btw:tangent` and `/btw` mode switching with reset-clears-thread behavior and tangent request isolation
- `/btw:clear` reset behavior plus restore rehydration only after the last reset across `session_start`, `session_switch`, and `session_tree`
- main-session context filtering that excludes BTW notes while preserving non-BTW messages
- explicit inspectable failure-path coverage through the missing-credentials status/notification assertion

While building the proofs, I tightened the tests to assert against directly inspectable runtime signals — reset markers, hidden entries, handler results, and context-hook output — rather than inferring behavior from transcript text alone. No production change to `extensions/btw.ts` was required for this task.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test`

Behavior confirmed by named assertions in `tests/btw.runtime.test.ts`:
- reset markers are appended for `/btw:new`, `/btw:tangent` mode switches, and `/btw:clear`
- restore only rehydrates entries after the last reset across `session_start`, `session_switch`, and `session_tree`
- tangent requests omit inherited BTW/main visible-note context in the harness-observable request payloads
- BTW notes are filtered from the main-session context hook output
- missing credentials surface explicit status/notification diagnostics

## Diagnostics

Future inspection path:
- Run `npm test -- tests/btw.runtime.test.ts`
- Read the named contract assertions in `tests/btw.runtime.test.ts`
- Inspect `extensions/btw.ts` alongside the harness-visible outputs when a contract fails

Failure localization now maps cleanly to:
- reset-marker semantics
- mode-switch/thread-clear behavior
- restore-path wiring
- main-context pollution
- explicit failure-path status/notification output

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `tests/btw.runtime.test.ts` — extended the runtime harness and added executable S02 contract assertions for reset, restore, mode switching, and context filtering
- `.gsd/milestones/M001/slices/S02/S02-PLAN.md` — added an explicit inspectable failure-path verification item per pre-flight requirements
