---
id: T01
parent: S04
milestone: M001
provides:
  - BTW-scoped in-modal slash dispatch that reuses registered command semantics plus explicit unsupported-slash fallback
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - README.md
  - .gsd/REQUIREMENTS.md
  - .gsd/milestones/M001/M001-ROADMAP.md
key_decisions:
  - Reused BTW command behavior through a shared internal dispatcher instead of creating a second overlay-only command switch with divergent semantics
  - Unsupported modal slash input is rejected with a BTW-local warning instead of being sent as chat text or pretending to run arbitrary main-surface commands
patterns_established:
  - Narrow scoped slash interception at the modal composer seam with command-owned behavior delegated to a shared dispatcher
observability_surfaces:
  - overlay status text, warning notifications, hidden btw-thread-entry/reset entries, and sentUserMessages exposed by tests/btw.runtime.test.ts
duration: 34m
verification_result: passed
completed_at: 2026-03-13T20:40:00-07:00
blocker_discovered: false
---

# T01: Wire BTW-scoped slash dispatch and prove fallback behavior

**Added BTW-scoped modal slash dispatch through a shared internal command dispatcher, and proved that unsupported slash input surfaces an explicit local fallback without executing or falling through as BTW chat.**

## What Happened

I started by fixing the S04 plan’s observability gap so slice verification includes an explicit failure-path check for unsupported slash fallback.

In `extensions/btw.ts`, I extracted the real BTW command behavior into a shared `dispatchBtwCommand()` helper and routed both registered `/btw*` commands and overlay-submitted BTW slash input through that same seam. This kept the overlay thin and preserved the already-proven command/thread semantics for reset, mode switching, inject, and summarize behavior.

I added a small `parseOverlaySlashCommand()` helper in `submitFromOverlay()` so the modal now intercepts only BTW-owned slash commands: `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize`.

For unsupported slash input, I chose an explicit reject-with-warning fallback rather than treating unknown slash text as BTW chat. That avoids the ambiguous failure mode where users could think a command ran when it actually became side-chat text. The fallback is BTW-local, visible in status and notifications, and does not imply general main-input slash support inside the modal.

In `tests/btw.runtime.test.ts`, I added named runtime assertions proving:
- in-modal `/btw:new` reuses reset-and-reopen semantics
- in-modal `/btw:tangent` reuses mode-switch semantics and still drops inherited main-session context
- in-modal `/btw:inject` reuses handoff semantics, sends one main-session message, and dismisses the overlay
- unsupported modal slash input surfaces a warning and does not stream, reset, hand off, or mutate hidden thread state

After the runtime behavior passed, I updated `README.md` to document the narrow in-modal slash policy, marked R012/R013 validated in `.gsd/REQUIREMENTS.md`, and marked S04 complete in `.gsd/milestones/M001/M001-ROADMAP.md`.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "unsupported slash input in the modal surfaces BTW-local fallback and does not execute a command"`
- `npm test`

Behavior confirmed by named assertions in `tests/btw.runtime.test.ts`:
- overlay-submitted BTW slash commands reuse reset, mode, and handoff behavior
- unsupported slash fallback is explicit and non-executing
- unsupported slash input does not create hidden entries, reset markers, or `sentUserMessages`

## Diagnostics

Fastest inspection surfaces for future work:
- `tests/btw.runtime.test.ts` — named in-modal slash assertions for success and fallback behavior
- `extensions/btw.ts` — `submitFromOverlay()`, `parseOverlaySlashCommand()`, and `dispatchBtwCommand()`
- overlay status text and warning notifications for unsupported slash fallback
- hidden `btw-thread-entry` / `btw-thread-reset` entries plus `sentUserMessages` in the runtime harness

## Deviations

None.

## Known Issues

None for this slice scope. Full parity with arbitrary main-session slash commands inside BTW remains deferred by design.

## Files Created/Modified

- `extensions/btw.ts` — added shared BTW command dispatch, modal slash parsing, and explicit unsupported-slash fallback handling
- `tests/btw.runtime.test.ts` — added named S04 runtime assertions for overlay slash command reuse and failure-path fallback observability
- `README.md` — documented BTW-scoped in-modal slash policy and unsupported-slash fallback rule
- `.gsd/REQUIREMENTS.md` — marked R012 and R013 validated with concrete proof text
- `.gsd/milestones/M001/M001-ROADMAP.md` — marked S04 complete with the shipped narrow-scope slash outcome
- `.gsd/milestones/M001/slices/S04/S04-PLAN.md` — added an explicit failure-path verification step for unsupported slash fallback
