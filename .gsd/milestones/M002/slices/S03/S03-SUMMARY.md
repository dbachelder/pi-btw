---
id: S03
parent: M002
milestone: M002
provides:
  - Slash input in the BTW overlay now routes through the real sub-session prompt, inject/summarize hand off from sub-session history, and runtime proof shows BTW can stream while the main session keeps accepting input
requires:
  - slice: S01
    provides: AgentSession-backed BTW sub-session lifecycle, prompt path, and access to sub-session message state
  - slice: S02
    provides: Event-driven BTW overlay transcript rendering and transcript inspection surfaces
affects:
  - S04
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - README.md
  - .gsd/REQUIREMENTS.md
  - .gsd/DECISIONS.md
patterns_established:
  - Intercept only BTW-owned lifecycle and handoff slash commands in the overlay; route every other slash-prefixed input through the BTW sub-session `prompt()` path
  - Record a BTW side-thread boundary in the sub-session and derive inject/summarize payloads from `session.state.messages` instead of manual pending-thread state
  - Prove cross-session parallelism in the runtime harness by asserting BTW streaming state and main-session idle/input state independently in the same test
key_decisions:
  - D020: overlay slash interception stops at BTW lifecycle and handoff commands
  - D021: BTW handoff payloads are extracted from sub-session history past a recorded side-thread boundary
  - Parallelism is proven in tests, not by adding production-only blocking state or diagnostics
observability_surfaces:
  - BTW overlay status text for slash dispatch, handoff progress, and retry-safe failures
  - `BtwOverlayComponent.getTranscriptEntries()` for inspectable streaming, tool, and failure-state assertions
  - `subSessionRecords[n].getIsStreaming()` plus simulated main-session idle/input state in `tests/btw.runtime.test.ts`
drill_down_paths:
  - .gsd/milestones/M002/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S03/tasks/T03-SUMMARY.md
duration: 2h50m
verification_result: passed
completed_at: 2026-03-15T19:15:00Z
---

# S03: Slash commands, handoff, and parallel execution

**BTW now routes modal slash input through the real sub-session, hands off inject/summarize content from sub-session history, and has runtime proof that side-session work does not block the main session.**

## What Happened

S03 finished the shift from BTW-specific overlay plumbing to real sub-session behavior.

In `extensions/btw.ts`, overlay submission now intercepts only BTW-owned lifecycle and handoff commands: `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize`. Every other slash-prefixed input now follows the ordinary BTW request path and reaches `btwSession.prompt(...)`. That removed the old modal-only unsupported-slash fallback and lets commands like `/help` execute through the sub-session instead of being rejected locally.

The slice also rewired handoff so `/btw:inject` and `/btw:summarize` no longer depend on M001-era `pendingThread[]` formatting. BTW now records where the real side thread starts inside the sub-session, extracts user/assistant turns from `session.state.messages`, strips the internal resume marker pair, and uses that extracted thread for inject and summarize. Successful handoff still clears and dismisses BTW; failed handoff preserves the sub-session for retry.

For parallelism, the production runtime did not need a code change. The important missing work was proof. `tests/btw.runtime.test.ts` now exercises a blocking BTW stream and an independent simulated main-session input path to prove the overlay submit is fire-and-forget, the BTW sub-session can still be actively streaming/tool-running, and the main session can accept new input and flip its own idle state while BTW is still in flight.

`README.md` was updated so the documented in-modal slash behavior matches the shipped runtime, and `.gsd/DECISIONS.md`, `.gsd/REQUIREMENTS.md`, `.gsd/PROJECT.md`, `.gsd/STATE.md`, and the M002 roadmap were advanced to reflect the completed slice.

## Verification

Passed:

- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"`
- `npm test -- tests/btw.runtime.test.ts -t "allows main-session input to proceed while the BTW sub-session is streaming|preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"`

Additional runtime check:

- `gsd --version`
- `timeout 5 gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session </dev/null`
  - confirms a clean `gsd` binary is present; interactive live UAT still requires a real TTY

## Requirements Advanced

- R002 — S03 kept BTW lightweight by routing slash input through the existing sub-session path and proving parallelism in the harness instead of adding heavier runtime coordination state.
- R007 — inject/summarize remain the only explicit BTW→main handoff paths, now backed by real sub-session history instead of manual pending-thread state.

## Requirements Validated

- R015 — full main-session slash parity inside BTW is now proven by routing non-BTW slash input through the sub-session `prompt()` path without modal-local fallback warnings.
- R021 — runtime tests now prove BTW can keep streaming while the main session independently accepts new input and changes idle state.
- R022 — the event-driven overlay transcript remains inspectable for streaming, tool activity, and failure state, and that surface was rechecked during S03 verification.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- The task-plan files referenced by dispatch for T01/T02/T03 were absent, so execution followed the slice plan plus the completed task summaries.
- Live interactive BTW UAT was not completed inside this unit because the available `gsd` invocation from automation has no TTY; the slice was closed on runtime harness proof plus a concrete UAT script.

## Known Limitations

- A clean human/live BTW run is still worth doing from a real terminal to validate feel and perceived responsiveness, especially the parallel “keep working in main while BTW runs” experience.
- S04 still needs to harden the runtime contract and remove any remaining dead M001-era plumbing.

## Follow-ups

- Run the S03 UAT script in a real terminal-backed `gsd` session and capture any UX issues around slash discoverability, status wording, or perceived concurrency.
- In S04, tighten the remaining contract assertions and delete obsolete compatibility code that is no longer needed after the sub-session migration.

## Files Created/Modified

- `extensions/btw.ts` — narrowed overlay slash interception to BTW-owned commands and rewired inject/summarize to extract from sub-session history.
- `tests/btw.runtime.test.ts` — added slash-routing, handoff, transcript-inspection, and parallel-execution runtime proof.
- `README.md` — updated in-modal slash behavior docs to match sub-session prompt routing.
- `.gsd/REQUIREMENTS.md` — marked R015, R021, and R022 validated and refreshed coverage counts.
- `.gsd/milestones/M002/M002-ROADMAP.md` — marked S03 complete.
- `.gsd/DECISIONS.md` — recorded the slash-boundary, handoff-boundary, and parallel-proof decisions.

## Forward Intelligence

### What the next slice should know
- The stable seam for modal slash behavior is `parseOverlayBtwCommand()` plus the generic submit path; if slash behavior regresses, inspect whether a command is being intercepted too early.
- The stable seam for handoff correctness is the recorded BTW side-thread boundary inside the sub-session. If inject/summarize start leaking main-session seed context, inspect that boundary before touching formatting.
- The runtime harness already has the observability needed for S04: transcript entries, overlay status text, and fake-session streaming state. Prefer extending those assertions over adding new debug-only hooks.

### What's fragile
- The handoff formatter is sensitive to internal resume markers and message ordering — small changes in how the sub-session is seeded can accidentally reintroduce main-session leakage.
- README and requirements drift is easy here because slash behavior changed materially during S03 — keep docs tied to the tested runtime contract.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` — it is the authoritative proof surface for slash routing, handoff extraction, transcript inspection, and concurrency.
- BTW overlay status text and `BtwOverlayComponent.getTranscriptEntries()` — these are the most trustworthy runtime-facing signals for tool work, failure state, and recoverability.

### What assumptions changed
- “Non-BTW slash input needs a modal-local unsupported fallback” — false; the real sub-session prompt path is the right dispatch surface.
- “Inject/summarize can keep formatting from `pendingThread[]`” — false; correctness now depends on the active sub-session history.
- “Parallel execution needs new production coordination state” — false; the runtime already behaved correctly and only needed explicit proof.
