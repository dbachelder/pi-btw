# S03: Explicit handoff and background-session integration — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S03 is an integration-contract slice. Its deliverable is executable proof that BTW handoff stays explicit, successful handoff dismisses and clears correctly, busy main-session delivery queues as follow-up, and summarize failure preserves a recoverable side thread. The slice plan explicitly says real runtime and human UAT are not required.

## Preconditions

- Repository is at the S03 completion state.
- Node dependencies are installed.
- The tester can run `npm test -- tests/btw.runtime.test.ts`, the targeted summarize-failure test, and `npm test`.
- The tester can inspect `tests/btw.runtime.test.ts` and `extensions/btw.ts`.

## Smoke Test

1. Run `npm test -- tests/btw.runtime.test.ts`.
2. **Expected:** Vitest reports 14 passing tests in `tests/btw.runtime.test.ts` with no failing handoff or boundary assertions.

## Test Cases

### 1. `/btw:inject` is the only successful full-thread handoff path

1. Open `tests/btw.runtime.test.ts` and locate the test named `/btw:inject success sends one main-session message, appends a reset marker, dismisses the overlay, and reopens fresh`.
2. Confirm it asserts exactly one `sentUserMessages` entry, one `btw-thread-reset` entry, one overlay hide call, and a fresh empty reopen transcript.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes, proving `/btw:inject` sends the formatted side-thread content to the main session, clears via reset-marker semantics, dismisses the modal, and leaves BTW fresh on reopen.

### 2. Busy main-session handoff queues as follow-up instead of interrupting visible work

1. In `tests/btw.runtime.test.ts`, inspect the test named `/btw:inject while the main session is busy delivers to the main session as a follow-up`.
2. Confirm it flips the harness to busy state with `setIdle(false)` before handoff.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes and the named assertion proves the handoff still sends exactly one main-session message but with `options: { deliverAs: "followUp" }`.

### 3. `/btw:summarize` hands back summary content and clears on success

1. In `tests/btw.runtime.test.ts`, inspect the test named `/btw:summarize success sends summary content, appends a reset marker, dismisses the overlay, and reopens fresh`.
2. Confirm it asserts a `completeSimpleMock` summarize call, exactly one `sentUserMessages` summary payload, a reset marker, overlay dismissal, and fresh reopen behavior.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes, proving summarize success uses summary content rather than raw transcript injection, then clears and dismisses exactly like a successful explicit handoff should.

### 4. Summarize failure preserves the side thread for retry or alternate handoff

1. Run `npm test -- tests/btw.runtime.test.ts -t "summarize failure preserves BTW thread state and keeps the overlay recoverable"`.
2. Inspect the matching test in `tests/btw.runtime.test.ts`.
3. Confirm it asserts zero `sentUserMessages`, one preserved `btw-thread-entry`, zero reset markers, overlay still visible, transcript still present, and an explicit error notification.
4. **Expected:** The targeted test passes, proving summarize failure does not collapse the BTW thread or silently hand anything to the main session.

### 5. Ordinary BTW follow-up and Escape do not cross the main-session boundary

1. In `tests/btw.runtime.test.ts`, inspect the test named `ordinary BTW follow-up submit and Escape dismissal do not send content to the main session`.
2. Confirm it performs an in-modal follow-up submit and then Escape dismissal without invoking inject or summarize.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes and the named assertion proves `sentUserMessages` stays empty while BTW thread entries continue to accumulate privately in the hidden side thread.

### 6. Full suite regression check

1. Run `npm test`.
2. **Expected:** The full project test suite passes, confirming the overlay runtime fix and new handoff assertions do not introduce broader regressions.

## Edge Cases

### Overlay close path stays live through successful handoff

1. Inspect `extensions/btw.ts` around `ensureOverlay()`, `dismissOverlay()`, and the `/btw:inject` / `/btw:summarize` handlers.
2. Confirm the tracked `overlayRuntime` is only nulled by the close path itself, not immediately after opening the overlay.
3. **Expected:** Successful handoff commands still have a live close handle available and can dismiss the active overlay deterministically.

### Reopen after successful handoff shows a fresh thread instead of stale transcript

1. Inspect the successful inject and summarize tests in `tests/btw.runtime.test.ts`.
2. Confirm each test explicitly reopens BTW after handoff.
3. **Expected:** The reopened transcript shows `No BTW thread yet. Ask a side question to start one.` rather than stale side-thread content.

## Failure Signals

- Any failing assertion in `tests/btw.runtime.test.ts` involving `sentUserMessages`, `deliverAs: "followUp"`, `btw-thread-reset`, or overlay hide/hidden state.
- Summarize failure creating a main-session user message, appending a reset marker, or hiding the overlay.
- Successful inject/summarize not reopening to a fresh transcript.
- Ordinary BTW submit or Escape producing `sentUserMessages` without an explicit handoff command.
- `npm test` failures outside the targeted BTW runtime suite after S03 changes.

## Requirements Proved By This UAT

- R007 — BTW handoff back to the main session stays explicit; only `/btw:inject` and `/btw:summarize` cross the boundary.
- R011 — BTW continues to coexist with main-session work in the background; busy-session handoff queues as follow-up and summarize failure preserves the side thread instead of collapsing it.

## Not Proven By This UAT

- Live subjective UX qualities like perceived speed, weight, and terminal feel.
- Human-visible modal aesthetics over the real pi session.
- Slash-command behavior inside the BTW modal composer, which belongs to S04.

## Notes for Tester

Start with the summarize-failure targeted test if you suspect a regression. It is the highest-signal probe because it verifies the hardest combination of requirements at once: no main-session leak, no reset marker, no overlay dismissal, preserved transcript, and explicit error reporting.
