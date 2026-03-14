# S02: BTW contract preservation

**Goal:** Prove and, if needed, tighten the modal-backed BTW implementation so `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` still obey the README thread contract, mode separation, restore behavior, and main-context boundary.
**Demo:** The runtime harness exercises command/mode transitions, reset-marker-driven restore, and context filtering, showing the modal is only a thin UI over the existing hidden-thread contract.

The slice is small but not trivial, so I’m grouping it into two tasks: first extend the harness to cover the authoritative contract seams already identified in research, then make only the minimum code changes needed to satisfy those proofs and document the slice-level verification target. That order is driven by the main risk here: UI behavior can look correct while hidden-thread semantics quietly drift. The safest path is executable contract proof first, then narrow fixes against `resetThread()`, `restoreThread()`, command handlers, or the context hook only if a test actually fails.

## Must-Haves

- `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` preserve the README-documented thread semantics under the modal UI.
- Contextual and tangent BTW modes remain distinct, including switch-clears-thread behavior and tangent’s contextless request construction.
- Hidden BTW thread state restores correctly from reset markers on session restore paths used by the extension.
- BTW side-thread state stays out of the main session context unless explicit handoff is requested.

## Proof Level

- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no

## Verification

- `tests/btw.runtime.test.ts` expanded to assert `/btw:new`, `/btw:clear`, `/btw:tangent`, mode-switch reset behavior, restore on `session_start` / `session_switch` / `session_tree`, and context-hook filtering.
- `tests/btw.runtime.test.ts` includes at least one explicit inspectable failure-path assertion (for example: missing-credentials status/notification output or restore/context-hook output shape) so regressions expose structured failure state instead of transcript drift alone.
- `npm test -- tests/btw.runtime.test.ts`
- `npm test`

## Observability / Diagnostics

- Runtime signals: hidden custom entries (`btw-thread-entry`, `btw-thread-reset`), restored `pendingMode`/thread transcript, and the context-hook output seen through the harness.
- Inspection surfaces: `tests/btw.runtime.test.ts`, `extensions/btw.ts`, and harness-captured session entries / command registrations / event handlers.
- Failure visibility: failing assertions identify which contract broke: reset markers, mode separation, restore path, or main-context filtering.
- Redaction constraints: no secrets; tests should keep synthetic BTW content only.

## Integration Closure

- Upstream surfaces consumed: `extensions/btw.ts` command handlers, `buildBtwContext()`, `resetThread()`, `restoreThread()`, and the `pi.on("context", ...)` filter.
- New wiring introduced in this slice: targeted harness coverage for restore events and context-hook inspection; only minimal production wiring if a contract test exposes drift.
- What remains before the milestone is truly usable end-to-end: explicit handoff/injection flow and background-session coexistence in S03, then slash-command policy in S04.

## Tasks

- [x] **T01: Add executable proof for BTW command and restore contracts** `est:1.5h`
  - Why: S02’s main risk is semantic drift hidden behind a working modal, so the slice needs direct tests against the hidden-thread contract before code changes.
  - Files: `tests/btw.runtime.test.ts`, `.gsd/milestones/M001/slices/S02/S02-PLAN.md`
  - Do: Extend the runtime harness so tests can inspect registered event handlers and context-hook results, then add focused contract tests for `/btw:new`, `/btw:clear`, `/btw:tangent`, mode-switch resets, restore behavior across `session_start`/`session_switch`/`session_tree`, and BTW-note exclusion from main context.
  - Verify: `npm test -- tests/btw.runtime.test.ts`
  - Done when: The harness contains failing-or-passing assertions for every S02-owned contract boundary, with no hand-wavy UI-only checks.
- [x] **T02: Tighten BTW contract behavior until the new proofs pass cleanly** `est:1.5h`
  - Why: Once contract proofs exist, any semantic mismatch must be fixed at the real source of truth, not in overlay-only code.
  - Files: `extensions/btw.ts`, `tests/btw.runtime.test.ts`, `.gsd/STATE.md`
  - Do: Make the smallest production changes required for the new runtime proofs to pass, keeping reset markers and hidden entries authoritative; then run the targeted and full test suites and update state to point at S03-ready execution.
  - Verify: `npm test -- tests/btw.runtime.test.ts && npm test`
  - Done when: All new contract tests pass, no README-owned BTW semantics are weakened, and the slice has executable proof for R005/R006/R010/R014.

## Files Likely Touched

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
- `.gsd/milestones/M001/slices/S02/S02-PLAN.md`
- `.gsd/milestones/M001/slices/S02/tasks/T01-PLAN.md`
- `.gsd/milestones/M001/slices/S02/tasks/T02-PLAN.md`
- `.gsd/STATE.md`
