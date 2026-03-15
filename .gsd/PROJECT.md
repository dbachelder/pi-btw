# Project

## What This Is

pi-btw is a pi extension that adds a BTW side-conversation workflow. It now ships a lightweight embedded BTW modal chat that lets the user hold a real side conversation over the active session while keeping BTW separate from the main session.

## Core Value

A user can open BTW instantly, ask and continue a side conversation in place without derailing the main run, then dismiss it just as quickly.

## Current State

M001 and M002 are complete. `extensions/btw.ts` now runs BTW on a real in-memory `AgentSession` sub-session created with `createAgentSession()` + `SessionManager.inMemory()`, reuses the main session's model/model registry, enables `codingTools`, renders the overlay transcript directly from agent events, routes non-BTW slash input through the sub-session `prompt()` path, and extracts inject/summarize handoff content from real sub-session message history. S04 finished the contract hardening work: `tests/btw.runtime.test.ts` now covers incremental streaming, slash failure recovery, empty-thread injection, clear-during-tool disposal, summarize on the AgentSession seam, and dead M001 plumbing removal. `README.md` now matches the shipped sub-session behavior, and `.gsd/milestones/M002/M002-SUMMARY.md` plus `.gsd/milestones/M002/slices/S02/S02-SUMMARY.md` close the last milestone-level documentation gaps.

## Architecture / Key Patterns

The extension remains self-contained, but BTW now has a split runtime model:

- the **BTW overlay contract** still lives in the extension UI/hooks and preserves the documented `/btw`, `/btw:new`, `/btw:clear`, `/btw:tangent`, inject, and summarize semantics
- the **BTW agent loop** runs on a disposable in-memory `AgentSession` sub-session with coding tools and mode-aware seeded messages
- the **overlay transcript** is event-native: tool calls/results, assistant streaming, failures, and persisted restore state all flow through `BtwTranscriptEntry` mapping built from `AgentSessionEvent`s
- the **lifecycle contract** centers on shared dispose/reset helpers that unsubscribe listeners, abort in-flight work, and dispose both interactive and summarize-only sub-sessions before reset or replacement

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001: Embedded BTW modal chat — Replace the current widget-only BTW interaction with a lightweight modal multi-turn side chat while preserving BTW semantics.
  - [x] S01: Modal BTW chat shell
  - [x] S02: BTW contract preservation
  - [x] S03: Explicit handoff and background-session integration
  - [x] S04: Slash-command support and graceful fallback
- [x] M002: BTW sub-session — Replace BTW's manual stream/context plumbing with a real `AgentSession` sub-session backed by `createAgentSession()`, giving BTW full tools, native slash commands, and parallel execution.
  - [x] S01: Sub-session lifecycle and agent loop
  - [x] S02: Overlay transcript rendering from agent events
  - [x] S03: Slash commands, handoff, and parallel execution
  - [x] S04: Contract hardening and cleanup
