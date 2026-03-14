---
id: T01
parent: S01
milestone: M001
provides:
  - BTW overlay-backed modal shell wired to the existing hidden-thread persistence and streaming lifecycle
key_files:
  - extensions/btw.ts
  - README.md
  - .gsd/milestones/M001/slices/S01/S01-PLAN.md
key_decisions:
  - Kept BTW’s hidden-thread/reset helpers as the source of truth and layered the modal shell on top via `ctx.ui.custom(..., { overlay: true })`
patterns_established:
  - Shared BTW UI state now fans out to both the focused overlay transcript/status surface and the lightweight widget mirror without bypassing persistence helpers
observability_surfaces:
  - BTW modal-local status text, streamed transcript updates, and preserved failure state in the overlay/widget model
duration: 1h
verification_result: passed
completed_at: 2026-03-13T17:56:00-07:00
blocker_discovered: false
---

# T01: Wire the BTW overlay shell onto the existing thread pipeline

**Replaced the widget-only BTW flow with a focused overlay shell that still persists and restores through the existing hidden-thread pipeline.**

## What Happened

I first fixed the slice-plan observability gap by adding an explicit failure-path verification requirement to `S01-PLAN.md`.

In `extensions/btw.ts`, I refactored BTW presentation state so request status and transcript rendering no longer depend only on `setWidget()`. The extension now maintains shared overlay/widget state, opens a focused custom overlay through pi’s `ctx.ui.custom(..., { overlay: true })`, and renders a transcript + composer inside a `BtwOverlayComponent` built with pi TUI primitives.

Overlay submissions are routed back through the existing `runBtw()` path, which still builds context from `pendingThread`, appends successful turns via `pi.appendEntry(BTW_ENTRY_TYPE, ...)`, respects mode resets through `BTW_RESET_TYPE`, and keeps dismissal separate from `/btw:clear`. Reopening the modal uses current in-memory/restored thread state rather than inventing a parallel storage path.

I also updated `README.md` so the primary BTW UX is described as a focused modal shell while preserving the documented command semantics for `/btw`, `/btw:new`, `/btw:tangent`, and `/btw:clear`.

## Verification

- Passed: `npm pack --dry-run`
- Passed: `node --input-type=module -e "import('./extensions/btw.ts').then(()=>console.log('module-load:ok'))..."`
- Passed: code inspection of `extensions/btw.ts` confirming overlay submit/dismiss flows still go through `runBtw()`, `resetThread()`, `restoreThread()`, `pi.appendEntry(BTW_ENTRY_TYPE, ...)`, and `BTW_RESET_TYPE` rather than bypassing hidden-thread persistence
- Passed: README inspection confirming command semantics still match `/btw`, `/btw:new`, `/btw:tangent`, and `/btw:clear`
- Deferred to T02 / slice runtime verification: live `pi -e /Users/dan/src/pi-btw` modal interaction check, including reopen/restore and an inspectable failure-path check

## Diagnostics

Future agents can inspect the work by:

- reading `extensions/btw.ts` around `BtwOverlayComponent`, `ensureOverlay()`, `submitFromOverlay()`, `runBtw()`, `resetThread()`, and `restoreThread()`
- running `pi -e /Users/dan/src/pi-btw` and confirming the overlay status line changes across idle, streaming, and error states
- exercising a failing BTW request and checking that the modal status/transcript surface preserves the thread while surfacing the error

## Deviations

- Added an explicit failure-path verification bullet to `.gsd/milestones/M001/slices/S01/S01-PLAN.md` before implementation, per pre-flight instructions

## Known Issues

- T01 does not include a live interactive pi/TUI verification pass; that remains for T02
- The above-editor widget remains as a lightweight mirrored status surface for compatibility, even though the focused overlay is now the primary interaction surface

## Files Created/Modified

- `extensions/btw.ts` — refactored BTW state/rendering around a focused overlay shell while preserving hidden-thread persistence and restore helpers
- `README.md` — updated BTW UX wording from widget-first to modal-first without changing command semantics
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md` — added an explicit inspectable failure-path verification step for the slice
