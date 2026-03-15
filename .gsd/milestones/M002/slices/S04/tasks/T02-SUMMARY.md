---
id: T02
parent: S04
milestone: M002
provides:
  - Added contract-grade runtime assertions for incremental transcript streaming, slash failure recovery, empty-thread injection, and clear-during-tool disposal in the BTW sub-session suite
key_files:
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S04/S04-PLAN.md
  - .gsd/STATE.md
key_decisions:
  - Harden T02 by extending the existing AgentSession harness with command-path assertions instead of adding new production diagnostics or runtime hooks
patterns_established:
  - Prove BTW slash, handoff, and disposal behavior through real command/overlay entrypoints plus `subSessionRecords`, `overlay.statusText.text`, and `overlay.getTranscriptEntries()`
observability_surfaces:
  - `BtwOverlayComponent.getTranscriptEntries()`, `overlay.statusText.text`, and `subSessionRecords[n].promptCalls/getIsStreaming()/getListenerCount()` in `tests/btw.runtime.test.ts`
duration: 45m
verification_result: passed
completed_at: 2026-03-15T19:24:46Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T02: Add transcript, slash, and parallel assertions

**Expanded the BTW runtime contract suite with named assertions for incremental streaming, slash failure recovery, empty-thread injection, and clear-during-tool disposal.**

## What Happened

The dispatch instructed me to read `.gsd/milestones/M002/slices/S04/tasks/T02-PLAN.md`, but that file does not exist in this branch, so I used `.gsd/milestones/M002/slices/S04/S04-PLAN.md` as the authoritative local contract.

I first audited `tests/btw.runtime.test.ts` against the T02 requirements instead of rewriting it blindly. Most of the transcript/slash/parallel contract already existed: event-to-transcript mapping, tool-call/result rendering, slash routing through `prompt()`, inject/summarize using sub-session message history, and main-session independence while BTW streams.

I then added only the missing hardening assertions:
- incremental assistant-text updates are visible in `getTranscriptEntries()` while a BTW reply is still streaming
- `/btw:clear` during an active tool run aborts/disposes the sub-session and leaves no partial hidden thread behind
- `/btw:inject` with an empty ready sub-session warns without disposing the session or handing anything to the main thread
- routed non-BTW slash input that fails still preserves the existing BTW thread and leaves the overlay recoverable with inspectable failure state

To support the incremental-streaming proof without touching production code, I added a test-only blocking stream helper to the existing fake AgentSession harness.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state|summarize failure preserves BTW thread state and keeps the overlay recoverable"`

Slice-level partial status for this intermediate task:
- `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts`
  - still returns `completeSimple` hits in `extensions/btw.ts`; expected remaining work for T03
- Manual live-pi BTW workflow verification
  - not run in T02

## Diagnostics

Use `tests/btw.runtime.test.ts` as the contract-grade inspection surface:
- `overlay.getTranscriptEntries()` for incremental assistant text, tool-call/result rows, and preserved failure entries
- `overlay.statusText.text` for streaming/tool/handoff/recovery status changes
- `subSessionRecords[n].promptCalls` to prove slash-prefixed input routed through the BTW sub-session
- `subSessionRecords[n].getIsStreaming()` and `getListenerCount()` to prove clear/dispose behavior during active work

## Deviations

- The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S04/tasks/T02-PLAN.md` was missing, so execution followed `.gsd/milestones/M002/slices/S04/S04-PLAN.md`

## Known Issues

- Slice cleanup is still pending in T03: `extensions/btw.ts` still contains `completeSimple`, so the dead-code grep verification is not yet green
- Manual live BTW verification is still outstanding for the slice

## Files Created/Modified

- `tests/btw.runtime.test.ts` — added the missing T02 contract assertions and a blocking stream helper for incremental transcript proof
- `.gsd/milestones/M002/slices/S04/S04-PLAN.md` — marked T02 complete
- `.gsd/milestones/M002/slices/S04/tasks/T02-SUMMARY.md` — recorded the shipped assertions, verification, and remaining slice work
- `.gsd/STATE.md` — advanced execution state to T03
