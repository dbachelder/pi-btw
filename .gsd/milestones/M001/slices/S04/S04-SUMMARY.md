---
id: S04
parent: M001
milestone: M001
provides:
  - BTW-scoped in-modal slash dispatch that reuses registered command semantics, plus an explicit unsupported-slash fallback that rejects unknown commands without pretending main-surface parity
requires:
  - slice: S01
    provides: Modal composer input surface where slash parsing attaches
  - slice: S02
    provides: Preserved BTW command/thread contract that slash dispatch must not violate
affects: []
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
  - tests/btw.runtime.test.ts named assertions for in-modal slash command dispatch and unsupported-slash fallback
  - overlay status text and warning notifications for unsupported slash fallback
  - hidden btw-thread-entry/reset entries and sentUserMessages in the runtime harness
drill_down_paths:
  - .gsd/milestones/M001/slices/S04/tasks/T01-SUMMARY.md
duration: 34m
verification_result: passed
completed_at: 2026-03-13T20:40:00-07:00
---

# S04: Slash-command support and graceful fallback

**Added BTW-scoped slash dispatch inside the modal composer that reuses the shared command dispatcher for BTW-owned commands and explicitly rejects unsupported slash input with a local warning.**

## What Happened

S04 was a single-task slice. The modal composer previously sent all slash-prefixed input to the side model as ordinary BTW chat, which silently swallowed commands and created ambiguous failure modes.

The fix extracted BTW command behavior into a shared `dispatchBtwCommand()` helper in `extensions/btw.ts` and added a `parseOverlaySlashCommand()` seam in `submitFromOverlay()` that intercepts slash input before `runBtw()`. BTW-owned commands (`/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, `/btw:summarize`) route through the shared dispatcher and execute the same authoritative semantics proven in prior slices. Unsupported slash input is rejected with a BTW-local warning visible in overlay status and notifications — it never becomes hidden chat text and never implies main-surface command support.

The runtime harness was extended with named assertions proving in-modal `/btw:new` reuses reset-and-reopen, `/btw:tangent` reuses mode-switch with context-drop, `/btw:inject` reuses handoff with overlay dismissal, and unsupported slash input triggers the fallback without streaming, resetting, handing off, or mutating hidden thread state.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "unsupported slash input in the modal surfaces BTW-local fallback and does not execute a command"`
- `npm test`

## Requirements Advanced

- none (both relevant requirements moved directly to validated)

## Requirements Validated

- R012 — Validated by runtime assertions proving BTW-owned slash commands execute through shared dispatch inside the modal with the same semantics as registered command entrypoints.
- R013 — Validated by runtime assertion proving unsupported slash input surfaces an explicit BTW-local warning and does not execute, stream, reset, or hand off.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Full parity with arbitrary main-session slash commands inside BTW remains deferred by design — only BTW-owned commands are supported.
- Slash dispatch is artifact-verified through the runtime harness, not through a live pi terminal session.

## Follow-ups

- none

## Files Created/Modified

- `extensions/btw.ts` — added shared BTW command dispatch, modal slash parsing, and explicit unsupported-slash fallback handling
- `tests/btw.runtime.test.ts` — added named S04 runtime assertions for overlay slash command reuse and failure-path fallback observability
- `README.md` — documented BTW-scoped in-modal slash policy and unsupported-slash fallback rule
- `.gsd/REQUIREMENTS.md` — marked R012 and R013 validated with concrete proof text
- `.gsd/milestones/M001/M001-ROADMAP.md` — marked S04 complete

## Forward Intelligence

### What the next slice should know
- The shared `dispatchBtwCommand()` helper is the single authoritative dispatcher for all BTW command behavior — both registered commands and modal slash input flow through it. New BTW commands should be added there, not duplicated in the overlay path.
- The unsupported-slash fallback is intentionally strict: reject-with-warning, not send-as-chat. Changing this policy would require updating the S04 runtime assertions.

### What's fragile
- `parseOverlaySlashCommand()` does simple prefix matching on BTW-owned command names — if command naming conventions change, the parser needs updating in lockstep.

### Authoritative diagnostics
- `npm test -- tests/btw.runtime.test.ts -t "unsupported slash"` — fastest check for fallback regression
- `tests/btw.runtime.test.ts` S04 assertion block — covers command reuse and fallback in one pass
- `extensions/btw.ts` `submitFromOverlay()` — the seam where slash interception happens

### What assumptions changed
- none — S04 shipped as planned without surprises
