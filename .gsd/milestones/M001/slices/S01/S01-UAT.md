# S01: Modal BTW chat shell — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: the slice ships real modal-shell code and now has a passing runtime harness for core overlay/thread semantics, but this environment could not complete terminal-level live automation because macOS Accessibility is disabled and global extension discovery produced unrelated load failures.

## Preconditions

- Repo is at the S01-complete state.
- `npm test` passes.
- For a live/manual run, use a pi invocation that loads this extension from the local checkout.
- If attempting terminal automation, macOS Accessibility must be enabled for the terminal first.
- If the default GSD environment still injects broken global extensions, use a pi launch path that avoids those unrelated extension load failures before judging BTW behavior.

## Smoke Test

1. Run `npm test`.
2. **Expected:** `tests/btw.runtime.test.ts` passes all four tests and proves the modal shell can reopen with preserved thread state, accept an in-place follow-up, surface explicit missing-credential errors, and render as an overlay.

## Test Cases

### 1. Open BTW, ask a question, dismiss, and reopen without losing the thread

1. Launch pi with the local extension loaded.
2. Run `/btw what file owns BTW state?`.
3. Wait for the BTW answer to stream into the modal transcript.
4. Press `Escape`.
5. Run `/btw` with no question to reopen the BTW modal.
6. **Expected:** the BTW modal reopens over the main work area, the prior transcript is still visible, and the thread was not cleared by Escape dismissal.

### 2. Ask a follow-up inside the BTW modal

1. With an existing BTW modal open after one completed exchange, place focus in the BTW composer.
2. Type a follow-up question such as `how would you refactor that?`.
3. Press `Enter`.
4. **Expected:** the follow-up is submitted without returning to the main input, a second BTW response streams into the same transcript, and both exchanges remain visible in order.

### 3. Confirm BTW stays visually separate from the main session

1. Open BTW from a session that already has visible main-session content behind it.
2. Observe the screen while the BTW modal is open.
3. **Expected:** BTW appears as an overlay/modal on top of the main work area rather than replacing the main session surface; the underlying session remains visibly behind it.

### 4. Inspectable failure path: missing credentials or provider/model failure

1. Start a run where BTW cannot get credentials for the active model, or temporarily use a model/provider configuration that will fail before a successful answer is returned.
2. Run `/btw why is this failing?`.
3. **Expected:** the BTW modal stays open and shows an explicit error/status message; no successful hidden-thread exchange is created for the failed request; the thread is preserved for retry or follow-up rather than being silently cleared.

## Edge Cases

### Escape during a completed thread

1. Complete one BTW exchange, then press `Escape`.
2. Reopen BTW.
3. **Expected:** the modal closes quickly, but reopening shows the prior thread instead of a blank state.

### Empty reopen path

1. After at least one successful BTW exchange, run `/btw` with no question.
2. **Expected:** BTW reopens the modal instead of starting a new request, preserving the existing thread transcript for continued use.

### Follow-up after one completed exchange

1. Finish one BTW exchange.
2. Submit a second prompt from the overlay composer.
3. **Expected:** both turns are stored in the same BTW thread and the status returns to a ready-for-follow-up state after the second answer completes.

## Failure Signals

- BTW opens only as a passive widget and not as an overlay/modal.
- Typing while BTW is open still goes to the main input instead of the BTW composer.
- Escape clears the BTW thread or loses the prior transcript on reopen.
- A follow-up requires returning to the main input instead of being submitted in place.
- Errors disappear silently, clear the thread, or fail to show explicit status text.
- `npm test` fails in `tests/btw.runtime.test.ts` for overlay semantics, thread preservation, follow-up flow, or failure-state handling.

## Requirements Proved By This UAT

- R003 — BTW renders as an overlay/modal over the active work area.
- R008 — Escape dismisses BTW without breaking preserved thread behavior.
- R009 — BTW supports continued side-thread interaction in place.

## Not Proven By This UAT

- R005 — Full README contract preservation for `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` remains for S02.
- R006 — Exact contextual vs tangent distinction remains for S02.
- R007 — Explicit inject/summarize handoff behavior remains for S03.
- R010 — Full restore/restart/session-switch behavior remains for S02/S03.
- R012 — Slash-command behavior inside the modal remains for S04.
- Full human live-runtime proof in this environment was not completed because macOS terminal automation permissions are disabled and unrelated globally discovered extensions interfered with clean pi startup.

## Notes for Tester

- If the live pi run shows extension-load failures from `~/.gsd/agent/extensions/*`, treat those as environment noise first and isolate them before blaming BTW.
- The widget above the editor is still present as a lightweight mirror; that is intentional compatibility behavior. The primary interaction surface for S01 is the focused overlay modal.
- If you need quick confidence before fighting the live environment, trust `npm test` first; it is currently the cleanest diagnostic surface for this slice in this repo.
