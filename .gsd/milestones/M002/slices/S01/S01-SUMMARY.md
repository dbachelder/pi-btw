---
id: S01
parent: M002
milestone: M002
provides:
  - BTW now opens a real in-memory AgentSession sub-session with coding tools, mode-aware seed context, and clean abort/dispose lifecycle
requires: []
affects:
  - S02
  - S03
  - S04
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/REQUIREMENTS.md
  - .gsd/PROJECT.md
  - .gsd/STATE.md
key_decisions:
  - D015: bootstrap BTW sub-sessions with a zero-extension ResourceLoader plus seeded conversation state
  - D016: make the BTW session runtime own event unsubscription and awaited abort/dispose during reset and replacement
patterns_established:
  - Create one BTW sub-session per active mode/thread shape, seed it from contextual or tangent history, bridge session events into the existing simplified overlay transcript, and always tear it down through a single awaited dispose helper before replacement
observability_surfaces:
  - tests/btw.runtime.test.ts sub-session inspection (`seedMessages`, prompt calls, listener counts, abort/dispose spies)
  - live PTY-backed `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session` overlay run showing tool rows and assistant output
  - BTW overlay status line driven from `session.subscribe()` message/tool events
drill_down_paths:
  - .gsd/milestones/M002/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T03-SUMMARY.md
duration: 3h 19m
verification_result: passed
completed_at: 2026-03-15T11:18:00-07:00
---

# S01: Sub-session lifecycle and agent loop

**BTW now runs through a real disposable AgentSession with coding tools, contextual/tangent seeding, and leak-free Escape/clear teardown while the overlay still uses a simplified text bridge.**

## What Happened

This slice retired BTW's manual `streamSimple()` / `completeSimple()` plumbing and replaced it with a real in-memory sub-session created via `createAgentSession()` plus `SessionManager.inMemory()`. The new helper in `extensions/btw.ts` reuses the main session's model and model registry, activates `codingTools`, skips extension binding with a zero-extension resource loader, and appends a BTW-specific side-agent prompt.

Context handling moved into the sub-session bootstrap path. Contextual BTW now seeds the sub-session from main-session messages plus hidden BTW thread history, while tangent BTW recreates a clean sub-session without inherited main-session context. Prompt submission now goes through `session.prompt(question)`, and `session.subscribe()` events are bridged back into the existing `BtwSlot` overlay state so the modal can still show streamed assistant text and lightweight tool activity until S02 replaces the bridge with a full event transcript.

Lifecycle cleanup was hardened around one awaited dispose path. Escape, `/btw:clear`, `/btw:new`, restore/shutdown replacement flows, and mode switches all clear event listeners, abort in-flight work, dispose the live `AgentSession`, and null the runtime before any replacement session is created. The runtime test harness was upgraded to expose seeded messages, prompt calls, listener counts, and abort/dispose state so the sub-session contract is asserted directly instead of inferred from text alone.

## Verification

- `npm test -- tests/btw.runtime.test.ts` ✅ (`27 passed`)
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure"` ✅
- Live PTY runtime check ✅
  - Command: `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session`
  - Submitted: `/btw what is the package.json name field? Use the read tool and answer briefly.`
  - Observed in the BTW overlay: `Tool`, `→ read {"path":"package.json"}`, `✓ read`, and final assistant answer `pi-btw`
- Observability/diagnostics confirmed through runtime assertions and live overlay output:
  - sub-session creation options and seed messages
  - prompt routing through `AgentSession.prompt()`
  - listener cleanup after Escape/clear/replacement
  - failure-path overlay recoverability after an agent prompt error

## Requirements Advanced

- R002 — BTW now opens on a real sub-session path and passed a live runtime smoke check without obvious sluggishness, but the startup-speed target is still only spot-checked, not hard-measured.
- R015 — BTW input now routes through `AgentSession.prompt()`, establishing the real dispatch path future slash-command parity will rely on.
- R021 — BTW now runs on an independent AgentSession lifecycle, which is the prerequisite for later explicit parallel-execution proof.

## Requirements Validated

- R020 — BTW now has proven `read`, `bash`, `edit`, and `write` tool access through the real agent loop, with both runtime assertions and a live overlay tool-call check.
- R023 — BTW sub-sessions are now proven ephemeral via `SessionManager.inMemory()` creation plus abort/dispose assertions on Escape, clear, and replacement flows.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- The task-specific plan files referenced by dispatch for T01-T03 were absent, so execution followed the authoritative slice plan in `.gsd/milestones/M002/slices/S01/S01-PLAN.md`.
- No production-path rewrite was needed in T03 because the mode-aware seeding and recreation behavior already existed after T01/T02; T03 closed the contract by adding direct assertions and live verification instead.

## Known Limitations

- The BTW overlay still renders through the legacy simplified `BtwSlot` bridge rather than a full tool-call/result event transcript. Rich transcript rendering remains for S02.
- Slash-command parity inside BTW is not complete yet because the sub-session still skips extension binding. S03 owns that dispatch work.
- Parallel execution against an actively streaming main session has not been explicitly proven yet. S03 still needs to validate that contract.
- Startup speed is operationally acceptable in spot checks, but the `<200ms overhead` target is not instrumented.

## Follow-ups

- Replace the temporary `BtwSlot` event bridge with transcript entries built directly from `AgentSession` events in S02.
- Route BTW slash input through the sub-session command path and validate explicit handoff plus parallel main-session execution in S03.
- Harden runtime coverage around the new transcript and slash/handoff contracts in S04.

## Files Created/Modified

- `extensions/btw.ts` — replaced manual BTW streaming with real sub-session creation, prompt routing, mode-aware seeding, event bridging, and centralized teardown
- `tests/btw.runtime.test.ts` — upgraded the harness to fake real sub-sessions and assert creation, seeding, failure recovery, and leak-free cleanup
- `.gsd/REQUIREMENTS.md` — marked the tool-access and ephemeral-session requirements validated and corrected requirement counts
- `.gsd/PROJECT.md` — refreshed project state to reflect the shipped M002/S01 sub-session runtime
- `.gsd/STATE.md` — advanced project state from S01 completion toward S02

## Forward Intelligence

### What the next slice should know
- `session.subscribe()` already gives enough signal to build the richer overlay transcript in S02; the current bridge is intentionally thin and should be replaced, not extended much further.
- The live verification path in this environment worked reliably with `--extension ./extensions/btw.ts`; using `-e` did not reliably surface the BTW command during PTY testing.
- `tests/btw.runtime.test.ts` already exposes the useful sub-session inspection hooks (`seedMessages`, listener counts, prompt calls, abort/dispose spies), so downstream slices should extend that harness instead of inventing a second one.

### What's fragile
- The simplified overlay transcript bridge in `extensions/btw.ts` — it compresses rich agent events into text-only slots, so layering more rendering behavior on top of it will create avoidable churn before S02.
- Session replacement ordering — cleanup currently depends on awaiting the shared dispose helper before constructing a replacement runtime; skipping that order risks overlapping listeners and stale status text.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` sub-session records — this is the most trustworthy place to inspect seeded context, prompt routing, and lifecycle cleanup without guessing from prose output.
- The live PTY-backed `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session` run — this is the quickest truthful operational check for whether tool activity is actually visible in the BTW overlay.

### What assumptions changed
- "The slice still needs production changes for T03" — the runtime already had correct contextual/tangent seeding after T01/T02; the real missing work was direct proof, not more code churn.
- "`-e` is interchangeable with `--extension` for live BTW verification" — in this environment the long flag was the reliable way to load the BTW extension for PTY-driven checks.
