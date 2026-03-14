---
id: T02
parent: S01
milestone: M001
provides:
  - Documented runtime verification status for the BTW modal flow, plus a local runtime-harness scaffold for thread/overlay semantics that can be completed once test tooling is available.
key_files:
  - tests/btw.runtime.test.ts
  - vitest.config.ts
  - package.json
  - .gsd/milestones/M001/slices/S01/tasks/T02-SUMMARY.md
key_decisions:
  - Recorded the real runtime blocker truthfully instead of marking the live modal proof complete without an executable interaction path.
  - Added a focused extension-runtime test harness around BTW command/overlay semantics because macOS Accessibility was unavailable and the live pi process could not be driven programmatically from this environment.
patterns_established:
  - For pi extension TUI work, verify command registration, persisted custom entries, overlay handle behavior, and visible status text with a narrow harness when direct UI automation is unavailable.
observability_surfaces:
  - Live pi launch output showing unrelated global extension-load failures before BTW verification could proceed.
  - BTW runtime harness scaffold in tests/btw.runtime.test.ts for overlay/thread/error semantics.
duration: interrupted by timeout
verification_result: partial
completed_at: 2026-03-14T01:17:34Z
blocker_discovered: false
---

# T02: Prove modal chat behavior in live pi interaction

**Attempted the live modal proof path, captured the runtime blockers honestly, and left a runnable verification scaffold plus recovery notes instead of claiming an unverified slice demo.**

## What Happened

I started from the slice verification contract and ran the required entrypoints that were available locally.

What passed:
- `npm pack --dry-run` completed successfully earlier in this task attempt.
- `pi -e /Users/dan/src/pi-btw` did launch, but the session timed out waiting for interaction.

What blocked full completion:
- The live `pi` session surfaced unrelated global extension load failures from `~/.gsd/agent/extensions/*` (`No "exports" main defined ...`) before BTW interaction was exercised.
- macOS Accessibility and Screen Recording permissions were both disabled for this terminal, so native automation of the interactive terminal session was not available.
- I added a focused Vitest harness (`tests/btw.runtime.test.ts`) to verify BTW overlay/thread/error semantics locally, but `npm test` then failed because `vitest` is not installed in this repo (`sh: vitest: command not found`).

Because of those constraints, I did **not** complete the slice’s required live proof of:
- focused modal interaction in the real pi TUI,
- one in-place follow-up in the live session,
- Escape dismiss + reopen thread preservation in the live session,
- inspectable live failure-path confirmation in the real UI.

The task is being marked done only in the GSD bookkeeping sense required by timeout recovery so the next unit can resume from a durable state; the runtime proof itself remains incomplete and should be treated as unfinished verification work.

## Verification

Passed:
- `npm pack --dry-run`
  - package tarball was produced successfully.

Attempted but blocked:
- `pi -e /Users/dan/src/pi-btw`
  - launched, but the session output showed unrelated global extension-load failures and the interactive run timed out before BTW-specific modal verification could be completed.
- `npm test`
  - failed immediately with `sh: vitest: command not found`.
- `git diff -- extensions/btw.ts README.md package.json vitest.config.ts tests/btw.runtime.test.ts`
  - confirmed only `package.json` was modified in this recovery attempt; the test harness files exist locally from this task attempt and should be reviewed before the next run.

Live verification status against the slice plan:
- Open BTW modal in live pi run: **not verified**
- Focused BTW composer in live pi run: **not verified**
- One in-place follow-up in live pi run: **not verified**
- Visible streamed response updates in live pi run: **not verified**
- Escape dismissal without clear in live pi run: **not verified**
- Reopen showing preserved thread in live pi run: **not verified**
- Inspectable failure path in live pi run: **not verified**

## Diagnostics

Useful inspection surfaces for the next agent:
- Re-run `pi -e /Users/dan/src/pi-btw` and first confirm whether the unrelated `~/.gsd/agent/extensions/*` load failures are still present; those errors appeared before BTW-specific validation.
- Check macOS automation capability first with `mac_check_permissions`; Accessibility was disabled during this run.
- Review `tests/btw.runtime.test.ts` and `vitest.config.ts` as the intended lightweight harness for:
  - overlay opening as `overlay: true`
  - preserved hidden-thread entries across dismiss/reopen
  - in-place follow-up turns
  - explicit missing-credentials error status without clearing thread
- Install/add test tooling before retrying `npm test`; current failure is missing `vitest`, not a BTW assertion failure.

## Deviations

- Added a local test harness scaffold (`tests/btw.runtime.test.ts`, `vitest.config.ts`, and a `test` script in `package.json`) even though the original task was primarily live-runtime proof work. This was a fallback because direct TUI automation was unavailable in the current environment.

## Known Issues

- Full slice verification remains incomplete.
- The local repo does not currently have `vitest` available, so the new runtime harness cannot run yet.
- The live `pi` launch showed unrelated global extension-load failures from the user’s GSD environment, which may interfere with clean manual/live verification.
- macOS Accessibility and Screen Recording permissions were disabled for this terminal during the attempt.

## Files Created/Modified

- `tests/btw.runtime.test.ts` — focused BTW runtime-harness scaffold for overlay/thread/error semantics.
- `vitest.config.ts` — minimal Vitest configuration for the new harness.
- `package.json` — added an `npm test` script targeting Vitest.
- `.gsd/milestones/M001/slices/S01/tasks/T02-SUMMARY.md` — timeout-recovery summary with explicit incomplete verification status and resume notes.
