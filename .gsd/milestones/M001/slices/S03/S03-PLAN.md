# S03: Explicit handoff and background-session integration

**Goal:** Prove that BTW handoff back to the main session stays explicit and that the modal continues to coexist cleanly with the main session behind it.
**Demo:** While the BTW modal is open, only explicit handoff commands (`/btw:inject`, `/btw:summarize`) send content back to the main session; successful handoff clears hidden BTW state and dismisses the overlay, busy main-session handoff queues as a follow-up, summarize failure preserves the thread for retry, and ordinary BTW submit/Escape keep the side thread separate.

## Must-Haves

- Explicit handoff remains command-owned: only `/btw:inject` and `/btw:summarize` cross the BTW/main-session boundary.
- Successful handoff sends the right content to the main session, clears hidden BTW thread state via reset-marker semantics, and dismisses the modal.
- When the main session is busy, BTW handoff uses background-session follow-up delivery instead of interrupting visible main work.
- Summarize failure preserves BTW thread state and keeps the modal recoverable for retry or alternate handoff.
- Verification proves BTW still coexists with the main session behind the overlay rather than acting like an implicit second main session.

## Proof Level

- This slice proves: integration
- Real runtime required: no
- Human/UAT required: no

## Verification

- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "summarize failure preserves BTW thread state and keeps the overlay recoverable"`
- `npm test`

## Observability / Diagnostics

- Runtime signals: `sentUserMessages` payload/options, hidden `btw-thread-entry` and `btw-thread-reset` entries, overlay handle hidden state, summarize status/notification output
- Inspection surfaces: `tests/btw.runtime.test.ts` harness assertions and `extensions/btw.ts` handoff helpers (`sendThreadToMain`, `resetThread`, summarize command flow)
- Failure visibility: wrong delivery mode, missing reset marker, overlay left open/closed incorrectly, or preserved thread lost on summarize failure
- Redaction constraints: assert on message shape and control flow without introducing secret-bearing model credentials into test output

## Integration Closure

- Upstream surfaces consumed: `extensions/btw.ts` handoff commands and helpers, existing hidden-thread/reset-marker contract, `tests/btw.runtime.test.ts` harness from S02
- New wiring introduced in this slice: named runtime assertions covering inject/summarize handoff, busy-session follow-up delivery, failure preservation, and explicit-boundary proof
- What remains before the milestone is truly usable end-to-end: S04 must resolve slash-command behavior inside the modal or deliver a coherent fallback

## Tasks

- [x] **T01: Extend the BTW runtime gate to prove explicit handoff and busy-session integration** `est:45m`
  - Why: S03 is primarily a boundary-contract slice; the safest way to close it is to prove the existing inject/summarize seam behaves correctly under success, busy-main-session, failure, and non-handoff interactions before changing production code.
  - Files: `tests/btw.runtime.test.ts`, `extensions/btw.ts`, `.gsd/REQUIREMENTS.md`
  - Do: Add named runtime assertions for `/btw:inject` success, `/btw:inject` while busy, `/btw:summarize` success, `/btw:summarize` failure, and the explicit-boundary rule that ordinary BTW submit/Escape do not create main-session user messages; only change `extensions/btw.ts` if those assertions expose a concrete contract gap, then update requirements evidence for the requirements this slice closes.
  - Verify: `npm test -- tests/btw.runtime.test.ts && npm test`
  - Done when: The runtime suite proves successful handoff sends exactly one main-session user message with the expected delivery mode, appends the correct reset signal, dismisses the overlay, preserves thread state on summarize failure, and shows that non-handoff BTW interactions never send content to the main session.

## Files Likely Touched

- `tests/btw.runtime.test.ts`
- `extensions/btw.ts`
- `.gsd/REQUIREMENTS.md`
- `.gsd/STATE.md`
- `.gsd/milestones/M001/slices/S03/tasks/T01-PLAN.md`
