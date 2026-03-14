# Requirements

This file is the explicit capability and coverage contract for the project.

Use it to track what is actively in scope, what has been validated by completed work, what is intentionally deferred, and what is explicitly out of scope.

Guidelines:
- Keep requirements capability-oriented, not a giant feature wishlist.
- Requirements should be atomic, testable, and stated in plain language.
- Every **Active** requirement should be mapped to a slice, deferred, blocked with reason, or moved out of scope.
- Each requirement should have one accountable primary owner and may have supporting slices.
- Research may suggest requirements, but research does not silently make them binding.
- Validation means the requirement was actually proven by completed work and verification, not just discussed.

## Active

### R001 — BTW modal supports real multi-turn side chat
- Class: primary-user-loop
- Status: active
- Description: Opening BTW presents a real side-chat surface where the user can ask a question and continue for more than one turn without bouncing back to the main input.
- Why it matters: This is the core change from the current one-turn-at-a-time interaction.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: M001/S02
- Validation: mapped
- Notes: Must still feel like BTW, not a second full session.

### R002 — BTW opens quickly and stays lightweight/disposable
- Class: quality-attribute
- Status: active
- Description: BTW opens fast, feels lightweight, and is easy to dismiss without making the quick ask-then-escape flow worse.
- Why it matters: The user explicitly does not want a heavy or slow side surface.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: M001/S03
- Validation: mapped
- Notes: Performance and interaction weight matter as much as functionality.

### R004 — BTW takes keyboard focus while open
- Class: primary-user-loop
- Status: active
- Description: When BTW is open, typing goes into the BTW composer until the modal is dismissed.
- Why it matters: This removes the current bounce-back to the main input between follow-up turns.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: mapped
- Notes: Escape must still dismiss quickly.

### R005 — BTW preserves current documented thread semantics for core commands
- Class: continuity
- Status: validated
- Description: `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` keep the same thread behavior documented in the README.
- Why it matters: The user wants the existing BTW contract preserved, not redesigned.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S01
- Validation: proven by `tests/btw.runtime.test.ts` asserting reset-marker behavior, fresh-thread reopen semantics, and command-owned mode resets for `/btw:new`, `/btw:clear`, `/btw:tangent`, and `/btw`.
- Notes: Interaction model changes; contract does not.

### R006 — BTW keeps contextual mode and tangent mode behavior distinct exactly as documented
- Class: constraint
- Status: validated
- Description: Normal BTW continues a contextual side thread, while `btw:tangent` uses a fresh contextless tangent thread until mode switches back.
- Why it matters: This split is a core part of BTW behavior and was explicitly re-emphasized.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: none
- Validation: proven by `tests/btw.runtime.test.ts` asserting mode-switch reset markers and that tangent requests omit inherited main-session conversation while contextual BTW remains a separate preserved thread.
- Notes: Mode switching must remain truthful to README behavior.

### R007 — BTW handoff back to main session stays explicit
- Class: integration
- Status: validated
- Description: BTW remains separate from the main session unless the user explicitly injects or summarizes the side thread back into the main agent.
- Why it matters: The boundary between tangent thinking and main work should stay sharp.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: M001/S02
- Validation: proven by `tests/btw.runtime.test.ts` asserting `/btw:inject` and `/btw:summarize` are the only paths that create `sentUserMessages`, including summarize-failure preservation and ordinary follow-up/Escape non-handoff behavior.
- Notes: No automatic save-back on close.

### R010 — Existing BTW thread state still survives and restores according to the current contract
- Class: continuity
- Status: validated
- Description: Hidden BTW thread state still survives reloads/restarts and rehydrates according to the documented current behavior.
- Why it matters: The new UI should not break the extension’s existing persistence model.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S03
- Validation: proven by `tests/btw.runtime.test.ts` asserting restore behavior across `session_start`, `session_switch`, and `session_tree`, including last-reset-only rehydration.
- Notes: The README is the contract source.

### R011 — BTW continues to coexist with main-session work in the background
- Class: integration
- Status: validated
- Description: BTW remains a side conversation while the main session and its visible work stay behind the modal.
- Why it matters: The tangent should not replace or confuse the main work area.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: M001/S01
- Validation: proven by `tests/btw.runtime.test.ts` asserting busy-main-session handoff queues via `deliverAs: "followUp"`, successful handoff clears via reset-marker semantics and dismisses the overlay, and summarize failure leaves the overlay/thread recoverable instead of collapsing the side session boundary.
- Notes: Preserve the “hardworking session behind it” feel.

### R012 — BTW supports slash commands inside the modal if this can be done cleanly
- Class: differentiator
- Status: active
- Description: The BTW composer should support useful slash commands, ideally broad enough to include commands like GSD commands, if the integration can be done without making the surface heavy or messy.
- Why it matters: This is a desired capability, but not at the expense of the lightweight BTW feel.
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: none
- Validation: mapped
- Notes: Feasibility-sensitive requirement.

### R013 — BTW degrades gracefully if full slash parity is not feasible
- Class: quality-attribute
- Status: active
- Description: If full slash-command support cannot be added cleanly, BTW still delivers the core chat experience and makes any command limits coherent rather than awkward.
- Why it matters: The core UX should not be held hostage by command integration complexity.
- Source: inferred
- Primary owning slice: M001/S04
- Supporting slices: M001/S01
- Validation: mapped
- Notes: Avoid turning BTW into a huge mess.

### R014 — BTW preserves separation from main-session context except when explicit handoff is requested
- Class: constraint
- Status: validated
- Description: BTW notes and side-thread state stay out of the main agent’s future context unless explicitly handed back.
- Why it matters: This protects the side-thread workflow from polluting the main session.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S03
- Validation: proven by `tests/btw.runtime.test.ts` asserting the `context` hook filters BTW notes from main-session context while leaving non-BTW messages intact.
- Notes: Preserve current hidden-entry behavior.

## Validated

### R003 — BTW remains visually modal over the active main work area
- Class: differentiator
- Status: validated
- Description: BTW appears as a modal over the current active work area so the main agent remains visibly behind it.
- Why it matters: The user wants BTW to remain a tangent, not a replacement for the main workspace.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: proven by `tests/btw.runtime.test.ts` asserting BTW opens through `ctx.ui.custom(..., { overlay: true })` while preserving the widget mirror.
- Notes: Live human verification is still useful, but the overlay rendering contract is now executable.

### R008 — Escape dismisses the BTW modal quickly without breaking thread behavior
- Class: primary-user-loop
- Status: validated
- Description: The user can hit Escape to get out of BTW quickly, and reopening BTW follows the existing thread semantics rather than inventing new ones.
- Why it matters: Quick dismissal is central to the disposable feel.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: M001/S02
- Validation: proven by `tests/btw.runtime.test.ts` showing Escape dismissal preserves hidden-thread state and reopen restores the transcript.
- Notes: Dismissal still does not imply clear unless `/btw:clear` is used.

### R009 — BTW supports continued side-thread interaction in place
- Class: primary-user-loop
- Status: validated
- Description: After one BTW answer arrives, the user can immediately ask a follow-up inside the same modal.
- Why it matters: This is the direct UX gap the user wants removed.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: proven by `tests/btw.runtime.test.ts` showing an overlay follow-up creates a second BTW thread entry in the same thread.
- Notes: This is the practical expression of “actual chat interaction.”

## Deferred

### R015 — Full parity with all main-session slash commands inside BTW
- Class: differentiator
- Status: deferred
- Description: BTW behaves like a complete second command surface with parity to the main input for all slash commands.
- Why it matters: This could make BTW more powerful for advanced workflows.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred unless clean feasibility is proven during M001.

### R016 — BTW becomes a true embedded second session/workspace
- Class: differentiator
- Status: deferred
- Description: BTW evolves from a lightweight tangent modal into a near-peer embedded workspace with broader session parity.
- Why it matters: This may be interesting later, but it is not the current goal.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: The user explicitly wants lightweight and disposable instead.

## Out of Scope

### R017 — Replace the main chat/work area with BTW
- Class: anti-feature
- Status: out-of-scope
- Description: BTW takes over the main work surface or stops being clearly separate from the active session.
- Why it matters: This prevents the tangent workflow from becoming confusing or heavy.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: The modal should leave the main work visible behind it.

### R018 — Change BTW’s documented contextual vs tangent contract
- Class: anti-feature
- Status: out-of-scope
- Description: Redefine how BTW threads continue, clear, or switch between contextual and tangent modes.
- Why it matters: The user wants the current behavior preserved exactly as documented.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Preserve README semantics.

### R019 — Automatically hand BTW conversations back to the main session on close
- Class: anti-feature
- Status: out-of-scope
- Description: Closing BTW auto-saves, auto-summarizes, or auto-injects side-thread content into the main session.
- Why it matters: This would blur the boundary the user wants to keep explicit.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Handoff remains explicit.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | primary-user-loop | active | M001/S01 | M001/S02 | mapped |
| R002 | quality-attribute | active | M001/S01 | M001/S03 | mapped |
| R003 | differentiator | validated | M001/S01 | none | proven |
| R004 | primary-user-loop | active | M001/S01 | none | mapped |
| R005 | continuity | validated | M001/S02 | M001/S01 | proven |
| R006 | constraint | validated | M001/S02 | none | proven |
| R007 | integration | validated | M001/S03 | M001/S02 | proven |
| R008 | primary-user-loop | validated | M001/S01 | M001/S02 | proven |
| R009 | primary-user-loop | validated | M001/S01 | none | proven |
| R010 | continuity | validated | M001/S02 | M001/S03 | proven |
| R011 | integration | validated | M001/S03 | M001/S01 | proven |
| R012 | differentiator | active | M001/S04 | none | mapped |
| R013 | quality-attribute | active | M001/S04 | M001/S01 | mapped |
| R014 | constraint | validated | M001/S02 | M001/S03 | proven |
| R015 | differentiator | deferred | none | none | unmapped |
| R016 | differentiator | deferred | none | none | unmapped |
| R017 | anti-feature | out-of-scope | none | none | n/a |
| R018 | anti-feature | out-of-scope | none | none | n/a |
| R019 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 5
- Mapped to slices: 14
- Validated: 9
- Unmapped active requirements: 0
