# Project

## What This Is

pi-btw is a pi extension that adds a BTW side-conversation workflow. It now ships a lightweight embedded BTW modal chat that lets the user hold a real multi-turn side conversation over the active session while keeping the hidden BTW thread separate from the main session context.

## Core Value

A user can open BTW instantly, ask and continue a side conversation in place without derailing the main run, then dismiss it just as quickly.

## Current State

M001 is complete. `extensions/btw.ts` now opens BTW as a focused overlay with its own composer, transcript, streamed status text, follow-up submission path, inject/summarize handoff commands, Escape dismissal, and BTW-scoped in-modal slash support for `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize`. Unsupported slash input inside the modal degrades intentionally with a BTW-local warning instead of pretending full main-input parity. Hidden custom session entries and reset markers still authoritatively govern `/btw`, `/btw:new`, `/btw:clear`, `/btw:tangent`, restore behavior, explicit handoff clearing, and main-context filtering, while busy main-session handoff remains explicitly queued as follow-up work rather than interrupting visible work. The above-editor widget remains as a lightweight mirror, not the primary interaction surface.

## Architecture / Key Patterns

The extension is self-contained. BTW state is persisted via hidden custom session entries and rendered through extension UI hooks. Commands like `/btw`, `/btw:new`, `/btw:tangent`, `/btw:inject`, and `/btw:summarize` define the user contract. The main architectural constraint is to preserve the current BTW contract while replacing the interaction surface with a faster, more interactive modal chat flow.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001: Embedded BTW modal chat — Replace the current widget-only BTW interaction with a lightweight modal multi-turn side chat while preserving BTW semantics.
  - [x] S01: Modal BTW chat shell
  - [x] S02: BTW contract preservation
  - [x] S03: Explicit handoff and background-session integration
  - [x] S04: Slash-command support and graceful fallback
