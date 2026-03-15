# S01 Assessment — roadmap still holds

S01 retired the high-risk sub-session lifecycle/agent-loop risk it was meant to retire. No concrete evidence from the shipped code or runtime verification requires reordering, splitting, or rewriting the remaining M002 slices.

## Success-criterion coverage check

- User can open BTW, ask it to read a file, and see the tool call and result rendered in the overlay transcript → S02, S04
- User can type any slash command in the BTW overlay and have it execute through the sub-session's own command dispatch → S03, S04
- Main session continues accepting input and streaming while BTW is actively running tools in the overlay → S03, S04
- Dismissing BTW with Escape cleanly disposes the sub-session with no orphaned agent loops or leaked resources → S04
- Inject/summarize still hand BTW content back to the main session explicitly → S03, S04
- BTW opens fast enough that the sub-session creation overhead is not perceptible → S04

Coverage check passes: every success criterion still has at least one remaining owning slice.

## Reassessment

- **Risk retirement:** S01 did retire the intended `createAgentSession()` concurrency/lifecycle risk. The real sub-session path, tool execution, and cleanup contract now exist and were verified directly.
- **Remaining risks still match the roadmap:**
  - S02 still needs to replace the temporary `BtwSlot` bridge with event-native transcript rendering.
  - S03 still needs true slash-command routing, explicit handoff extraction from sub-session state, and parallel-execution proof.
  - S04 still needs to harden the runtime contract, re-prove disposal/handoff/parallel behavior in the final model, and serve as the remaining place to re-check the lightweight-open criterion.
- **Boundary map:** still accurate. S01 produced the exact event stream, prompt path, seeded-message access, and disposal contract that S02/S03/S04 were expected to consume.
- **Requirements:** coverage remains sound. No active requirement was invalidated or newly surfaced. Remaining active M002 requirements are still credibly covered by the unchecked slices: R022 by S02/S04, R015 and R021 by S03/S04, and R002 remains an operational quality check to re-confirm by milestone close.

## Decision

Keep the roadmap as-is. No slice reordering or scope change is justified by current evidence.
