---
estimated_steps: 4
estimated_files: 3
---

# T02: Prove modal chat behavior in live pi interaction

**Slice:** S01 — Modal BTW chat shell
**Milestone:** M001

## Description

Exercise the real BTW modal in pi and close the integration loop on the slice demo. This task turns the implementation into proof by verifying focus ownership, streaming transcript updates, in-place follow-up, and fast Escape dismissal against the actual runtime rather than trusting code inspection alone.

## Steps

1. Launch pi with the local extension and execute the BTW modal flow from the real runtime entrypoint.
2. Verify modal-over-main-session presentation, focused composer behavior, one in-place follow-up, and visible streamed response updates.
3. Verify Escape dismisses the modal without clearing the BTW thread, then reopen BTW and confirm the thread transcript is still available.
4. Fix any issues found during the live check and leave the verification path explicit for slice execution.

## Must-Haves

- [ ] The slice has a concrete live verification path that proves the modal demo, not just static code plausibility.
- [ ] Reopen-after-Escape behavior is checked so dismissal is not accidentally acting like clear/reset.
- [ ] Any issues discovered during runtime verification are corrected before the slice is marked complete.

## Verification

- `pi -e /Users/dan/src/pi-btw`
- In the live session: open BTW, type and submit one question, submit one follow-up inside the same modal, confirm the main session remains visible behind the overlay, dismiss with Escape, reopen BTW, and confirm the thread transcript remains available.
- `git diff -- extensions/btw.ts README.md`

## Observability Impact

- Signals added/changed: validates that modal transcript/status surfaces are sufficient to understand BTW progress and failures in real use.
- How a future agent inspects this: rerun the same live pi workflow and compare visible modal state before/after Escape and reopen.
- Failure state exposed: runtime regressions show up as lost focus, missing transcript updates, accidental clears on dismiss, or hidden-thread restore failures.

## Inputs

- `extensions/btw.ts` — overlay implementation and BTW runtime wiring from T01.
- `README.md` — user-facing BTW behavior descriptions to compare against runtime behavior.
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md` — slice verification target and owned requirement coverage.

## Expected Output

- `extensions/btw.ts` — any verification-driven fixes required to make the live modal flow pass.
- `README.md` — any small clarifications needed after real interaction proves the UX.
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md` — remains the authoritative verification contract for execution.
