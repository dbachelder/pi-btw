---
estimated_steps: 5
estimated_files: 2
---

# T01: Add executable proof for BTW command and restore contracts

**Slice:** S02 — BTW contract preservation
**Milestone:** M001

## Description

Expand the existing BTW runtime harness so it can directly prove the contract seams S02 owns: command semantics, reset-marker behavior, restore paths, and main-context separation. This task should add real assertions, not just better test helpers.

## Steps

1. Extend the harness in `tests/btw.runtime.test.ts` so tests can invoke the registered `session_switch`, `session_tree`, and `context` handlers and inspect their outputs without reading live TUI state.
2. Add focused tests for `/btw:new` proving it appends a reset marker, clears prior hidden thread state, stays contextual, and can reopen a fresh thread.
3. Add focused tests for `/btw:tangent` and `/btw` mode switching proving switching modes appends/reset-clears the thread and tangent requests omit inherited main-session conversation.
4. Add focused tests for `/btw:clear` and restore behavior proving clear dismisses the overlay, appends a reset marker, and later restore paths only rehydrate entries after the last reset across `session_start`, `session_switch`, and `session_tree`.
5. Add a context-boundary test proving BTW notes are excluded from main-session context while non-BTW messages still pass through.

## Must-Haves

- [ ] Runtime tests explicitly cover R005, R006, R010, and R014 rather than inferring them from transcript text alone.
- [ ] Tests inspect reset markers, hidden entries, restore outputs, or context-hook results directly.

## Verification

- `npm test -- tests/btw.runtime.test.ts`
- The new assertions fail if mode switching, reset markers, restore wiring, or context filtering regress.

## Observability Impact

- Signals added/changed: harness-visible event-handler outputs for restore and context filtering.
- How a future agent inspects this: run `npm test -- tests/btw.runtime.test.ts` and read the named contract assertions.
- Failure state exposed: the failing contract seam is localized to command semantics, restore behavior, or context pollution.

## Inputs

- `tests/btw.runtime.test.ts` — existing overlay/runtime harness from S01 to extend rather than replace.
- `extensions/btw.ts` — authoritative command, reset/restore, and context-hook behavior the tests must prove.

## Expected Output

- `tests/btw.runtime.test.ts` — expanded harness plus executable S02 contract assertions.
