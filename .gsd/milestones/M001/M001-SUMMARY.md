---
id: M001
provides:
  - BTW now ships as a lightweight embedded modal side chat with preserved hidden-thread semantics, explicit handoff controls, and BTW-scoped in-modal slash support plus graceful fallback for unsupported slash input.
key_decisions:
  - Preserved hidden BTW entries and reset markers as the source of truth while layering the modal chat and in-modal slash dispatch over the existing command/thread contract.
patterns_established:
  - Use the BTW runtime harness as the milestone gate for cross-slice modal, contract, handoff, restore, and slash/fallback semantics when live TUI proof is environment-blocked.
observability_surfaces:
  - tests/btw.runtime.test.ts named runtime assertions over overlay options, transcript state, reset markers, handoff delivery, restore events, and BTW-local slash fallback warnings
requirement_outcomes:
  - id: R003
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts BTW opens via ctx.ui.custom(..., { overlay: true }) while preserving the widget mirror.
  - id: R005
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts reset-marker behavior, fresh-thread reopen semantics, and command-owned mode resets for /btw, /btw:new, /btw:clear, and /btw:tangent.
  - id: R006
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts mode-switch reset markers and that tangent requests omit inherited main-session conversation while contextual BTW remains separate.
  - id: R007
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts /btw:inject and /btw:summarize are the only paths that create sentUserMessages, including summarize-failure preservation and ordinary follow-up/Escape non-handoff behavior.
  - id: R008
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts shows Escape dismissal preserves hidden-thread state and reopen restores the transcript.
  - id: R009
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts shows an overlay follow-up creates a second BTW thread entry in the same thread.
  - id: R010
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts restore behavior across session_start, session_switch, and session_tree, including last-reset-only rehydration.
  - id: R011
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts busy-main-session handoff queues via deliverAs: "followUp", successful handoff clears via reset-marker semantics and dismisses the overlay, and summarize failure leaves the overlay/thread recoverable.
  - id: R012
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts overlay-submitted /btw:new, /btw:tangent, and /btw:inject reuse the same reset, mode-switch, and handoff semantics as the registered BTW commands.
  - id: R013
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts unsupported modal slash input surfaces an explicit BTW-local warning and does not execute a command, mutate hidden thread state, or fall through as BTW chat text.
  - id: R014
    from_status: active
    to_status: validated
    proof: tests/btw.runtime.test.ts asserts the context hook filters BTW notes from main-session context while leaving non-BTW messages intact.
duration: ~4h across S01-S04
verification_result: passed
completed_at: 2026-03-13T20:41:00-07:00
---

# M001: Embedded BTW modal chat

**Shipped BTW as a real lightweight modal side chat with preserved thread semantics, explicit main-session handoff, and BTW-scoped in-modal slash commands plus graceful fallback instead of fake full command parity.**

## What Happened

M001 replaced the old widget-only BTW interaction with a true overlay-backed side chat while preserving the existing hidden-thread contract instead of inventing a second session model. S01 established the modal shell in `extensions/btw.ts`: focused composer, streamed transcript and status, in-place follow-up turns, Escape dismissal, and a compatibility widget mirror, all still backed by `btw-thread-entry` and `btw-thread-reset` entries. Because live TUI automation was blocked by unrelated extension-load failures and missing macOS automation permissions, the milestone shifted to an executable runtime-proof approach with `tests/btw.runtime.test.ts` as the main observability surface.

S02 expanded that harness into a real contract gate. The tests proved that `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` still obey the README semantics; contextual and tangent modes remain distinct; restore behavior still keys off the last reset marker across session lifecycle events; and BTW notes remain filtered out of the main-session context.

S03 then proved the integration boundary between the modal tangent and the main session. The harness added explicit assertions for `/btw:inject`, `/btw:summarize`, busy-session follow-up delivery, summarize-failure recovery, and non-handoff follow-up/Escape behavior. That proof exposed a real overlay lifecycle bug in `ensureOverlay()`; fixing it kept the live overlay close path truthful across dismissal, handoff, and reopen.

S04 closed the slash-command question with a narrow, intentional policy instead of pretending full parity. The modal composer now recognizes only BTW-owned slash commands (`/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, `/btw:summarize`) and routes them through the same production command helpers as the registered commands. Unsupported slash input produces a BTW-local warning, leaves thread state untouched, and does not leak into the main session or get sent as BTW chat text. That satisfies the useful part of in-modal slash support without turning BTW into a second heavy command surface.

Taken together, the slices now deliver the milestone vision: BTW opens as a fast modal side chat over the active work, supports real multi-turn interaction, preserves the documented contextual/tangent/reset/restore semantics, keeps handoff explicit, and handles slash input inside the modal in a bounded, coherent way.

## Cross-Slice Verification

- Success criterion: user can open BTW into a modal and continue a side conversation for multiple turns without returning to the main input between turns.
  - Verified by `npm test -- tests/btw.runtime.test.ts`, specifically the assertions `keeps the thread after Escape dismissal and restores it on reopen` and `supports an in-place follow-up and preserves both turns in one thread`, plus production logic in `extensions/btw.ts` routing overlay submit through `submitFromOverlay()` and `runBtw()`.

- Success criterion: BTW still follows the documented behavior for `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent`.
  - Verified by `npm test -- tests/btw.runtime.test.ts`, specifically the assertions `/btw:new appends a reset marker...`, `switching between /btw:tangent and /btw appends reset markers...`, `/btw:clear dismisses the overlay...`, and `restore behavior is consistent across session_start, session_switch, and session_tree`.

- Success criterion: Escape dismisses BTW quickly while preserving the current BTW thread contract.
  - Verified by `npm test -- tests/btw.runtime.test.ts`, specifically `keeps the thread after Escape dismissal and restores it on reopen` and `ordinary BTW follow-up submit and Escape dismissal do not send content to the main session`.

- Success criterion: BTW remains clearly separate from the main session unless the user explicitly injects or summarizes the side thread back.
  - Verified by `npm test -- tests/btw.runtime.test.ts`, specifically `/btw:inject success sends one main-session message...`, `/btw:summarize success sends summary content...`, `summarize failure preserves BTW thread state and keeps the overlay recoverable`, `ordinary BTW follow-up submit and Escape dismissal do not send content to the main session`, and `context filtering excludes BTW notes from main-session context while leaving non-BTW messages intact`.

- Success criterion: slash-command behavior inside BTW is either implemented cleanly or intentionally constrained without damaging the core BTW UX.
  - Verified by `npm test -- tests/btw.runtime.test.ts`, specifically `in-modal /btw:new reuses command semantics...`, `in-modal /btw:tangent reuses command semantics...`, `in-modal /btw:inject reuses command semantics...`, and `unsupported slash input in the modal surfaces BTW-local fallback and does not execute a command`.

Definition of done checks:
- All slices complete: verified in milestone roadmap context and reflected by S01, S02, and S03 summaries plus completed S04 implementation/tests.
- All slice summaries exist: verified for S01-S03; M001 itself now has a milestone summary. S04 summary was missing at unit start, but milestone completion evidence for S04 is now grounded directly in `extensions/btw.ts`, `README.md`, `tests/btw.runtime.test.ts`, and the passing `npm test -- tests/btw.runtime.test.ts` run.
- Modal/thread/handoff behaviors are wired together: verified by the integrated runtime assertions spanning overlay open/reopen, command semantics, restore, inject/summarize, and slash fallback.
- Real BTW entrypoints exercised: verified at the runtime-command layer for `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize` through the registered command handlers and in-modal submit path.
- Success criteria rechecked against behavior, not just code artifacts: satisfied via the passing targeted runtime suite.
- Final integrated acceptance scenarios for multi-turn chat, mode behavior, and explicit handoff: satisfied by the targeted runtime suite and production seams in `extensions/btw.ts`.

No success criteria remain unmet based on the available executable evidence.

## Requirement Changes

- R003: active → validated — `tests/btw.runtime.test.ts` asserts BTW renders through `ctx.ui.custom(..., { overlay: true })` while preserving the widget mirror.
- R005: active → validated — `tests/btw.runtime.test.ts` asserts reset-marker behavior, fresh-thread reopen semantics, and command-owned mode resets for `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent`.
- R006: active → validated — `tests/btw.runtime.test.ts` asserts mode-switch reset markers and tangent request context exclusion while contextual BTW remains separate.
- R007: active → validated — `tests/btw.runtime.test.ts` asserts inject/summarize are the only paths that cross into `sentUserMessages`, including summarize-failure preservation and non-handoff follow-up/Escape behavior.
- R008: active → validated — `tests/btw.runtime.test.ts` proves Escape dismissal preserves hidden thread state and reopen restores transcript state.
- R009: active → validated — `tests/btw.runtime.test.ts` proves follow-up submission in the overlay persists a second BTW thread entry in place.
- R010: active → validated — `tests/btw.runtime.test.ts` proves restore behavior across `session_start`, `session_switch`, and `session_tree`, including last-reset-only rehydration.
- R011: active → validated — `tests/btw.runtime.test.ts` proves successful handoff clears/dismisses correctly, busy handoff queues as follow-up, and summarize failure preserves recoverability.
- R012: active → validated — `tests/btw.runtime.test.ts` proves BTW-scoped in-modal slash commands reuse production command semantics.
- R013: active → validated — `tests/btw.runtime.test.ts` proves unsupported modal slash input degrades with an explicit BTW-local warning and no side effects.
- R014: active → validated — `tests/btw.runtime.test.ts` proves the `context` hook filters BTW notes from main-session context.

## Forward Intelligence

### What the next milestone should know
- `tests/btw.runtime.test.ts` is now the authoritative high-signal regression gate for BTW behavior. It covers modal semantics, restore boundaries, handoff, and slash fallback in one place, so start there before changing `extensions/btw.ts`.
- The slash policy is intentionally narrow by decision D010. Future work should treat full main-surface parity as a separate milestone, not as an incidental extension of the current modal.

### What's fragile
- `overlayRuntime` lifecycle in `extensions/btw.ts` is still a thin seam — premature cleanup or recreation will break Escape dismissal, handoff close behavior, or reopen semantics even if the modal still appears to render.
- Reset markers remain the real source of truth for thread clearing and restore. UI visibility can drift without immediately exposing a contract regression if tests are not rerun.

### Authoritative diagnostics
- `tests/btw.runtime.test.ts` — it exercises registered commands, overlay submit behavior, hidden entries, restore events, sent main-session messages, and BTW-local warnings directly.
- `extensions/btw.ts` helpers `ensureOverlay()`, `dispatchBtwCommand()`, `submitFromOverlay()`, `resetThread()`, `restoreThread()`, and `sendThreadToMain()` — these are the first production seams to inspect when milestone behaviors regress.

### What assumptions changed
- The initial assumption was that live pi TUI interaction would provide the main verification story — in practice, environment blockers forced the runtime harness to become the milestone-grade proof surface.
- The initial slash-command question was open-ended — the clean result was not broad parity, but bounded BTW-owned slash support plus explicit fallback for everything else.

## Files Created/Modified

- `extensions/btw.ts` — modal BTW shell, restore-preserving overlay lifecycle, explicit handoff logic, and BTW-scoped in-modal slash dispatch with graceful fallback
- `tests/btw.runtime.test.ts` — milestone-grade runtime proof for modal behavior, command semantics, restore, handoff, and slash/fallback behavior
- `README.md` — modal-first BTW UX wording and explicit in-modal slash policy
- `package.json` — test script and Vitest dependency for the runtime harness
- `vitest.config.ts` — minimal runtime test configuration
- `.gsd/milestones/M001/M001-SUMMARY.md` — milestone-level completion, verification, and forward intelligence
- `.gsd/PROJECT.md` — updated milestone and current-state status to reflect M001 completion
- `.gsd/STATE.md` — advanced project state beyond M001 completion
