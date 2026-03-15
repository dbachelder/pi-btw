---
id: S04
parent: M002
milestone: M002
provides:
  - Hardens the BTW sub-session contract with runtime assertions for lifecycle, transcript rendering, slash routing, handoff, failure recovery, and dead-plumbing cleanup
requires:
  - slice: S01
    provides: Real in-memory BTW `AgentSession` creation, disposal, and prompt/subscribe lifecycle
  - slice: S02
    provides: Event-driven BTW transcript mapping and overlay refresh from `AgentSessionEvent`s
  - slice: S03
    provides: Slash routing through `prompt()`, sub-session-based handoff extraction, and parallel execution behavior
affects:
  - none
key_files:
  - tests/btw.runtime.test.ts
  - extensions/btw.ts
  - README.md
  - .gsd/REQUIREMENTS.md
  - .gsd/milestones/M002/M002-ROADMAP.md
key_decisions:
  - Keep BTW summarize on the `createAgentSession()` seam by generating summaries through a short-lived in-memory AgentSession instead of a direct completion helper
  - Prove S04 behavior by extending the existing AgentSession harness and inspectable overlay/transcript surfaces instead of adding production-only diagnostics
patterns_established:
  - Treat `subSessionRecords`, `overlay.statusText.text`, and `BtwOverlayComponent.getTranscriptEntries()` as the authoritative BTW contract surfaces
  - Keep BTW runtime paths on `AgentSession` primitives only; remove legacy M001 helper paths once parity is proven
observability_surfaces:
  - `tests/btw.runtime.test.ts` `subSessionRecords` / `promptCalls` / `getIsStreaming()` / `getListenerCount()`
  - `BtwOverlayComponent.getTranscriptEntries()`
  - overlay status text in `extensions/btw.ts`
drill_down_paths:
  - .gsd/milestones/M002/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S04/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S04/tasks/T03-SUMMARY.md
duration: 3h09m
verification_result: passed
completed_at: 2026-03-15 12:45:00 PDT
---

# S04: Contract hardening and cleanup

**BTW now ships with a hardened AgentSession-first runtime contract, dead M001 plumbing removed, updated docs, and an executable proof suite that covers lifecycle, transcript, slash routing, handoff, failure recovery, and parallel behavior.**

## What Happened

S04 finished as a cleanup-and-proof slice, not a large new architecture slice. T01 confirmed the existing BTW runtime harness was already on the right seam: `createAgentSessionMock`, in-memory session records, overlay status, and transcript inspection were already sufficient to prove sub-session lifecycle and mode semantics. The slice plan was tightened with explicit observability and failure-path expectations instead of adding ad hoc diagnostics.

T02 expanded the contract suite where proof was still thin. `tests/btw.runtime.test.ts` now has named assertions for incremental assistant streaming, routed slash-command failure recovery, `/btw:inject` on an empty ready sub-session, and `/btw:clear` during active tool execution. The slice stayed on the existing fake AgentSession harness and proved behavior through real BTW command/overlay entrypoints plus inspectable runtime state.

T03 removed the last M001-era runtime leftovers. `extensions/btw.ts` no longer relies on `completeSimple`, summarize now runs through a short-lived in-memory AgentSession, contextual seed-message building no longer depends on the old helper surface, and the README now describes BTW as a real tool-enabled sub-session with native slash routing. The cleanup verification grep is now clean.

At the slice level, the roadmap, project state, and requirements ledger were updated to reflect completion. Requirement bookkeeping was also corrected for R013: the old unsupported-slash fallback proof is no longer the right story because full slash parity shipped and the fallback plumbing was intentionally removed.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state|summarize failure preserves BTW thread state and keeps the overlay recoverable"`
- `npm test`
- `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts`

Observability surfaces confirmed:
- `tests/btw.runtime.test.ts` exposes `subSessionRecords`, `promptCalls`, `getIsStreaming()`, and `getListenerCount()` for lifecycle/disposal proof
- `BtwOverlayComponent.getTranscriptEntries()` remains the inspectable surface for streaming/tool/failure transcript state
- overlay status text remains the first-line runtime signal for prompt, tool, handoff, and failure recovery state

Live-runtime note:
- a PTY-backed `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session` smoke run successfully exercised a live BTW ask and an in-modal slash reset/reprompt path
- full live handoff/dismiss confirmation remained less inspectable under terminal automation than the runtime harness; those behaviors remain covered by named runtime assertions rather than an end-to-end captured marker

## Requirements Advanced

- R001 — S04 hardened the executable proof for real continued side-chat behavior by keeping multi-turn BTW state, failure recovery, and transcript inspection on the sub-session contract surface.
- R002 — S04 reinforced the lightweight/disposable contract by rechecking in-memory session replacement, clear-time abort/dispose behavior, summarize-session disposal, and removal of dead legacy plumbing.
- R004 — S04 preserved the modal-owned input path by proving overlay-submitted prompts and BTW-owned slash commands still flow through the BTW surface instead of bouncing back to main-session plumbing.

## Requirements Validated

- R015 — revalidated by the final S04 runtime suite and cleanup work: overlay slash input stays on the AgentSession `prompt()` path for non-BTW commands, with no fallback warning path left behind.
- R020 — revalidated by the final suite and shipped runtime: BTW still creates coding-tool-enabled sub-sessions while S04 removes only dead legacy plumbing, not tool access.
- R021 — revalidated by the final suite: BTW prompt submission remains fire-and-forget and independent from main-session idle/streaming state.
- R022 — revalidated by transcript-inspection assertions and the retained event-native transcript mapping.
- R023 — revalidated by disposal/reset assertions and summarize-session cleanup on `SessionManager.inMemory()`.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- R013 — proof text was re-scoped. The old unsupported-slash fallback warning is no longer the relevant contract because full slash parity shipped and S04 intentionally removed the fallback plumbing.

## Deviations

- The per-task `T01-PLAN.md`, `T02-PLAN.md`, and `T03-PLAN.md` files referenced by the dispatch were not present locally, so the slice used `.gsd/milestones/M002/slices/S04/S04-PLAN.md` as the authoritative contract.
- Live verification used PTY-backed terminal automation instead of a full human-driven interactive session because non-TTY automation cannot run interactive GSD directly and local macOS accessibility/screen-recording permissions were unavailable.

## Known Limitations

- End-to-end terminal automation is a weak proof surface for handoff notifications after `/btw:inject` because the command intentionally crosses into main-session work; the authoritative proof for inject/summarize/clear/dismiss remains the named runtime assertions in `tests/btw.runtime.test.ts`.
- R002 is still only mapped, not newly validated, because S04 strengthened the lightweight/disposable evidence but did not add a direct startup-latency benchmark.

## Follow-ups

- If future work needs stronger operational proof than the current runtime suite, add a purpose-built live harness for interactive BTW flows that can capture post-handoff main-session state without relying on brittle terminal scraping.

## Files Created/Modified

- `tests/btw.runtime.test.ts` — hardened the sub-session contract suite with incremental streaming, slash-failure recovery, empty-thread injection, clear-during-tool disposal, and summarize-session assertions.
- `extensions/btw.ts` — removed the last legacy completion path and kept summarize on a short-lived AgentSession path.
- `README.md` — updated BTW documentation to describe the shipped sub-session, tool, and slash-routing behavior.
- `.gsd/REQUIREMENTS.md` — corrected R013’s proof story to reflect shipped slash parity and removed fallback plumbing.
- `.gsd/milestones/M002/M002-ROADMAP.md` — marked S04 complete.
- `.gsd/PROJECT.md` — updated project and milestone state to reflect M002 completion.
- `.gsd/STATE.md` — recorded milestone completion and next-action state.

## Forward Intelligence

### What the next slice should know
- The strongest BTW proof surface is not screenshots or terminal scraping; it is the combination of `subSessionRecords`, transcript-entry inspection, and overlay status in `tests/btw.runtime.test.ts`.
- BTW summarize is now on the same `AgentSession` seam as the main side-session. If future work touches summarization, update the AgentSession harness rather than reintroducing a separate completion helper.

### What's fragile
- PTY automation around interactive GSD flows — post-handoff output is difficult to detect reliably because successful `/btw:inject` intentionally transfers control back to main-session work rather than emitting one stable terminal marker.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` — it directly inspects the fake sub-session lifecycle, message history, transcript entries, and failure state without the ambiguity of terminal rendering.
- `BtwOverlayComponent.getTranscriptEntries()` — it is the truth surface for tool-call/result rendering, streaming text, and preserved recoverable failure state.

### What assumptions changed
- “S04 needs new runtime hooks to prove the sub-session contract” — false; the existing AgentSession harness already exposed enough state, and the work was to extend assertions and remove dead paths.
- “Graceful slash degradation still needs a fallback warning path” — false in the shipped M002 runtime; full slash parity landed cleanly, so S04 removed the fallback plumbing instead.
