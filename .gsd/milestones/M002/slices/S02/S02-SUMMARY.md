---
id: S02
parent: M002
milestone: M002
provides:
  - BTW now renders an event-native overlay transcript from AgentSession events, with overlay-scoped subscription lifecycle and inspectable tool/thinking/assistant rows
requires:
  - slice: S01
    provides: Real in-memory BTW AgentSession creation, prompt routing, and session event stream
affects:
  - S03
  - S04
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - .gsd/milestones/M002/M002-ROADMAP.md
  - .gsd/DECISIONS.md
  - .gsd/STATE.md
key_decisions:
  - D017: Treat `BtwTranscriptEntry[]` plus `getTranscriptEntries()` as the canonical inspectable BTW transcript surface
  - Render tool results as indented child blocks beneath tool-call rows instead of separate flat transcript rows
  - D019: Make the overlay/session lifecycle own BTW sub-session event subscription and discard hidden-session events by unsubscribing on close/dispose
patterns_established:
  - Build BTW transcript state directly from `session.subscribe()` agent events, render compact multi-line transcript blocks from typed entries, and scope the live event subscription to the visible overlay lifecycle
observability_surfaces:
  - `BtwOverlayComponent.getTranscriptEntries()`
  - `tests/btw.runtime.test.ts` transcript inspection and render-layer assertions
  - `subSessionRecords[*].getListenerCount()` plus fake-session `emit(...)` hooks for listener lifecycle proof
  - BTW overlay status text during tool execution, streaming, and failure recovery
duration: 1h55m
verification_result: passed
completed_at: 2026-03-15T11:50:06-07:00
---

# S02: Overlay transcript rendering from agent events

**BTW now shows a real mini-session transcript built from AgentSession events, including tool calls/results, thinking, assistant streaming, and overlay-scoped event subscription cleanup.**

## What Happened

S02 replaced the temporary S01 text bridge with an event-native transcript pipeline.

T01 introduced a typed `BtwTranscriptEntry` model and `BtwTranscriptState` runtime in `extensions/btw.ts`. Instead of mutating legacy `BtwSlot` rows, BTW now maps `turn_start`, `message_*`, `tool_execution_*`, and `turn_end` events from `session.subscribe()` into inspectable transcript entries for user turns, thinking text, tool calls, tool results, assistant output, failure state, and turn boundaries. Persisted BTW history is rehydrated into the same transcript model so restored overlays and live sessions share one truth surface.

T02 rewrote `buildOverlayTranscript()` around that typed model. Thinking, tool calls, tool results, assistant output, and turn separators now render as distinct compact multi-line blocks that fit inside the existing overlay viewport and scroll/wrap behavior. Tool results render beneath their corresponding tool call with truncation/error labeling instead of appearing as detached flat rows.

T03 moved event subscription ownership out of the prompt path and into the overlay/session lifecycle. Opening or re-showing BTW now attaches the active sub-session listener immediately; Escape dismissal, session replacement, and disposal all tear it down through the same centralized unsubscribe helper. That keeps live rendering truthful while the overlay is visible and prevents late disposed-session events from mutating hidden transcript state.

During milestone closure, this slice summary was backfilled from the completed T01-T03 task summaries so the slice artifact matches the already-shipped runtime and test evidence.

## Verification

Passed:
- `npm test -- tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts -t "transcript inspection exposes streaming and failure state"`
- `npm test -- tests/btw.runtime.test.ts -t "renders tool, thinking, result, and turn-separator rows in the overlay transcript"`
- `npm test -- tests/btw.runtime.test.ts -t "aborts, disposes, and unsubscribes the active BTW sub-session when Escape dismisses mid-stream"`

Verified by runtime assertions:
- tool calls map to `tool-call` transcript entries with formatted args
- tool results map to `tool-result` entries with truncation/error metadata and render beneath the corresponding tool call
- thinking and assistant streaming update typed transcript rows incrementally
- transcript inspection remains available after prompt failure
- opening BTW installs the listener before any prompt is submitted
- Escape dismissal removes the listener, and late emitted events from a disposed fake session are ignored

Operational note:
- Manual live-overlay inspection remained weaker than the runtime harness in this environment, but S01’s live PTY check already proved real tool rows and assistant output could appear in the BTW overlay; S02 added the render and lifecycle proof around that runtime seam.

## Requirements Advanced

- R002 — S02 preserved the lightweight/disposable contract by keeping rendering on compact typed entries and making event subscription overlay-scoped instead of leaving background listeners running.

## Requirements Validated

- R022 — proved by transcript inspection and render-layer assertions showing tool calls, tool results, thinking, assistant streaming, and failure state in the overlay transcript.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- The dispatch-referenced task plan files for T01-T03 were absent, so execution followed `.gsd/milestones/M002/slices/S02/S02-PLAN.md` plus the completed task summaries.
- Manual live pi/TUI verification remained limited by the available automation environment, so the authoritative proof stayed in the runtime harness and inspectable transcript surfaces.

## Known Limitations

- Manual live visual verification for the richer overlay transcript is still worth doing from a real terminal session, especially for long wrapped tool-result output.
- Wrapped continuation indentation still relies on the existing generic ANSI wrapping behavior rather than a custom hanging-indent layout system.

## Follow-ups

- Reuse `BtwOverlayComponent.getTranscriptEntries()` and listener-count assertions as the truth surface for any future BTW transcript or lifecycle changes.
- If future work needs stronger live proof, add a purpose-built interactive harness rather than relying on brittle terminal scraping.

## Files Created/Modified

- `extensions/btw.ts` — introduced typed transcript state, event-to-transcript mapping, styled transcript rendering, and overlay-owned subscription lifecycle helpers
- `tests/btw.runtime.test.ts` — added transcript inspection, render-layer, and listener-lifecycle assertions for BTW sub-session events
- `.gsd/milestones/M002/M002-ROADMAP.md` — S02 completion already marked at the roadmap level during T03
- `.gsd/DECISIONS.md` — recorded the transcript-inspection and overlay-owned subscription lifecycle decisions
- `.gsd/STATE.md` — updated active execution state during the original slice work and recreated during milestone closure

## Forward Intelligence

### What the next slice should know
- `BtwOverlayComponent.getTranscriptEntries()` is the most stable seam for proving transcript correctness without scraping rendered terminal output.
- Overlay open/close owns listener attachment and teardown; if transcript state changes while BTW is hidden, inspect the subscription helpers before touching rendering.

### What's fragile
- Render formatting for long wrapped tool results — the overlay still depends on generic line wrapping, so hanging-indent polish would need intentional layout work.
- Listener ownership ordering — creating a replacement session before clearing the old subscription risks duplicated events and stale status text.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` transcript and listener assertions — they inspect the typed transcript and lifecycle state directly, not through ambiguous terminal rendering.
- `BtwOverlayComponent.getTranscriptEntries()` — it exposes the exact tool/thinking/assistant/failure rows the overlay is rendering.

### What assumptions changed
- “The S01 slot bridge can be extended far enough for rich transcript work” — false; the clean path was to replace it with a typed event-native transcript model.
- “Prompt-scoped subscription is sufficient” — false; truthful overlay behavior requires attach-on-open and unsubscribe-on-dismiss lifecycle ownership.
