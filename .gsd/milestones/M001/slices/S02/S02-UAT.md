# S02: BTW contract preservation — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S02 is a contract slice. Its deliverable is executable proof that hidden-thread semantics, restore behavior, and context filtering still hold under the modal-backed BTW implementation. The slice plan explicitly says real runtime and human UAT are not required.

## Preconditions

- Repository is at the S02 completion state.
- Node dependencies are installed.
- The tester can run `npm test -- tests/btw.runtime.test.ts` and `npm test`.
- The tester can inspect `tests/btw.runtime.test.ts` and `extensions/btw.ts`.

## Smoke Test

1. Run `npm test -- tests/btw.runtime.test.ts`.
2. **Expected:** Vitest reports 9 passing tests in `tests/btw.runtime.test.ts` with no failing BTW contract assertions.

## Test Cases

### 1. Core command contract is preserved

1. Open `tests/btw.runtime.test.ts`.
2. Locate the assertions named for `/btw:new`, `/btw:clear`, `/btw:tangent`, and `/btw` behavior.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes, proving reset markers are appended where expected, fresh-thread reopen behavior works, and command-owned mode resets still match the README contract.

### 2. Contextual and tangent modes stay distinct

1. In `tests/btw.runtime.test.ts`, inspect the test named `switching between /btw:tangent and /btw appends reset markers and tangent requests omit inherited main-session conversation`.
2. Confirm the test checks both reset-marker modes and the request payload sent to the mocked stream function.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes and the named assertion proves tangent requests do not inherit main-session messages or BTW notes, while switching back to contextual BTW clears the tangent transcript.

### 3. Restore behavior honors the last reset across all restore events

1. In `tests/btw.runtime.test.ts`, inspect the tests covering `/btw:clear` restore behavior and `restore behavior is consistent across session_start, session_switch, and session_tree`.
2. Confirm they seed `btw-thread-reset` and `btw-thread-entry` items and assert that only entries after the last reset rehydrate.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes and proves `restoreThread()` treats the last reset marker as authoritative for all three restore paths.

### 4. BTW notes are excluded from main-session context

1. In `tests/btw.runtime.test.ts`, inspect the test named `context filtering excludes BTW notes from main-session context while leaving non-BTW messages intact`.
2. Confirm it executes the registered `context` handler directly and compares the returned message list.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes and the returned context contains ordinary user/assistant messages but excludes `btw-note` custom messages.

### 5. Explicit failure diagnostics remain inspectable

1. In `tests/btw.runtime.test.ts`, inspect the test named `surfaces missing credentials as an explicit error without creating a thread entry`.
2. Confirm it asserts both overlay status text and notification output, not just transcript content.
3. Run `npm test -- tests/btw.runtime.test.ts`.
4. **Expected:** The suite passes and proves missing credentials produce a structured error signal without appending a hidden BTW thread entry.

### 6. Full suite regression check

1. Run `npm test`.
2. **Expected:** The full project test suite passes, confirming S02’s contract proofs do not introduce regressions elsewhere.

## Edge Cases

### Restore after clear plus new post-clear entry

1. Inspect the `/btw:clear dismisses the overlay, appends a reset marker, and restore only rehydrates entries after the last reset` test.
2. Confirm it seeds pre-reset history, clears the thread, appends a new post-clear entry, and then runs a later restore path.
3. **Expected:** Only the post-clear entry appears after restore; pre-clear BTW history stays excluded.

### Tangent mode ignores visible BTW notes in main history

1. Inspect the mode-switch test’s seeded main-session entries.
2. Confirm it includes both a visible `btw-note` and a regular user message.
3. **Expected:** The tangent request payload includes neither the saved BTW note nor the main-session task text.

## Failure Signals

- Any failing assertion in `tests/btw.runtime.test.ts` involving `btw-thread-reset`, `btw-thread-entry`, restore-event handlers, or the `context` hook.
- Tangent request payloads containing inherited main-session text or BTW notes.
- Restore tests rehydrating entries from before the last reset marker.
- Missing-credentials flows that append a thread entry or fail to surface explicit status/notification output.
- `npm test` failures outside the targeted BTW suite after S02 changes.

## Requirements Proved By This UAT

- R005 — Core BTW command semantics remain preserved for `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent`.
- R006 — Contextual and tangent BTW behavior remain distinct and truthful to the documented contract.
- R010 — Hidden BTW thread state survives and restores according to reset-marker boundaries across session restore events.
- R014 — BTW notes remain outside main-session context unless explicitly handed back.

## Not Proven By This UAT

- Live subjective UX qualities like speed, lightweight feel, and in-terminal ergonomics.
- Explicit handoff behavior for `/btw:inject` and `/btw:summarize`, which belongs to S03.
- Slash-command behavior inside the BTW modal composer, which belongs to S04.

## Notes for Tester

This slice is intentionally verified through executable artifacts rather than manual interaction. If a test fails, inspect `tests/btw.runtime.test.ts` first for the named broken contract, then inspect `extensions/btw.ts` at `buildBtwContext()`, `resetThread()`, `restoreThread()`, command handlers, or the `context` hook depending on the failing assertion.
