# M001: Embedded BTW modal chat — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

The user wants the modal widget that comes up when you do BTW to become an actual chat interaction. The important constraint is to keep BTW behaving the way it already behaves in the README: contextual BTW continues the current side thread, `btw:tangent` is the contextless tangent mode, `btw:new` starts fresh, and `btw:clear` clears. The change is about replacing the awkward one-turn-at-a-time flow with an inline chat box inside the modal so the user can continue the interaction there instead of dismissing the modal, going back to the main input, and firing another slash command.

## Why This Milestone

BTW already solves the parallel-side-conversation problem, but the current interaction is too indirect for follow-up turns. The user wants a real mini chat interaction that still feels lightweight and disposable, opens quickly, and clearly remains a tangent from the current hard-working session rather than becoming a second full workspace.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Open BTW into a modal, type directly into it, and continue a side conversation for multiple turns without returning to the main input between turns.
- Hit Escape to get out of BTW quickly while keeping the existing BTW thread semantics intact.
- Use the same BTW commands and mode behavior they already know, including contextual BTW versus `btw:tangent`.

### Entry point / environment

- Entry point: pi extension command workflow via `/btw`, `/btw:new`, `/btw:tangent`, `/btw:inject`, `/btw:summarize`, `/btw:clear`
- Environment: local dev in pi TUI extension runtime
- Live dependencies involved: pi extension API, TUI input/rendering, model/provider access for side-chat completions

## Completion Class

- Contract complete means: the modal side-chat supports multi-turn interaction, Escape dismissal, preserved thread semantics, and explicit handoff behavior as specified in the README and requirements.
- Integration complete means: BTW works as a modal tangent over the active session while preserving contextual vs tangent mode separation and hidden-thread persistence.
- Operational complete means: BTW thread state survives the same lifecycle events it survives today, including session restore/switch behavior.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A user can start a BTW side conversation, ask at least one follow-up inside the modal, and dismiss the modal with Escape without bouncing through the main input.
- A user can switch between contextual BTW and `btw:tangent` and observe the documented thread behavior remain intact.
- A user can explicitly inject or summarize a BTW thread back into the main session from the new interaction model.

## Risks and Unknowns

- pi extension APIs may not expose a turnkey embedded chat input/modal surface — this matters because the desired UX may require custom TUI interaction plumbing.
- Slash-command support inside the BTW modal may not have clean parity with the main input — this matters because the user would like broad command support but does not want a huge mess.
- Preserving current hidden-thread/session behavior while changing the interaction surface may create subtle restore/focus edge cases.

## Existing Codebase / Prior Art

- `extensions/btw.ts` — current BTW implementation, including command contract, hidden-thread persistence, context filtering, and widget rendering.
- `README.md` — the source-of-truth user contract for BTW semantics that this milestone must preserve.
- `skills/btw/SKILL.md` — supporting guidance for how BTW should be used conceptually.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001 — Replace the one-turn overlay flow with real in-modal multi-turn side chat.
- R002 — Keep BTW lightweight, fast to open, and disposable.
- R003 — Preserve BTW as a modal tangent over the active main work area.
- R005 — Preserve the current documented command/thread contract.
- R006 — Keep contextual and tangent modes distinct exactly as documented.
- R007 — Keep handoff back to the main session explicit.
- R012 — Explore slash-command support only if it can be done cleanly.

## Scope

### In Scope

- Modal chat UX for BTW.
- Focused BTW input and multi-turn side-chat flow.
- Preservation of documented BTW thread semantics and hidden persistence behavior.
- Explicit inject/summarize handoff from the new surface.
- Feasibility work for slash-command support inside BTW.

### Out of Scope / Non-Goals

- Turning BTW into a full second session or peer workspace.
- Replacing the main work area with BTW.
- Changing the existing BTW contextual/tangent/clear/new contract.
- Auto-saving or auto-injecting BTW conversations on close.

## Technical Constraints

- Preserve the current README-documented BTW behavior as the contract.
- Keep BTW notes and hidden thread state out of the main agent context unless explicitly handed back.
- Do not make BTW heavy or slow in pursuit of feature parity.

## Integration Points

- pi extension command registry — BTW commands and any scoped command handling inside the modal.
- pi extension UI/TUI APIs — modal presentation, focus management, keyboard handling, and rendering.
- pi session state — hidden BTW thread entries, restore behavior, and context filtering.
- model/provider pipeline — side-chat completions, streaming, and summarization.

## Open Questions

- Is there an existing pi extension UI primitive for interactive modal input/chat, or does BTW need to build its own lightweight custom TUI surface? — Current thinking: likely custom or adapted from adjacent extension patterns.
- How much slash-command support can be scoped cleanly into BTW without coupling it too tightly to the main input implementation? — Current thinking: treat full parity as a bonus, not a prerequisite.
