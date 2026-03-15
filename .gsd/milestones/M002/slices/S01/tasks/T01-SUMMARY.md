---
id: T01
parent: S01
milestone: M002
provides:
  - BTW now opens and prompts through a real in-memory AgentSession sub-session with coding tools and event-stream bridging
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
key_decisions:
  - D015: bootstrap BTW sub-sessions with a zero-extension ResourceLoader plus seeded conversation state
patterns_established:
  - Create the BTW sub-session once per mode/thread shape, preload contextual/tangent history with session.agent.replaceMessages(...), and bridge session.subscribe() events into simplified overlay transcript state
observability_surfaces:
  - session.subscribe() message/tool events reflected in overlay transcript/status, plus failure-path assertions in tests/btw.runtime.test.ts
duration: 2h
verification_result: passed
completed_at: 2026-03-15T17:56:33Z
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T01: Create sub-session helper and wire into BTW open

**BTW now creates a real in-memory AgentSession, seeds it with contextual/tangent history, and routes `/btw` prompts through `session.prompt()` with overlay event bridging.**

## What Happened

I replaced BTW's manual `streamSimple()` request path in `extensions/btw.ts` with a real sub-session helper built on `createAgentSession()` + `SessionManager.inMemory()`. The helper reuses the main session model/modelRegistry, activates `codingTools`, skips extension binding by using a zero-extension resource loader, and appends the BTW role prompt into the sub-session system prompt.

For contextual mode, BTW now preloads main-session messages plus hidden BTW thread history into the sub-session via `session.agent.replaceMessages(...)`. Tangent mode seeds only BTW thread history. `runBtw()` now subscribes to `session.subscribe()` and bridges `message_*` and `tool_execution_*` events into the existing simplified `BtwSlot` overlay model so the modal shows assistant streaming plus lightweight tool activity.

I also kept BTW command semantics aligned with the existing README/runtime contract: `/btw`, `/btw:new`, and `/btw:tangent` now open a real sub-session even when launched without immediately sending a question, and thread restore/reset flows rebuild the sub-session from hidden BTW entries instead of reconstructing ad hoc LLM context per turn.

The task-specific plan file referenced by dispatch (`.gsd/milestones/M002/slices/S01/tasks/T01-PLAN.md`) did not exist, so I used `S01-PLAN.md` as the authoritative execution contract and fixed its missing failure-path verification step before implementation.

## Verification

- `npm test -- tests/btw.runtime.test.ts`
  - passes with updated assertions for sub-session creation, in-memory session manager use, coding tool activation, BTW system prompt injection, prompt routing through `session.prompt()`, contextual/tangent seeding, and existing BTW modal/thread behavior
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure"`
  - passes and verifies inspectable failure status/notification state plus post-failure recovery in the same overlay
- Manual slice verification (`open BTW in live pi, verify tool execution appears in the overlay`) not run in this task unit

## Diagnostics

- Runtime inspection surface: the BTW sub-session is bridged from `session.subscribe()` into overlay state via `message_start`, `message_update`, `message_end`, `tool_execution_start`, and `tool_execution_end`
- User-visible failure surface: overlay status text shows request/tool state and request failures; failed prompt errors are also surfaced through UI notifications
- Test inspection surface: `tests/btw.runtime.test.ts` now records sub-session creation options, seeded messages, and prompt calls through the fake AgentSession harness

## Deviations

- The referenced task-specific plan file was absent, so execution followed `.gsd/milestones/M002/slices/S01/S01-PLAN.md`
- I added the missing slice-level diagnostic verification step to `S01-PLAN.md` before implementation, per the pre-flight instruction

## Known Issues

- Escape-triggered sub-session abort/dispose is not finished here; that lifecycle hardening remains in T02
- Manual live-pi verification of tool activity in the BTW overlay is still outstanding for the slice

## Files Created/Modified

- `.gsd/milestones/M002/slices/S01/S01-PLAN.md` — added the missing failure-path verification step and marked T01 complete
- `.gsd/DECISIONS.md` — recorded the BTW sub-session bootstrap pattern for downstream slice work
- `extensions/btw.ts` — replaced manual BTW streaming with a real AgentSession sub-session, seeded context/history, and event-stream overlay bridging
- `tests/btw.runtime.test.ts` — replaced the stream mock harness with a fake AgentSession harness and added T01-specific creation/failure-path assertions
- `.gsd/milestones/M002/slices/S01/tasks/T01-SUMMARY.md` — recorded shipped behavior, verification, diagnostics, and remaining gaps
