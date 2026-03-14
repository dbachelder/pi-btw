# Project

## What This Is

pi-btw is a pi extension that adds a BTW side-conversation workflow. Right now it runs side questions immediately and streams answers into a widget above the editor while keeping a hidden BTW thread separate from the main session context. The next milestone turns that one-turn-at-a-time overlay into an actual modal side-chat experience that is still lightweight, disposable, and clearly a tangent from the current hard-working session.

## Core Value

A user can open BTW instantly, ask and continue a side conversation in place without derailing the main run, then dismiss it just as quickly.

## Current State

The project now ships a real BTW modal shell instead of a widget-only side channel, and S02 has now proven that the modal remains a thin UI over the existing BTW contract. `extensions/btw.ts` opens BTW as a focused overlay with its own composer, transcript, streamed status text, follow-up submission path, and Escape dismissal, while hidden custom session entries and reset markers still authoritatively govern `/btw`, `/btw:new`, `/btw:clear`, `/btw:tangent`, restore behavior, and main-context filtering. The above-editor widget remains as a lightweight mirror, not the primary interaction surface.

## Architecture / Key Patterns

The extension is self-contained. BTW state is persisted via hidden custom session entries and rendered through extension UI hooks. Commands like `/btw`, `/btw:new`, `/btw:tangent`, `/btw:inject`, and `/btw:summarize` define the user contract. The main architectural constraint is to preserve the current BTW contract while replacing the interaction surface with a faster, more interactive modal chat flow.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M001: Embedded BTW modal chat — Replace the current widget-only BTW interaction with a lightweight modal multi-turn side chat while preserving BTW semantics.
  - [x] S01: Modal BTW chat shell
  - [x] S02: BTW contract preservation
  - [ ] S03: Explicit handoff and background-session integration
  - [ ] S04: Slash-command support and graceful fallback
