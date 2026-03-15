---
id: T01
parent: S03
milestone: M002
provides:
  - BTW overlay slash input now routes through the sub-session prompt unless the command is BTW-owned lifecycle or handoff control
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S03/S03-PLAN.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
key_decisions:
  - D020: intercept only BTW-owned lifecycle/handoff slash commands in the overlay and route every other slash input through the BTW sub-session prompt
patterns_established:
  - Narrow overlay-owned slash interception to BTW lifecycle/handoff commands; let all other slash-prefixed input reuse the ordinary BTW prompt path and surface real session errors instead of modal-local fallback warnings
observability_surfaces:
  - BTW overlay status text plus `BtwOverlayComponent.getTranscriptEntries()` assertions in `tests/btw.runtime.test.ts`
duration: 1h
verification_result: passed
completed_at: 2026-03-15T18:57:01Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T01: Route slash commands through sub-session prompt

**BTW now stops rejecting unknown modal slash input locally and instead routes it through the real sub-session prompt unless the command owns BTW lifecycle or handoff behavior.**

## What Happened

I started by fixing the slice-plan observability gap in `.gsd/milestones/M002/slices/S03/S03-PLAN.md`: the slice now has an explicit `## Observability / Diagnostics` section plus a failure-path verification command tied to inspectable overlay/transcript state.

In `extensions/btw.ts`, I replaced the old modal slash gate with a narrower BTW-only interceptor. `submitFromOverlay()` now intercepts only `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize`. Everything else — including slash-prefixed input like `/plan ...` — falls through the normal BTW request path, which reaches the real sub-session via `session.prompt(...)`. The M001 unsupported-slash warning path was removed.

In `tests/btw.runtime.test.ts`, I replaced the old unsupported-slash expectation with a direct runtime proof that non-BTW slash input is sent to the fake sub-session prompt, persisted as a normal BTW turn, and does not emit the old fallback warning. I kept the existing in-modal `/btw:new`, `/btw:tangent`, and `/btw:inject` assertions as proof that BTW-owned commands are still intercepted and retain their command semantics.

The dispatch-referenced task plan file `.gsd/milestones/M002/slices/S03/tasks/T01-PLAN.md` was absent, so I used `.gsd/milestones/M002/slices/S03/S03-PLAN.md` as the execution contract. `.gsd/STATE.md` was also absent in this worktree, so I recreated it with the current milestone/slice/task state after verification.

## Verification

- `npm test -- tests/btw.runtime.test.ts -t "routes non-BTW slash input in the modal through the BTW sub-session prompt without fallback warnings|in-modal /btw:new reuses command semantics by resetting the thread and reopening contextual mode|in-modal /btw:tangent reuses command semantics by switching modes and dropping inherited main-session context|in-modal /btw:inject reuses command semantics by handing off to the main session and dismissing the overlay"`
  - passed; proves non-BTW slash input routes to `prompt()` while BTW-owned overlay commands still bypass that path and keep their semantics
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"`
  - passed; proves the inspectable failure-path signals required by the slice plan still hold after the slash-routing change
- `npm test -- tests/btw.runtime.test.ts`
  - passed; the full automated S03 runtime suite is green in this task unit
- Manual slice verification (`open BTW, run a slash command, inject to main session, type in main while BTW runs`) not run in this task unit

## Diagnostics

- `extensions/btw.ts` now uses `parseOverlayBtwCommand()` as the overlay-owned command boundary; this is the first seam to inspect if modal slash behavior regresses
- `tests/btw.runtime.test.ts` exposes the relevant proof surfaces:
  - `subSessionRecords[n].session.prompt` for the actual prompt calls
  - `subSessionRecords[n].promptCalls` for the exact text/context sent to the sub-session
  - `overlay.statusText.text` for user-visible dispatch/failure state
  - `overlay.getTranscriptEntries()` / `transcriptText(...)` for persisted turn visibility after slash routing
- The slice plan now explicitly documents that non-BTW slash input should surface real session failures, not a synthetic unsupported-slash warning

## Deviations

- The referenced task plan file `.gsd/milestones/M002/slices/S03/tasks/T01-PLAN.md` did not exist, so execution followed `.gsd/milestones/M002/slices/S03/S03-PLAN.md`
- `.gsd/STATE.md` did not exist in this branch, so I recreated it while closing the task

## Known Issues

- Manual live-pi verification for the slice is still outstanding
- T02 and T03 remain open in plan bookkeeping even though the current automated slice suite is already green

## Files Created/Modified

- `extensions/btw.ts` — removed the modal unsupported-slash fallback and narrowed overlay slash interception to BTW-owned lifecycle/handoff commands
- `tests/btw.runtime.test.ts` — replaced the old unsupported-slash fallback test with a direct proof that non-BTW slash input hits the sub-session prompt path
- `.gsd/milestones/M002/slices/S03/S03-PLAN.md` — added observability/failure-path expectations and marked T01 complete
- `.gsd/DECISIONS.md` — recorded the new overlay slash-dispatch boundary as D020
- `.gsd/STATE.md` — recreated project state and pointed next work at S03/T02
- `.gsd/milestones/M002/slices/S03/tasks/T01-SUMMARY.md` — recorded shipped behavior, verification, diagnostics, and follow-up state
