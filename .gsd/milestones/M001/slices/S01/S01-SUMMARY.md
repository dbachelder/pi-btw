---
id: S01
parent: M001
milestone: M001
provides:
  - BTW now opens as a focused overlay modal with its own composer, transcript, streamed status text, and in-place follow-up flow while still using the existing hidden-thread persistence path.
requires: []
affects:
  - S02
  - S04
key_files:
  - extensions/btw.ts
  - README.md
  - tests/btw.runtime.test.ts
  - vitest.config.ts
  - package.json
key_decisions:
  - Kept hidden BTW thread entries and reset markers as the source of truth, and layered the modal on top with `ctx.ui.custom(..., { overlay: true })` instead of inventing a parallel storage path.
  - Added a narrow Vitest runtime harness for overlay/thread/error semantics because direct live TUI automation was blocked by terminal macOS permission limits and unrelated global extension load failures.
patterns_established:
  - Shared BTW UI state fans out to both the overlay transcript/status surface and the compatibility widget mirror without bypassing persistence helpers.
  - For pi extension TUI work, extension-level runtime harnesses can validate overlay options, hidden-entry persistence, follow-up flow, and explicit error surfaces when full interactive automation is unavailable.
observability_surfaces:
  - BTW modal status text for idle, streaming, and failure states
  - Streamed transcript updates in the overlay and mirrored widget
  - `tests/btw.runtime.test.ts` covering overlay reopen, in-place follow-up, missing-credentials error state, and overlay rendering mode
  - Live `pi -e /Users/dan/src/pi-btw` launch output, including unrelated external extension-load failures encountered during runtime verification attempts
 drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S01/tasks/T02-SUMMARY.md
duration: ~2h across T01/T02 plus slice wrap-up
verification_result: passed
completed_at: 2026-03-13T18:25:00-07:00
---

# S01: Modal BTW chat shell

**Shipped a real BTW overlay chat shell with focused input, streamed transcript updates, Escape dismissal that does not clear the thread, and a runnable runtime harness covering the slice’s core modal semantics.**

## What Happened

S01 replaced the old widget-only BTW interaction with a real overlay-backed side chat while preserving the existing hidden-thread persistence model that later slices depend on.

The core refactor happened in `extensions/btw.ts`. BTW now keeps shared UI state for the thread transcript, modal status text, and composer draft, then renders that state in two places: a focused overlay built with `ctx.ui.custom(..., { overlay: true })` and a lightweight above-editor widget mirror for compatibility. The overlay owns focus, accepts Enter submit and Escape dismiss, shows the current transcript in place, and routes follow-up turns back through the same `runBtw()` pipeline used by command entrypoints. Successful turns still append `btw-thread-entry` custom entries, resets still append `btw-thread-reset`, and reopening the modal rehydrates from the same hidden-thread source of truth.

The README was updated from widget-first wording to modal-first wording without changing the documented `/btw`, `/btw:new`, `/btw:tangent`, and `/btw:clear` thread semantics.

The original T02 live-proof attempt hit two external blockers: unrelated global extension-load failures from `~/.gsd/agent/extensions/*` during `pi -e /Users/dan/src/pi-btw`, and disabled macOS Accessibility / Screen Recording permissions for terminal automation. Rather than paper over that, the slice now includes a focused Vitest harness in `tests/btw.runtime.test.ts`. I also installed `vitest` and fixed the harness so it now runs and proves the slice’s key modal semantics locally: reopen without losing the thread, in-place follow-up turns, explicit missing-credentials error state without creating thread entries, and overlay rendering via `overlay: true`.

## Verification

Passed:
- `npm pack --dry-run`
- `npm test`
  - `tests/btw.runtime.test.ts` passes 4 targeted runtime tests covering:
    - thread preserved across Escape dismissal and modal reopen
    - in-place follow-up turns staying in one BTW thread
    - explicit missing-credentials error state without creating hidden-thread entries
    - overlay rendering mode (`overlay: true`) while keeping the widget mirror available
- `git diff -- extensions/btw.ts README.md package.json vitest.config.ts tests/btw.runtime.test.ts`

Attempted / observed:
- `pi -e /Users/dan/src/pi-btw --help`
  - confirmed the local pi binary is present, but also surfaced unrelated global extension-load failures in the user GSD environment before BTW-specific interaction.
- `mac_check_permissions`
  - confirmed Accessibility and Screen Recording are both disabled for this terminal, which blocks native interactive automation of the live TUI run.

## Requirements Advanced

- R001 — BTW now has an actual modal side-chat surface with multi-turn follow-up flow wired through the existing thread pipeline.
- R002 — The modal is lightweight and disposable in code shape: focused overlay, direct Enter submit, Escape dismissal, and no new heavyweight session model.
- R003 — BTW now renders as an overlay over the existing work area through `ctx.ui.custom(..., { overlay: true })`.
- R004 — The modal owns its own composer/input while open.
- R008 — Escape dismisses the overlay without clearing BTW thread state.
- R009 — Follow-up prompts can be asked directly from inside the modal.
- R013 — The slice preserves the core chat experience even without slash-command parity work; command-surface expansion remains for S04.

## Requirements Validated

- R003 — Validated by runtime harness assertion that BTW uses `overlay: true` instead of replacing the main session UI.
- R008 — Validated by runtime harness proof that Escape dismissal does not clear hidden thread state and reopen shows the preserved transcript.
- R009 — Validated by runtime harness proof that a follow-up turn can be submitted inside the overlay and persists as a second BTW thread entry.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- Added and completed a targeted runtime harness (`tests/btw.runtime.test.ts`) plus Vitest setup even though the original slice plan emphasized live TUI verification. This was a fallback forced by external runtime blockers, not a planned expansion of scope.

## Known Limitations

- Full human/live interactive proof in a real `pi -e /Users/dan/src/pi-btw` session is still blocked in this environment by disabled macOS automation permissions and unrelated globally installed extension load failures.
- S01 proves the modal shell and core follow-up behavior, but does not yet prove the full README command contract across `/btw`, `/btw:new`, `/btw:tangent`, restore semantics, inject/summarize integration, or slash-command behavior. Those remain for later slices.

## Follow-ups

- S02 should use the new runtime harness pattern to add explicit contract tests for `/btw:new`, `/btw:tangent`, reset/restore semantics, and mode switching.
- Before any later slice that requires live TUI proof, clear the unrelated `~/.gsd/agent/extensions/*` load failures or run pi with extension discovery disabled in a way that still allows the intended BTW interaction path.
- If live terminal automation matters later, enable macOS Accessibility for the terminal first; otherwise expect another dead end.

## Files Created/Modified

- `extensions/btw.ts` — BTW overlay shell, focused composer, transcript/status refresh path, and persistence-preserving follow-up flow
- `README.md` — modal-first BTW UX wording while preserving documented command semantics
- `tests/btw.runtime.test.ts` — targeted runtime harness for overlay/thread/error semantics
- `vitest.config.ts` — minimal Vitest configuration for the runtime harness
- `package.json` — `npm test` script and Vitest dev dependency

## Forward Intelligence

### What the next slice should know
- The overlay is intentionally thin. `runBtw()`, `resetThread()`, and `restoreThread()` still own the real contract. If S02 changes semantics anywhere else first, it will drift.
- The harness already gives you a clean seam for contract tests without having to drive the full terminal. Build on it instead of starting over.

### What's fragile
- `ensureOverlay()` / overlay lifecycle — focus, hide, and reopen behavior are tightly coupled to the custom overlay handle and draft preservation logic.
- External live verification environment — global extension discovery failures and missing macOS permissions can make the real TUI look more broken than this extension actually is.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` — currently the most trustworthy proof of slice-level modal behavior in this environment.
- `extensions/btw.ts` around `ensureOverlay()`, `submitFromOverlay()`, `runBtw()`, `resetThread()`, and `restoreThread()` — the actual contract boundary.

### What assumptions changed
- "T02 can finish with direct live TUI interaction" — not in this environment; external extension-load failures and disabled terminal automation permissions blocked that path.
- "The runtime harness is just a scaffold" — it is now executable and part of the slice verification story.
