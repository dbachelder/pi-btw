---
id: T01
parent: S02
milestone: M002
provides:
  - BTW now maintains a typed event-driven transcript model with inspectable tool, thinking, assistant, and turn-boundary rows
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S02/S02-PLAN.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
key_decisions:
  - D017: Treat `BtwTranscriptEntry[]` plus `getTranscriptEntries()` as the canonical inspectable BTW transcript surface
patterns_established:
  - BTW transcript state is now built from `session.subscribe()` lifecycle events and restored completed turns are rehydrated into the same typed entry model
observability_surfaces:
  - `BtwOverlayComponent.getTranscriptEntries()`
  - `tests/btw.runtime.test.ts` transcript inspection assertions for streaming, tool rows, and preserved failure output
  - BTW overlay status text during tool execution and prompt failure
duration: 1h
verification_result: passed
completed_at: 2026-03-15T11:38:07-07:00
blocker_discovered: false
---

# T01: Define transcript entry model and event-to-transcript mapper

**Replaced BTW’s slot-based overlay state with a typed transcript built from AgentSession events, including inspectable tool call/result, thinking, assistant, and turn-boundary entries.**

## What Happened

I first fixed the pre-flight observability gap in `.gsd/milestones/M002/slices/S02/S02-PLAN.md` by adding an explicit verification step for inspectable transcript failure state.

In `extensions/btw.ts`, I replaced the old `BtwSlot` shape with a typed `BtwTranscriptEntry` union and a `BtwTranscriptState` runtime that tracks turn IDs, streaming state, and tool-call/result correlation. The new mapper consumes `session.subscribe()` events and translates `turn_start`, `message_*`, `tool_execution_*`, and `turn_end` into transcript entries instead of mutating a per-turn slot.

The overlay was minimally rewired so it now reads from the transcript state, renders transcript rows from typed entries, computes summary state from streaming flags, and exposes `getTranscriptEntries()` for direct test inspection. I also updated thread restore/reset paths so persisted completed BTW turns are rehydrated into the same transcript model rather than a separate legacy structure.

In `tests/btw.runtime.test.ts`, I upgraded the fake sub-session harness to emit `turn_start` / `turn_end` events and added assertions that the transcript inspection surface contains ordered turn boundaries, tool call/result rows, streaming thinking state, and preserved failure output after a sub-session error.

## Verification

- Passed: `npm test -- tests/btw.runtime.test.ts`
- Passed: `npm test -- tests/btw.runtime.test.ts -t "transcript inspection exposes streaming and failure state"`
- Verified by runtime assertions:
  - tool calls map to `tool-call` transcript entries with formatted args
  - tool results map to `tool-result` entries with truncation metadata
  - assistant/thinking streaming updates land in typed transcript rows
  - transcript inspection remains available after a BTW prompt failure
- Deferred: slice-level manual live pi overlay check (`open BTW in live pi, ask it to read a file`) because T02 still owns the richer visual rendering pass

## Diagnostics

- Call `overlay.getTranscriptEntries()` in the runtime harness to inspect the authoritative BTW transcript without scraping rendered text.
- Read `extensions/btw.ts` around `BtwTranscriptEntry`, `applyTranscriptEvent()`, `appendPersistedTranscriptTurn()`, and `setTranscriptFailure()` to inspect the mapper and recovery behavior.
- Use `tests/btw.runtime.test.ts` cases `maps turn, tool, thinking, and assistant events into transcript entries` and `transcript inspection exposes streaming and failure state` as the quickest executable probes.

## Deviations

- The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S02/tasks/T01-PLAN.md` was absent, so execution followed the authoritative slice plan in `.gsd/milestones/M002/slices/S02/S02-PLAN.md`.
- T01 necessarily touched minimal overlay rendering/summary plumbing so `BtwTranscriptEntry[]` could replace `slots[]` end-to-end without leaving dead runtime paths for T02 to clean up first.

## Known Issues

- Manual live pi verification of the richer overlay transcript is still pending.
- Tool-result rendering is intentionally basic for now; T02 still owns the visual polish and variable-height rendering refinements.

## Files Created/Modified

- `extensions/btw.ts` — introduced `BtwTranscriptEntry`/`BtwTranscriptState`, event-to-transcript mapping, transcript restore/reset helpers, and overlay transcript inspection
- `tests/btw.runtime.test.ts` — upgraded the fake sub-session event stream and added transcript inspection coverage for tool/result/streaming/failure rows
- `.gsd/milestones/M002/slices/S02/S02-PLAN.md` — added an explicit inspectable failure-state verification step and marked T01 complete
- `.gsd/DECISIONS.md` — recorded the transcript-inspection surface decision for downstream tasks
- `.gsd/STATE.md` — recorded the new active slice state and next action after T01
