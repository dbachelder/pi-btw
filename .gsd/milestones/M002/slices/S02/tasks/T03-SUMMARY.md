---
id: T03
parent: S02
milestone: M002
provides:
  - BTW now attaches its AgentSession event listener when the overlay opens and tears it down on close/dispose so transcript rendering is overlay-scoped instead of prompt-scoped
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S02/S02-PLAN.md
  - .gsd/milestones/M002/M002-ROADMAP.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
key_decisions:
  - D019: Make the overlay/session lifecycle own BTW sub-session event subscription and discard hidden-session events by unsubscribing on close/dispose
patterns_established:
  - BTW overlay opening is now the subscription attach point; session replacement, dismissal, and disposal all reuse the same centralized unsubscribe path
observability_surfaces:
  - `BtwOverlayComponent.getTranscriptEntries()` for transcript state inspection
  - `subSessionRecords[*].getListenerCount()` and `emit(...)` in `tests/btw.runtime.test.ts` for explicit listener lifecycle assertions
  - BTW overlay status text and `tui.requestRender()`-driven refreshes during streamed session events
duration: 30m
verification_result: passed
completed_at: 2026-03-15T11:50:06-07:00
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T03: Wire event subscription lifecycle to overlay

**Moved BTW session-event subscription ownership from `runBtw()` into the overlay/session lifecycle so listeners attach on open, tear down on dismiss/dispose, and late disposed-session events no longer mutate transcript state.**

## What Happened

The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S02/tasks/T03-PLAN.md` was not present, so I executed against the authoritative T03 contract in `.gsd/milestones/M002/slices/S02/S02-PLAN.md`.

In `extensions/btw.ts`, I removed the prompt-scoped `session.subscribe()` setup from `runBtw()` and introduced centralized helpers to attach, clear, and handle BTW sub-session event subscriptions. `ensureOverlay()` now subscribes the active BTW session as soon as the modal is created or re-shown, and both overlay close and session disposal route through the same unsubscribe path.

That change keeps transcript rendering and status updates overlay-scoped: while the overlay is open, streamed `AgentSessionEvent`s continue to refresh the transcript in real time through the existing `overlay.refresh()` → `tui.requestRender()` path. When the overlay is dismissed, the listener is removed immediately, so hidden/disposed-session events are discarded instead of buffered.

In `tests/btw.runtime.test.ts`, I extended the fake sub-session harness to expose `emit(...)` for explicit post-disposal event injection and added lifecycle assertions proving that opening BTW without submitting already installs one listener, Escape dismissal tears it down, and late events after disposal do not create stray transcript entries.

## Verification

- Passed: `npm test -- tests/btw.runtime.test.ts`
- Passed: `npm test -- tests/btw.runtime.test.ts -t "transcript inspection exposes streaming and failure state"`
- Passed: `npm test -- tests/btw.runtime.test.ts -t "aborts, disposes, and unsubscribes the active BTW sub-session when Escape dismisses mid-stream"`
- Verified by runtime assertions:
  - opening `/btw` with no submitted prompt attaches the BTW session listener immediately
  - Escape dismissal aborts/disposes the sub-session and leaves listener count at zero
  - late `turn_start` events emitted from a disposed fake session do not mutate transcript state
  - transcript inspection and failure-state assertions from S02 still pass after the lifecycle move
- Not executed: slice-level manual live pi/TUI verification (`open BTW in live pi, ask it to read a file`) because this environment currently lacks macOS Accessibility/Screen Recording permissions and the installed `pi` CLI is emitting unrelated extension-load failures during startup

## Diagnostics

- Read `extensions/btw.ts` around `removeBtwSessionSubscription()`, `clearBtwSessionSubscriptions()`, `handleBtwSessionEvent()`, `subscribeOverlayToActiveBtwSession()`, `ensureOverlay()`, and `disposeBtwSession()` to inspect the lifecycle wiring.
- Use `tests/btw.runtime.test.ts` cases `subscribes to the BTW sub-session as soon as the overlay opens` and `ignores late session events after overlay dismissal disposes the sub-session` as the fastest probes for listener ownership and post-disposal discard behavior.
- Call `overlay.getTranscriptEntries()` in the runtime harness to confirm whether any unexpected late session events mutated transcript state.

## Deviations

- The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S02/tasks/T03-PLAN.md` was absent, so execution followed the authoritative slice plan in `.gsd/milestones/M002/slices/S02/S02-PLAN.md`.

## Known Issues

- Manual live pi/TUI verification for this slice remains pending because local UI automation permissions are disabled and the installed `pi` CLI currently reports extension-load failures in this environment.

## Files Created/Modified

- `extensions/btw.ts` — moved BTW event subscription ownership into overlay/session lifecycle helpers and removed prompt-scoped subscribe/unsubscribe logic from `runBtw()`
- `tests/btw.runtime.test.ts` — exposed fake-session event injection and added listener-attach / post-disposal-ignore lifecycle assertions
- `.gsd/milestones/M002/slices/S02/S02-PLAN.md` — marked T03 complete
- `.gsd/milestones/M002/M002-ROADMAP.md` — marked S02 complete at the milestone roadmap level
- `.gsd/DECISIONS.md` — recorded the discard-on-dismiss event subscription ownership decision
- `.gsd/STATE.md` — advanced the active slice/next action to S03
