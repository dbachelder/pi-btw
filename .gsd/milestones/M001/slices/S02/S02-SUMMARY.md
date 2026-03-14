---
id: S02
parent: M001
milestone: M001
provides:
  - Executable proof that modal-backed BTW preserves command semantics, mode separation, restore behavior, and main-context filtering without changing the hidden-thread contract
requires:
  - slice: S01
    provides: Modal BTW shell, focused composer flow, and hidden-entry-backed overlay state
affects:
  - S03
  - S04
key_files:
  - tests/btw.runtime.test.ts
  - extensions/btw.ts
  - .gsd/REQUIREMENTS.md
  - .gsd/STATE.md
  - .gsd/milestones/M001/M001-ROADMAP.md
key_decisions:
  - Reused and extended the existing Vitest runtime harness instead of adding separate fake production wiring for restore and context-hook behavior.
  - Treated tests/btw.runtime.test.ts as the contract gate and left extensions/btw.ts unchanged because the real implementation already satisfied the new assertions.
patterns_established:
  - Prove BTW semantics through hidden entries, reset markers, registered event outputs, and context-hook results instead of transcript-only assertions.
  - Use named runtime assertions to localize regressions to reset boundaries, mode switching, restore paths, or main-context filtering.
observability_surfaces:
  - Harness-visible hidden custom entries (`btw-thread-entry`, `btw-thread-reset`), restore-path outputs, and `context` hook filtering in tests/btw.runtime.test.ts
  - extensions/btw.ts restore helpers and command handlers as the production seams behind failing assertions
  - Missing-credentials status/notification output as an explicit inspectable failure path
 drill_down_paths:
  - .gsd/milestones/M001/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S02/tasks/T02-SUMMARY.md
duration: 1.5h
verification_result: passed
completed_at: 2026-03-13T20:21:00-07:00
---

# S02: BTW contract preservation

**Expanded the BTW runtime proof harness until command semantics, mode boundaries, restore behavior, and main-context filtering were executable, then verified the real implementation already met the contract without production changes.**

## What Happened

This slice focused on the hidden-thread contract, not the modal UI itself. The main risk was that the new overlay could appear correct while silently drifting from the README-owned BTW semantics. To retire that risk, the work started by extending `tests/btw.runtime.test.ts` so the harness could inspect registered event handlers, hidden session entries, restore behavior, and `context` hook output directly.

With that harness in place, the slice added targeted contract proofs for `/btw:new`, `/btw:clear`, `/btw:tangent`, contextual `/btw`, mode-switch reset behavior, restore across `session_start` / `session_switch` / `session_tree`, and filtering of BTW notes out of the main-session context. The tests also include an explicit inspectable failure-path assertion for missing credentials so future failures surface structured status/notification output instead of only transcript drift.

After the proofs existed, the real implementation in `extensions/btw.ts` was rechecked against them. The targeted suite and the full test suite both passed cleanly, so no production edits were made in S02. The slice closed by updating requirements evidence, recording the contract-gate decision, marking the milestone roadmap forward, and advancing project state to S03-ready execution.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test`

Observability confirmed through the runtime harness:
- hidden custom entries `btw-thread-entry` and `btw-thread-reset`
- restore behavior after the last reset marker across `session_start`, `session_switch`, and `session_tree`
- `context` hook output that excludes BTW notes but preserves non-BTW messages
- explicit missing-credentials status and notification diagnostics

## Requirements Advanced

- R005 — Added executable proof that `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` still obey the documented reset and thread-continuation contract.
- R006 — Added executable proof that contextual and tangent BTW remain behaviorally distinct, including switch-clears-thread behavior and tangent’s contextless request construction.
- R010 — Added executable proof that hidden BTW thread state restores correctly across the extension’s restore events using reset markers as the boundary.
- R014 — Added executable proof that BTW notes remain out of the main-session context unless explicitly handed back.

## Requirements Validated

- R005 — Now validated by named runtime assertions covering reset markers, fresh-thread reopen semantics, and command-owned mode resets.
- R006 — Now validated by runtime assertions showing tangent mode clears/switches correctly and omits inherited main-session conversation.
- R010 — Now validated by restore assertions across `session_start`, `session_switch`, and `session_tree`, including last-reset-only rehydration.
- R014 — Now validated by the `context` hook assertion that drops BTW notes while preserving ordinary messages.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- S02 proves contract behavior through the runtime harness, not through live pi interaction; explicit in-modal handoff UX and visible coexistence with the main session remain for S03.
- Slash-command behavior inside the BTW composer is still unresolved and remains in S04.

## Follow-ups

- S03 should exercise `/btw:inject` and `/btw:summarize` through the modal path and verify the main session remains visibly and behaviorally separate behind the overlay.
- S04 should attach any slash-command handling to the existing modal composer only if it preserves the now-proven command and thread invariants.

## Files Created/Modified

- `tests/btw.runtime.test.ts` — extended the harness and added executable contract assertions for reset, mode separation, restore, and main-context filtering
- `.gsd/milestones/M001/slices/S02/S02-PLAN.md` — captured the explicit inspectable failure-path verification expectation used by the slice
- `.gsd/REQUIREMENTS.md` — moved S02-proven requirements from Active to Validated with concrete proof text
- `.gsd/DECISIONS.md` — recorded the decision to use the runtime proof suite as the BTW contract gate
- `.gsd/milestones/M001/slices/S02/S02-SUMMARY.md` — compressed task outcomes into slice-level completion evidence
- `.gsd/milestones/M001/slices/S02/S02-UAT.md` — added artifact-driven acceptance steps for the S02 contract surfaces
- `.gsd/milestones/M001/M001-ROADMAP.md` — marked S02 complete
- `.gsd/PROJECT.md` — refreshed milestone progress and current state wording
- `.gsd/STATE.md` — advanced active work to S03-ready execution

## Forward Intelligence

### What the next slice should know
- The authoritative S02 evidence lives in `tests/btw.runtime.test.ts`; if S03 changes thread behavior, start by rerunning that file before assuming the modal UI is at fault.
- Reset markers remain the true restore boundary. Any handoff flow that clears or preserves state should be reasoned about in relation to `btw-thread-reset`, not overlay visibility.

### What's fragile
- Restore semantics are intentionally tied to the last `btw-thread-reset` entry — accidental extra resets or missing resets will make restore behavior look inconsistent even if the overlay still renders.
- The modal can look healthy while the `context` hook regresses, so main-context contamination must keep being checked with explicit assertions rather than UI inspection.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` — it directly exposes handler results, hidden entries, and context-hook output, which makes contract regressions easy to localize.
- `extensions/btw.ts` restore helpers (`resetThread()`, `restoreThread()`, `buildBtwContext()`) — these are the first production seams to inspect if contract assertions fail.

### What assumptions changed
- The expected S02 work was “tighten production code until tests pass” — in practice, the real implementation already satisfied the contract once the missing proof coverage was added.
