---
id: T03
parent: S01
milestone: M002
provides:
  - Explicit runtime proof that contextual BTW sub-sessions seed main-session messages while tangent mode recreates a clean sub-session without inherited context
key_files:
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/slices/S01/S01-PLAN.md
key_decisions:
  - No production-path rewrite was needed in T03 because the mode-aware seeding and mode-switch disposal logic already existed; this task locked that contract with direct assertions and live verification
patterns_established:
  - Verify BTW mode semantics through sub-session inspection (`subSessionRecords[n].seedMessages`, session replacement/dispose assertions) instead of inferring only from streamed answer text
observability_surfaces:
  - tests/btw.runtime.test.ts exposes `subSessionRecords[n].seedMessages`, prompt calls, listener counts, and dispose/abort spies; live PTY output shows BTW overlay tool rows and status lines
duration: 34m
verification_result: passed
completed_at: 2026-03-15 11:12 PDT
blocker_discovered: false
---

# T03: Mode handling and sub-session context

**Added direct runtime coverage proving that contextual BTW sub-sessions inherit main-session messages, tangent sessions restart clean, and the live overlay still shows real tool execution.**

## What Happened

`extensions/btw.ts` already had the T03 behavior wired in: contextual mode seeds the sub-session from `buildMainMessages(...)`, tangent mode starts clean, and mode switches dispose/recreate the sub-session. Instead of churning working runtime code, I tightened the executable contract in `tests/btw.runtime.test.ts` with two direct assertions:

- contextual BTW seeding includes main-session user/assistant messages but excludes visible `btw-note` messages
- switching from `/btw` to `/btw:tangent` disposes the old sub-session, creates a new one, and seeds it without inherited main-session context

I then reran the slice tests and did a live PTY-driven `gsd --no-extensions -e ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session` check that exercised `/btw ...` in the real TUI. The overlay surfaced the `Tool` section plus `→ read {"path":"package.json"}` / `✓ read`, and the assistant answered with ``pi-btw``.

## Verification

- `npm test -- tests/btw.runtime.test.ts` ✅ (`27 passed`)
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure"` ✅
- Live PTY check via a Python `pty.openpty()` harness running:
  - `gsd --no-extensions -e ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session`
  - submitted `/btw what is the package.json name field? Use the read tool and answer briefly.`
  - observed BTW overlay output containing:
    - `Tool`
    - `→ read {"path":"package.json"}`
    - `✓ read`
    - final assistant answer ``pi-btw``

## Diagnostics

- Inspect contextual/tangent seed state in `tests/btw.runtime.test.ts` through `subSessionRecords[n].seedMessages`
- Inspect mode-switch lifecycle through `subSessionRecords[n].session.abort`, `.dispose`, and listener-count helpers
- Inspect prompt payload composition through `subSessionRecords[n].promptCalls`
- Reproduce live overlay/tool activity with a PTY-backed `gsd` launch and a `/btw` prompt that forces a tool call

## Deviations

- `.gsd/milestones/M002/slices/S01/tasks/T03-PLAN.md` was not present at execution time, so I executed against the authoritative slice plan in `S01-PLAN.md` plus the current runtime/test surfaces

## Known Issues

- None

## Files Created/Modified

- `tests/btw.runtime.test.ts` — added direct T03 assertions for contextual seed inheritance and tangent sub-session recreation/clean seeding
- `.gsd/milestones/M002/slices/S01/tasks/T03-SUMMARY.md` — recorded implementation, verification, and diagnostics for T03
- `.gsd/milestones/M002/slices/S01/S01-PLAN.md` — marked T03 complete
