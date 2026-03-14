---
estimated_steps: 4
estimated_files: 3
---

# T02: Tighten BTW contract behavior until the new proofs pass cleanly

**Slice:** S02 — BTW contract preservation
**Milestone:** M001

## Description

Use the new contract tests as the driver for any production changes. Fix only the real contract seams in `extensions/btw.ts` that the tests expose, then rerun targeted and full verification and update project state for the next slice.

## Steps

1. Run the expanded runtime test file and identify any contract failures in command handlers, reset/restore helpers, context building, or the context hook.
2. Make the minimum changes in `extensions/btw.ts` needed to satisfy those failures while keeping hidden custom entries and reset markers as the source of truth.
3. Re-run the targeted BTW runtime tests and then the full test suite to confirm the slice closes cleanly without regressions.
4. Update `.gsd/STATE.md` so the active slice phase and next action reflect S02 completion and readiness to move into S03 execution.

## Must-Haves

- [ ] Production fixes, if needed, land in the real contract helpers or command handlers rather than overlay-only patches.
- [ ] Verification ends with both targeted BTW runtime tests and the full test suite passing.

## Verification

- `npm test -- tests/btw.runtime.test.ts && npm test`
- `git diff -- extensions/btw.ts tests/btw.runtime.test.ts .gsd/STATE.md`

## Observability Impact

- Signals added/changed: any contract-facing status remains inspectable through hidden entries, restore results, and context-hook output already covered by tests.
- How a future agent inspects this: read `extensions/btw.ts` at `buildBtwContext()`, `resetThread()`, `restoreThread()`, and command handlers, then rerun the BTW runtime test file.
- Failure state exposed: test failures point directly to the broken contract seam after changes.

## Inputs

- `tests/btw.runtime.test.ts` — contract proofs added in T01.
- `extensions/btw.ts` — current BTW implementation to tighten only where tests expose drift.
- `.gsd/STATE.md` — current planning state to advance after verification passes.

## Expected Output

- `extensions/btw.ts` — minimal contract-preserving fixes, only if required by the new proofs.
- `.gsd/STATE.md` — updated next-action state for post-S02 work.
- `tests/btw.runtime.test.ts` — passing S02 contract proof suite.
