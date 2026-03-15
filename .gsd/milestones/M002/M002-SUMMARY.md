---
id: M002
provides:
  - BTW now runs as a real disposable AgentSession sub-session with coding tools, native slash routing, event-native overlay transcript rendering, explicit handoff, and proven parallel execution beside the main session
key_decisions:
  - Keep BTW on AgentSession seams end-to-end, including summarize via a short-lived in-memory AgentSession instead of direct completion helpers
  - Prove transcript, slash, handoff, lifecycle, and parallelism through the existing AgentSession runtime harness and inspectable overlay surfaces rather than production-only diagnostics
patterns_established:
  - Split BTW into an overlay-owned UI contract and a disposable AgentSession runtime, joined by event-native transcript mapping and explicit handoff extraction from sub-session history
observability_surfaces:
  - `tests/btw.runtime.test.ts` `subSessionRecords`, `promptCalls`, `getIsStreaming()`, `getListenerCount()`, and transcript assertions
  - `BtwOverlayComponent.getTranscriptEntries()`
  - overlay status text in `extensions/btw.ts`
  - live PTY-backed `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session` smoke checks
requirement_outcomes:
  - id: R020
    from_status: active
    to_status: validated
    proof: Proven in `tests/btw.runtime.test.ts` by asserting BTW creates a coding-tool-enabled sub-session and routes prompts through `AgentSession.prompt()`, then rechecked operationally by a live PTY run that showed `read` tool activity and the final answer in the overlay.
  - id: R023
    from_status: active
    to_status: validated
    proof: Proven in `tests/btw.runtime.test.ts` by asserting BTW uses `SessionManager.inMemory()` and aborts/disposes listeners and sessions on Escape, clear, and replacement flows.
  - id: R022
    from_status: active
    to_status: validated
    proof: Proven by `tests/btw.runtime.test.ts` transcript-inspection and render-layer assertions covering tool calls/results, thinking, assistant streaming, and preserved failure state.
  - id: R015
    from_status: active
    to_status: validated
    proof: Proven in `tests/btw.runtime.test.ts` by asserting non-BTW slash input routes through the BTW sub-session `prompt()` path while BTW-owned lifecycle and handoff commands retain their documented interception semantics.
  - id: R021
    from_status: active
    to_status: validated
    proof: Proven in `tests/btw.runtime.test.ts` by asserting BTW submit is fire-and-forget, the sub-session remains streaming, and simulated main-session input proceeds independently before BTW completes.
duration: 11h13m
verification_result: passed
completed_at: 2026-03-15T13:01:11-07:00
---

# M002: BTW sub-session

**BTW is now a real disposable side-agent: it runs on its own in-memory AgentSession with coding tools, native slash-command dispatch, a full overlay transcript, explicit handoff back to main, and runtime proof that it can work in parallel with the main session.**

## What Happened

M002 replaced BTW’s remaining manual plumbing with a real AgentSession-first runtime.

S01 retired manual `streamSimple()`/`completeSimple()` behavior and introduced an in-memory BTW sub-session created through `createAgentSession()` plus `SessionManager.inMemory()`. BTW now reuses the main session’s model/model registry, enables `codingTools`, seeds contextual or tangent state into the sub-session, routes overlay input through `session.prompt()`, and tears the runtime down through a shared abort/dispose path.

S02 replaced the temporary text bridge with an event-native transcript. BTW now maps `AgentSessionEvent`s into typed transcript entries for tool calls, tool results, thinking, assistant streaming, failures, and turn boundaries; renders those entries as compact transcript blocks in the overlay; and attaches/detaches the session event listener with the overlay lifecycle so hidden/disposed sessions cannot keep mutating state.

S03 finished the BTW/main boundary. Overlay input now intercepts only BTW-owned lifecycle and handoff commands; all other slash-prefixed input routes through the sub-session `prompt()` path. Inject and summarize now derive payloads from real sub-session history past a recorded BTW side-thread boundary, and the runtime harness proves BTW can keep streaming while the main session still accepts input.

S04 hardened the contract and removed dead M001 leftovers. The runtime suite now covers incremental streaming, slash failure recovery, empty-thread injection, clear-during-tool disposal, summarize on the AgentSession seam, and preserved recoverability after failures. The last legacy completion path was removed, README/docs were updated to match the shipped behavior, and milestone closure also backfilled the missing `S02-SUMMARY.md` so all slice summaries now exist.

## Cross-Slice Verification

### Success criteria

- **User can open BTW, ask it to read a file, and see the tool call and result rendered in the overlay transcript** — met.
  - Evidence: S01’s live PTY-backed run of `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session` showed `Tool`, `→ read {"path":"package.json"}`, `✓ read`, and the final assistant answer `pi-btw` in the BTW overlay.
  - Evidence: S02 transcript-inspection and render-layer tests prove tool calls/results are present in `BtwOverlayComponent.getTranscriptEntries()` and rendered in the overlay transcript.

- **User can type any slash command in the BTW overlay and have it execute through the sub-session’s own command dispatch** — met.
  - Evidence: S03 proved non-BTW slash-prefixed input routes through `btwSession.prompt(...)` with no modal-local unsupported-slash fallback, while BTW-owned lifecycle/handoff commands keep their explicit overlay interception semantics.
  - Evidence: `npm test -- tests/btw.runtime.test.ts` passes with the S03 slash-routing assertions included.

- **Main session continues accepting input and streaming while BTW is actively running tools in the overlay** — met.
  - Evidence: S03 added runtime proof that BTW submit is fire-and-forget, the BTW sub-session stays streaming, and simulated main-session input flips its own idle state independently before the BTW turn completes.
  - Evidence: current rerun `npm test -- tests/btw.runtime.test.ts` passed all 37 tests.

- **Dismissing BTW with Escape cleanly disposes the sub-session with no orphaned agent loops or leaked resources** — met.
  - Evidence: S01 and S02 runtime assertions prove Escape aborts/disposes the live sub-session, unsubscribes listeners, and ignores late events from disposed sessions.
  - Evidence: S04 retained and rechecked clear/dismiss/dispose coverage in the final runtime suite.

- **Inject/summarize still hand BTW content back to the main session explicitly** — met.
  - Evidence: S03 rewired inject/summarize to extract from sub-session history instead of `pendingThread[]`, and runtime tests cover empty-thread injection, summarize recovery, and preserved retry-safe state.
  - Evidence: S04 kept summarize on a short-lived AgentSession seam and revalidated failure recovery.

- **BTW opens fast enough that the sub-session creation overhead is not perceptible** — met only to the milestone’s existing proof bar, not through a benchmark.
  - Evidence: S01 reported live runtime spot checks with no obvious sluggishness, and later slices preserved the lightweight/disposable design without adding blocking coordination state.
  - Caveat: R002 remains active because the milestone still has operational evidence rather than a direct startup-latency benchmark.

### Definition of done

All milestone definition-of-done checks are now satisfied:

- real BTW `AgentSession` sub-session via `createAgentSession()` with `SessionManager.inMemory()` — proven in S01 and rechecked by the final runtime suite
- full coding tools through the agent loop — proven in S01 live/runtime verification
- overlay renders tool calls, tool results, and streaming assistant output from sub-session events — proven in S02 and rechecked in S03/S04
- slash commands typed in BTW route through `prompt()` — proven in S03 and revalidated in S04
- main session not blocked while BTW is open and active — proven in S03
- Escape disposes the sub-session cleanly — proven in S01/S02/S04
- inject/summarize extract from sub-session content and hand it to main explicitly — proven in S03/S04
- existing test harness updated to cover lifecycle, transcript, slash routing, handoff, and parallel execution — proven by the 37-test `tests/btw.runtime.test.ts` suite
- all slices are `[x]` and all slice summaries now exist — verified during closure after writing `.gsd/milestones/M002/slices/S02/S02-SUMMARY.md`

Current verification reruns:
- `npm test -- tests/btw.runtime.test.ts` ✅ (`37 passed`)
- `npm test` ✅ (`37 passed`)
- `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts` ✅ (no matches)

Unmet criteria: none.

## Requirement Changes

- R020: active → validated — runtime assertions prove BTW creates a coding-tool-enabled sub-session and a live PTY run showed `read` tool activity plus the final answer in the overlay.
- R023: active → validated — runtime assertions prove BTW uses `SessionManager.inMemory()` and disposes the live sub-session cleanly on Escape, clear, and replacement.
- R022: active → validated — transcript-inspection and render-layer assertions prove tool calls/results, thinking, assistant streaming, and failure state render in the overlay.
- R015: active → validated — non-BTW slash input now routes through the BTW sub-session `prompt()` path without modal-local fallback warnings.
- R021: active → validated — runtime proof shows BTW can keep streaming while the main session independently accepts input and changes idle state.

## Forward Intelligence

### What the next milestone should know
- The strongest BTW proof surface is the runtime harness, not terminal scraping: `subSessionRecords`, transcript inspection, overlay status text, and listener counts tell the truth faster than manual TTY observation.
- BTW summarize is now on the same AgentSession seam as the interactive side-session; future changes should extend that seam rather than reintroducing direct completion helpers.
- The modal slash boundary is stable: intercept only BTW-owned lifecycle/handoff commands locally and route every other slash-prefixed input through `prompt()`.

### What's fragile
- Handoff extraction depends on the recorded BTW side-thread boundary and internal resume-marker stripping — careless seed-message changes can leak main-session context back into inject/summarize payloads.
- Long wrapped tool-result formatting still depends on generic overlay line wrapping rather than a custom hanging-indent layout.
- PTY automation remains a weak proof surface for post-handoff UI behavior because successful inject/summarize intentionally cross back into main-session work.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` — it directly inspects lifecycle, streaming, slash routing, handoff, transcript rendering, and disposal state without ambiguity.
- `BtwOverlayComponent.getTranscriptEntries()` — it is the truth surface for what BTW believes the overlay transcript contains.
- overlay status text in `extensions/btw.ts` — it is the first-line runtime signal for prompt progress, handoff status, and recoverable failures.

### What assumptions changed
- “BTW needs manual stream/context plumbing to stay lightweight” — false; the disposable AgentSession path shipped cleanly and preserved the quick modal feel.
- “Full slash parity probably needs a modal-local fallback warning path” — false; the correct path was routing non-BTW slash input through the sub-session `prompt()` seam.
- “S04 needs new production diagnostics to prove the contract” — false; extending the existing AgentSession harness was sufficient.

## Files Created/Modified

- `.gsd/milestones/M002/M002-SUMMARY.md` — recorded milestone-level integrated verification, requirement transitions, and forward intelligence
- `.gsd/milestones/M002/slices/S02/S02-SUMMARY.md` — backfilled the missing S02 slice summary from completed task artifacts so all slice summaries now exist
- `.gsd/PROJECT.md` — updated current project state to reflect completed milestone documentation
- `.gsd/STATE.md` — recorded post-M002 completion state and next-action status
