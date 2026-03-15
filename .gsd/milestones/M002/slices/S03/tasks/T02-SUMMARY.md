---
id: T02
parent: S03
milestone: M002
provides:
  - BTW inject and summarize now extract handoff content from the active sub-session history instead of formatting only the persisted pending thread
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S03/S03-PLAN.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
key_decisions:
  - D021: derive BTW handoff payloads from the sub-session message history using a recorded side-thread boundary that excludes seeded main-session context and continuation markers
patterns_established:
  - Record the side-thread start index when creating the BTW sub-session, then strip only the resume marker pair before formatting user/assistant handoff turns for inject and summarize
observability_surfaces:
  - BTW overlay status text for inject/summarize progress and retry-safe failures, plus runtime assertions against mutated `subSessionRecords[n].session.state.messages`
duration: 1h
verification_result: passed
completed_at: 2026-03-15T19:03:41Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T02: Rewrite inject/summarize to extract from sub-session

**BTW handoff now formats inject/summarize payloads from the real sub-session conversation while excluding seeded main-session context and resume markers.**

## What Happened

The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S03/tasks/T02-PLAN.md` was absent, so I executed T02 from `.gsd/milestones/M002/slices/S03/S03-PLAN.md`.

In `extensions/btw.ts`, I replaced the old handoff dependency on `pendingThread[]` with a sub-session extraction seam. `createBtwSubSession()` now records the side-thread boundary for each BTW session, `extractBtwHandoffThread()` derives user/assistant exchanges from `session.state.messages`, and the extractor strips the internal thread-resume marker pair before formatting inject/summarize content. This keeps contextual seed messages from leaking into the handoff payload while still including restored BTW turns plus any newer sub-session-only turns.

`/btw:inject` now sets explicit handoff status, builds its message from the extracted sub-session exchanges, and only clears/dismisses after a successful send. `/btw:summarize` now summarizes the extracted sub-session exchanges instead of the persisted pending-thread array, then uses the same success/failure lifecycle. Failed inject/summarize attempts preserve the sub-session for retry.

In `tests/btw.runtime.test.ts`, I updated the success-path assertions to mutate `subSessionRecords[0].session.state.messages` directly before handoff. That makes the sub-session history intentionally diverge from `pendingThread[]`, so the tests now prove that inject and summarize read from the active sub-session state rather than the persisted manual thread snapshot. The tests also assert that successful handoff disposes the active BTW sub-session.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts -t "/btw:inject success extracts the active sub-session thread, disposes it, dismisses the overlay, and reopens fresh|/btw:summarize success summarizes the active sub-session thread, disposes it, dismisses the overlay, and reopens fresh|summarize failure preserves BTW thread state and keeps the overlay recoverable|routes non-BTW slash input in the modal through the BTW sub-session prompt without fallback warnings"`
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"`

Also checked:
- `lsp diagnostics` for `extensions/btw.ts` and `tests/btw.runtime.test.ts` could not run because no language server is configured in this repo

Not run in this task unit:
- Manual slice verification (`open BTW, run a slash command, inject content to main session, type in main while BTW runs`)

## Diagnostics

- `extensions/btw.ts` now exposes the handoff boundary through `BtwSessionRuntime.sideThreadStartIndex`; if inject/summarize start leaking main-session context, inspect that value first
- `extractBtwHandoffThread()` is the formatter boundary that strips the continuation marker pair and groups `session.state.messages` into user/assistant exchanges
- `tests/btw.runtime.test.ts` now proves the extraction seam by mutating `subSessionRecords[n].session.state.messages` before handoff and asserting the injected/summarized payload uses the mutated sub-session state
- Overlay status text now reports inject progress (`⏳ injecting into the main session...`) and still preserves retry-safe summarize failures (`Summarize failed. Thread preserved for retry or injection.`)

## Deviations

- The referenced task plan file `.gsd/milestones/M002/slices/S03/tasks/T02-PLAN.md` did not exist, so execution followed `.gsd/milestones/M002/slices/S03/S03-PLAN.md`
- I kept a narrow fallback from handoff extraction to `pendingThread[]` only when no active/recreatable sub-session is available, to avoid regressing inject behavior in edge cases where the persisted thread exists but a session cannot be reconstructed

## Known Issues

- Manual live-pi verification for the slice is still outstanding
- T03 remains open; parallel execution proof is not closed by this task

## Files Created/Modified

- `extensions/btw.ts` — recorded the sub-session side-thread boundary, extracted handoff turns from `session.state.messages`, and retargeted inject/summarize to that extracted conversation
- `tests/btw.runtime.test.ts` — proved inject/summarize use sub-session history by mutating `session.state.messages` and asserting active-session disposal on successful handoff
- `.gsd/milestones/M002/slices/S03/S03-PLAN.md` — marked T02 complete
- `.gsd/DECISIONS.md` — recorded D021 for the new handoff extraction boundary
- `.gsd/STATE.md` — advanced the active next action to T03
- `.gsd/milestones/M002/slices/S03/tasks/T02-SUMMARY.md` — captured the shipped behavior, diagnostics, verification, and resume state
