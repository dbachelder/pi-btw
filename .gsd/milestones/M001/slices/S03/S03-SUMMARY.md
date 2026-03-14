---
id: S03
parent: M001
milestone: M001
provides:
  - Executable proof that BTW handoff remains explicit, successful inject/summarize clear and dismiss correctly, busy main-session delivery queues as follow-up, and summarize failure preserves a recoverable side thread
requires:
  - slice: S02
    provides: Preserved BTW command semantics, restore behavior, and hidden-thread/reset-marker contract under the modal UI
affects:
  - S04
key_files:
  - tests/btw.runtime.test.ts
  - extensions/btw.ts
  - .gsd/REQUIREMENTS.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
  - .gsd/PROJECT.md
  - .gsd/milestones/M001/M001-ROADMAP.md
key_decisions:
  - Treat overlay dismissal as a production contract proven through runtime assertions instead of a purely visual assumption.
  - Preserve and reuse the existing overlay runtime across dismiss/reopen cycles rather than forcing a fresh overlay handle every reopen.
patterns_established:
  - Prove BTW/main-session separation by asserting sentUserMessages, reset markers, hidden thread entries, and overlay handle state together.
  - Use a focused summarize-failure probe as the fastest regression check for recoverability and boundary preservation.
observability_surfaces:
  - tests/btw.runtime.test.ts assertions over sentUserMessages payload/options, btw-thread-entry/reset custom entries, overlay handle hidden state, and summarize failure status/notifications
  - extensions/btw.ts handoff helpers sendThreadToMain(), resetThread(), ensureOverlay(), and summarize command flow
drill_down_paths:
  - .gsd/milestones/M001/slices/S03/tasks/T01-SUMMARY.md
duration: 1h
verification_result: passed
completed_at: 2026-03-13T20:31:53-07:00
---

# S03: Explicit handoff and background-session integration

**Extended the BTW runtime contract to prove explicit handoff, busy-session follow-up delivery, summarize-failure recovery, and side-thread separation, then fixed the live overlay cleanup bug those assertions exposed.**

## What Happened

S03 was an integration-boundary slice, so the work centered on executable proof rather than broad production churn. The runtime harness in `tests/btw.runtime.test.ts` was extended with named assertions for `/btw:inject` success, `/btw:inject` while the main session is busy, `/btw:summarize` success, `/btw:summarize` failure preservation, and the explicit-boundary rule that ordinary BTW follow-up submit plus Escape dismissal never create main-session user messages.

Those new assertions exposed a real bug in `extensions/btw.ts`: `ensureOverlay()` dropped the tracked `overlayRuntime` after opening the modal, which severed the live close path while the overlay was still active. That meant explicit dismissal and successful handoff could lose their handle-driven close behavior. The fix was to remove the stale cleanup and keep overlay lifecycle ownership with the runtime close callback, so handoff commands and Escape dismissal now close the active overlay truthfully.

With the lifecycle bug fixed, the slice also strengthened the reopen contract: BTW now reuses the tracked overlay runtime across dismiss/reopen instead of assuming a brand-new overlay handle is required every time. After that, requirements evidence, decisions, roadmap state, project state, and slice artifacts were updated to reflect that explicit handoff and background coexistence are now validated.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "summarize failure preserves BTW thread state and keeps the overlay recoverable"`
- `npm test`

Observability confirmed through the runtime harness:
- `sentUserMessages` content and `deliverAs: "followUp"` behavior for busy-main-session handoff
- `btw-thread-reset` append behavior on successful `/btw:inject` and `/btw:summarize`
- `btw-thread-entry` preservation when summarize fails
- overlay handle hide/hidden state and reopen semantics
- summarize failure status text and notification output

## Requirements Advanced

- R002 — Added executable proof that BTW still behaves like a lightweight side surface by dismissing cleanly through the live overlay runtime during handoff and Escape paths.
- R007 — Added explicit runtime proof that only `/btw:inject` and `/btw:summarize` cross the BTW/main-session boundary.
- R011 — Added runtime proof that BTW coexists with active main-session work by queuing handoff as `deliverAs: "followUp"` when the visible session is busy.

## Requirements Validated

- R007 — Now validated by named runtime assertions proving inject/summarize are the only paths that create `sentUserMessages`, while ordinary follow-up submit and Escape dismissal remain side-thread-local.
- R011 — Now validated by runtime assertions proving successful handoff clears via reset markers and dismisses the overlay, busy-main-session handoff queues behind active work, and summarize failure preserves a recoverable side thread instead of collapsing into the main session.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- S03 remains artifact-driven; it proves the integration contract through the runtime harness rather than through a live pi terminal session.
- Slash-command behavior inside the BTW modal composer is still unresolved and remains in S04.

## Follow-ups

- S04 should use the now-stable overlay runtime and explicit boundary assertions as guardrails when evaluating slash-command behavior inside the modal composer.
- If future regressions appear in handoff behavior, start with the summarize-failure test before broad debugging; it exercises the most delicate recovery path with the clearest signals.

## Files Created/Modified

- `tests/btw.runtime.test.ts` — added named S03 assertions for inject/summarize success and failure, busy-session follow-up delivery, and explicit non-handoff behavior
- `extensions/btw.ts` — removed stale overlay runtime cleanup so handoff and Escape dismissal retain a live close handle until the overlay actually closes
- `.gsd/REQUIREMENTS.md` — recorded executable proof for explicit handoff and background-session coexistence requirements
- `.gsd/DECISIONS.md` — appended the overlay-dismissal/runtime-reuse decisions surfaced by S03
- `.gsd/milestones/M001/slices/S03/S03-SUMMARY.md` — compressed task execution into slice-level completion evidence
- `.gsd/milestones/M001/slices/S03/S03-UAT.md` — added slice-specific artifact-driven UAT for handoff, busy delivery, and summarize-failure recovery
- `.gsd/milestones/M001/M001-ROADMAP.md` — marked S03 complete
- `.gsd/PROJECT.md` — refreshed milestone progress and current project state wording for S03 completion
- `.gsd/STATE.md` — advanced active work from S03 summarizing to S04-ready state

## Forward Intelligence

### What the next slice should know
- The authoritative handoff boundary proof now lives in `tests/btw.runtime.test.ts`; treat those named assertions as the guardrail before changing BTW composer behavior in S04.
- Reset markers still define when a BTW thread is truly cleared. Overlay visibility alone is not authoritative.

### What's fragile
- Overlay lifecycle state in `extensions/btw.ts` is thinly wired through `overlayRuntime`; premature nulling or recreating the runtime at the wrong time will break handoff/Escape dismissal semantics even if the UI still appears to render.
- Summarize failure is the most sensitive recovery path because it must preserve thread state, keep the modal open, avoid reset markers, and surface a useful error.

### Authoritative diagnostics
- `npm test -- tests/btw.runtime.test.ts -t "summarize failure preserves BTW thread state and keeps the overlay recoverable"` — fastest high-signal check for recoverability and explicit-boundary regressions
- `tests/btw.runtime.test.ts` — direct visibility into sentUserMessages, hidden custom entries, overlay handles, and notifications makes handoff regressions easy to localize
- `extensions/btw.ts` helpers `sendThreadToMain()`, `resetThread()`, and `ensureOverlay()` — first production seams to inspect when handoff assertions fail

### What assumptions changed
- The expected work was mostly “add more proof around handoff behavior” — in practice, the new proof immediately exposed a real overlay lifecycle bug that required a production fix.
- Reopen behavior was previously assumed to need a fresh overlay handle each time — after the fix, the stronger and more truthful contract is that the tracked overlay runtime remains reusable until actual dismissal.
