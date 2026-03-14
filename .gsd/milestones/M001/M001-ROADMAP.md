# M001: Embedded BTW modal chat

**Vision:** Replace the current BTW widget-only interaction with a lightweight modal multi-turn side chat that preserves BTW’s existing thread semantics, contextual vs tangent contract, and explicit handoff back to the main session.

## Success Criteria

- User can open BTW into a modal and continue a side conversation for multiple turns without returning to the main input between turns.
- BTW still follows the documented behavior for `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent`.
- Escape dismisses BTW quickly while preserving the current BTW thread contract.
- BTW remains clearly separate from the main session unless the user explicitly injects or summarizes the side thread back.
- Slash-command behavior inside BTW is either implemented cleanly or intentionally constrained without damaging the core BTW UX.

## Key Risks / Unknowns

- pi extension UI may not expose a ready-made embedded chat/modal input surface — this could force custom TUI interaction work.
- Slash-command support inside BTW may be hard to scope cleanly — poor integration could make BTW heavy or confusing.
- Preserving hidden-thread restore behavior while changing input/focus flow may introduce lifecycle regressions.

## Proof Strategy

- Modal/input surface feasibility → retire in S01 by proving BTW can open as a fast modal, take focus, accept typed follow-ups, and dismiss via Escape.
- Contract preservation across contextual/tangent modes → retire in S02 by proving the new UI still follows existing documented thread semantics and restore behavior.
- Slash-command feasibility → retire in S04 by proving either clean command support inside BTW or a deliberate graceful fallback that preserves the core UX.

## Verification Classes

- Contract verification: file/artifact inspection plus targeted command-level verification of BTW command behavior and hidden session state wiring.
- Integration verification: real pi TUI interaction exercising modal open, focused input, multi-turn side-chat, mode switching, and explicit handoff.
- Operational verification: session restore/switch behavior for hidden BTW thread state and modal/thread rehydration where applicable.
- UAT / human verification: subjective check that the modal still feels lightweight, disposable, and clearly tangent from the main work area.

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slice deliverables are complete.
- The modal BTW chat surface, thread state, and handoff behaviors are actually wired together.
- The real BTW entrypoints are exercised through live interaction in pi.
- Success criteria are re-checked against behavior, not just code artifacts.
- Final integrated acceptance scenarios pass for multi-turn chat, mode behavior, and explicit handoff.

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014
- Partially covers: none
- Leaves for later: R015, R016
- Orphan risks: none

## Slices

- [x] **S01: Modal BTW chat shell** `risk:high` `depends:[]`
  > After this: BTW opens as a real modal side-chat with focused input, supports at least one follow-up turn in place, and dismisses via Escape.

- [x] **S02: BTW contract preservation** `risk:medium` `depends:[S01]`
  > After this: the new modal interaction still obeys the current README contract for contextual BTW, `btw:new`, `btw:clear`, `btw:tangent`, and hidden thread restore behavior.

- [x] **S03: Explicit handoff and background-session integration** `risk:low` `depends:[S02]`
  > After this: inject/summarize still work cleanly from the modal, and BTW remains visibly and behaviorally separate from the main session behind it.

- [x] **S04: Slash-command support and graceful fallback** `risk:high` `depends:[S01,S02]`
  > After this: BTW supports BTW-scoped slash-command behavior inside the modal, and unsupported slash input intentionally degrades with an explicit lightweight fallback instead of pretending full main-surface parity.

## Boundary Map

### S01 → S02

Produces:
- BTW modal surface contract: open, focused composer, transcript region, dismiss-on-Escape invariant.
- Side-chat input/submit flow that can append a new user turn without routing through the main input.
- UI state model for an active BTW modal session independent from the old above-editor widget rendering.

Consumes:
- Existing BTW command entrypoints in `extensions/btw.ts`.
- Existing BTW completion pipeline and hidden thread entry shapes.

### S02 → S03

Produces:
- Stable mapping from BTW commands/modes to modal behavior while preserving current thread semantics.
- Restored hidden-thread behavior for contextual and tangent modes under the new modal interaction.
- Verified invariants for `btw`, `btw:new`, `btw:clear`, and `btw:tangent`.

Consumes:
- S01 modal surface and input flow.
- Existing hidden BTW thread persistence and context-filtering model.

### S02 → S04

Produces:
- BTW modal composer integration point where slash parsing/dispatch could attach.
- Known behavioral boundaries for command scope so slash support does not violate BTW thread semantics.

Consumes:
- S01 modal composer.
- S02 preserved BTW command/thread contract.

### S03 → milestone completion

Produces:
- Explicit in-modal handoff actions for inject/summarize.
- Verified coexistence between BTW modal usage and the visible main session behind it.

Consumes:
- S02 preserved thread and mode behavior.
- Existing injection/summarization pipeline in `extensions/btw.ts`.

### S04 → milestone completion

Produces:
- Clean slash-command behavior inside BTW, or a deliberate fallback policy and UX if parity is not cleanly feasible.
- Verified command-scope rules for BTW modal input.

Consumes:
- S01 modal input surface.
- S02 command/thread invariants.
- S03 integrated BTW modal workflow.
