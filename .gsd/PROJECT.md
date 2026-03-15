# Project

## What This Is

pi-btw is a pi extension that adds a BTW side-conversation workflow. It now ships a lightweight embedded BTW modal chat that lets the user hold a real side conversation over the active session while keeping BTW separate from the main session.

## Core Value

A user can open BTW instantly, ask and continue a side conversation in place without derailing the main run, then dismiss it just as quickly.

## Current State

M001 is complete, and M002/S01 is now complete. `extensions/btw.ts` no longer drives BTW through manual `streamSimple()` / `completeSimple()` calls; it now opens BTW on a real in-memory `AgentSession` sub-session created with `createAgentSession()` + `SessionManager.inMemory()`, reusing the main session's model/model registry and enabling `codingTools`. BTW prompts now route through `session.prompt()`, contextual mode seeds main-session messages into the sub-session, tangent mode recreates a clean sub-session, and Escape / `/btw:clear` / replacement flows abort and dispose the live sub-session cleanly. The overlay still renders through a simplified text bridge fed by `session.subscribe()` events; rich event-transcript rendering, broader slash dispatch, and explicit parallel-execution proof are the next M002 slices.

## Architecture / Key Patterns

The extension remains self-contained, but BTW now has a split runtime model:

- the **BTW overlay contract** still lives in the extension UI/hooks and preserves the documented `/btw`, `/btw:new`, `/btw:clear`, `/btw:tangent`, inject, and summarize semantics
- the **BTW agent loop** now runs on a disposable in-memory `AgentSession` sub-session with coding tools and mode-aware seeded messages
- the **current overlay transcript** is still a compatibility bridge that compresses `AgentSession` events into simplified BTW slots until S02 replaces it with richer event-native rendering
- the **lifecycle contract** now centers on a shared dispose helper that unsubscribes listeners, aborts in-flight work, and disposes the sub-session before reset or replacement

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001: Embedded BTW modal chat — Replace the current widget-only BTW interaction with a lightweight modal multi-turn side chat while preserving BTW semantics.
  - [x] S01: Modal BTW chat shell
  - [x] S02: BTW contract preservation
  - [x] S03: Explicit handoff and background-session integration
  - [x] S04: Slash-command support and graceful fallback
- [ ] M002: BTW sub-session — Replace BTW's manual stream/context plumbing with a real `AgentSession` sub-session backed by `createAgentSession()`, giving BTW full tools, native slash commands, and parallel execution.
  - [x] S01: Sub-session lifecycle and agent loop
  - [ ] S02: Overlay transcript rendering from agent events
  - [ ] S03: Slash commands, handoff, and parallel execution
  - [ ] S04: Contract hardening and cleanup
