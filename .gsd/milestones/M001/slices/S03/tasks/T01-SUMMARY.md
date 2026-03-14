---
id: T01
parent: S03
milestone: M001
provides:
  - Executable proof that BTW handoff stays explicit, survives busy-main-session delivery, and preserves side-thread recovery on summarize failure
key_files:
  - tests/btw.runtime.test.ts
  - extensions/btw.ts
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Treat overlay dismissal as a production contract proven through runtime tests rather than a purely visual assumption
  - Preserve and reuse the existing overlay runtime across reopen instead of creating a new overlay handle on every reopen
patterns_established:
  - Use sentUserMessages plus reset-marker and overlay-state assertions to prove BTW/main-session boundary behavior
observability_surfaces:
  - Runtime assertions over sentUserMessages delivery options, btw-thread-entry/reset custom entries, overlay handle state, and summarize failure status/notifications
duration: 1h
verification_result: passed
completed_at: 2026-03-13T20:30:00-07:00
blocker_discovered: false
---

# T01: Extend the BTW runtime gate to prove explicit handoff and busy-session integration

**Added S03 runtime coverage for explicit handoff, busy-session follow-up delivery, summarize failure recovery, and the non-handoff boundary, then fixed the overlay runtime cleanup bug those tests exposed.**

## What Happened

I first patched `S03-PLAN.md` so slice verification includes an inspectable failure-path check instead of only happy-path test commands. Then I extended `tests/btw.runtime.test.ts` with named assertions for `/btw:inject` success, `/btw:inject` while the main session is busy, `/btw:summarize` success, `/btw:summarize` failure preservation, and the explicit-boundary rule that normal BTW follow-up submit plus Escape dismissal do not create main-session user messages.

The new tests initially exposed a real production bug in `extensions/btw.ts`: `ensureOverlay()` nulled `overlayRuntime` immediately after `ui.custom()` returned, which severed the live close handle while the modal was still active. That made successful handoff and Escape dismissal lose their explicit close path. I removed that stale cleanup and kept the close behavior wired through the existing runtime close callback.

Because the overlay now correctly stays live across dismiss/reopen cycles, one older runtime assertion was updated to match the stronger contract: reopening BTW reuses the tracked overlay runtime instead of requiring a brand-new overlay handle. Finally, I updated `.gsd/REQUIREMENTS.md` so S03 now explicitly validates the explicit-handoff and busy-background coexistence requirements with executable proof.

## Verification

- `npm test -- tests/btw.runtime.test.ts` ✅
- `npm test -- tests/btw.runtime.test.ts -t "summarize failure preserves BTW thread state and keeps the overlay recoverable"` ✅
- `npm test` ✅

Verified signals include:
- `sentUserMessages` content and `deliverAs: "followUp"` behavior while main session is busy
- `btw-thread-reset` append behavior on successful inject/summarize handoff
- `btw-thread-entry` preservation on summarize failure
- overlay dismissal/reopen behavior through runtime handle/state assertions
- explicit non-handoff behavior for ordinary follow-up submit and Escape dismissal

## Diagnostics

Re-run `tests/btw.runtime.test.ts` and inspect the named handoff assertions if S03 regresses. The fastest failure-path probe is:

- `npm test -- tests/btw.runtime.test.ts -t "summarize failure preserves BTW thread state and keeps the overlay recoverable"`

The primary inspection surfaces are:
- `sentUserMessages` assertions for content and delivery mode
- hidden custom entries `btw-thread-entry` / `btw-thread-reset`
- overlay handle state and reopen semantics
- summarize failure status text and notification assertions

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `tests/btw.runtime.test.ts` — added S03 runtime assertions for inject/summarize success and failure, busy-session follow-up delivery, and explicit boundary behavior; updated one legacy reopen assertion to match the corrected overlay runtime contract
- `extensions/btw.ts` — removed stale `overlayRuntime` cleanup so explicit dismissal paths retain a live close handle until the overlay is actually dismissed
- `.gsd/REQUIREMENTS.md` — marked S03-owned explicit handoff and background coexistence requirements validated with proof text
- `.gsd/milestones/M001/slices/S03/S03-PLAN.md` — added an explicit failure-path verification command
