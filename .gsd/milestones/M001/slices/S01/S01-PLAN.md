# S01: Modal BTW chat shell

**Goal:** BTW opens as a real modal side-chat with its own focused composer, renders the side transcript inside the modal, supports at least one in-place follow-up turn, and dismisses quickly with Escape without redefining current BTW thread semantics.
**Demo:** From a running pi session with this extension loaded, invoke BTW, see a modal over the active main work area, type a question into the BTW composer, receive a streamed answer in the modal transcript, ask a follow-up without returning to the main input, and dismiss the modal with Escape while leaving the underlying main session visible.

## Must-Haves

- BTW opens into a true overlay/modal instead of relying on the passive above-editor widget.
- The BTW modal owns keyboard focus while open and provides its own composer for follow-up turns.
- The modal renders the current BTW thread/transcript and updates while a BTW response streams.
- Escape dismisses the modal quickly without implicitly clearing BTW thread state.
- The modal reuses the existing BTW thread/persistence pipeline so S02 can preserve `/btw`, `/btw:new`, `/btw:tangent`, and restore semantics rather than rebuilding them.
- A real interaction-level verification path exists for modal open, focused input, in-place follow-up, and Escape dismissal.

## Proof Level

- This slice proves: integration
- Real runtime required: yes
- Human/UAT required: yes

## Verification

- `npm pack --dry-run`
- `pi -e /Users/dan/src/pi-btw` and a live TUI check covering: open BTW modal, type and submit one question, submit one follow-up inside the same modal, confirm the main session remains visible behind the overlay, press Escape to dismiss, then reopen BTW and confirm the thread transcript is still present.
- In the same live TUI run, trigger at least one inspectable BTW failure path (for example missing credentials, aborted request, or model error) and confirm the modal shows explicit error/status state without clearing the thread.
- `git diff -- extensions/btw.ts README.md`

## Observability / Diagnostics

- Runtime signals: explicit BTW modal status text for idle/streaming/error states and visible transcript updates during streaming.
- Inspection surfaces: live modal UI state in pi plus existing hidden BTW entries and README contract text for behavioral comparison.
- Failure visibility: visible error state in the modal transcript/status area when a BTW request fails or is aborted.
- Redaction constraints: BTW UI and diagnostics must not expose secrets beyond normal model/provider labels and existing response content.

## Integration Closure

- Upstream surfaces consumed: `extensions/btw.ts` BTW commands, hidden thread entries, restore pipeline, and streaming helpers; README-documented BTW command contract.
- New wiring introduced in this slice: command handlers open and refresh a focused BTW overlay that drives the existing request lifecycle and transcript state instead of the widget-only surface.
- What remains before the milestone is truly usable end-to-end: preserve exact documented command/mode/restore semantics under the new modal flow, wire explicit handoff actions cleanly inside the modal, and decide slash-command behavior/fallback.

## Tasks

- [x] **T01: Wire the BTW overlay shell onto the existing thread pipeline** `est:2h`
  - Why: S01 succeeds or fails on replacing the passive widget with a focused modal without breaking the hidden-thread model that later slices depend on.
  - Files: `extensions/btw.ts`, `README.md`, `package.json`
  - Do: Refactor BTW presentation/state so command entrypoints can open a focused overlay backed by the existing `pendingThread`, `pendingMode`, restore, and streaming flow; keep a lightweight modal transcript/composer/status surface with Enter submit and Escape dismiss; make follow-up prompts run through the same BTW pipeline from inside the overlay; keep dismissal separate from thread clearing; update README only where current UX wording must acknowledge the modal shell while preserving documented thread semantics.
  - Verify: `npm pack --dry-run` and a local code inspection pass that confirms BTW commands still route through the existing hidden-thread/persistence helpers while modal state is isolated from clear/reset behavior.
  - Done when: BTW has a real overlay implementation in code, the composer can submit another turn without using the main input, Escape closes the overlay without calling thread reset, and the docs no longer claim the primary surface is only an above-editor widget.
- [x] **T02: Prove modal chat behavior in live pi interaction** `est:1h`
  - Why: The slice demo is inherently runtime behavior — focus, streaming updates, follow-up turns, and Escape dismissal need to be exercised in the real TUI before calling S01 done.
  - Files: `extensions/btw.ts`, `README.md`, `.gsd/milestones/M001/slices/S01/S01-PLAN.md`
  - Do: Run pi with the local extension, exercise the modal flow end-to-end, tighten any rough edges found during live use, and record the exact verification path that proves open-over-main-session behavior, focused input, in-place follow-up, and Escape dismissal without unintended clearing.
  - Verify: `pi -e /Users/dan/src/pi-btw` with a live interaction check covering modal open, focused composer, one follow-up in place, visible streamed answer updates, Escape dismissal, and reopen showing the same thread still available.
  - Done when: The live pi check passes as written, any issues found during that run are corrected, and the slice has a concrete runtime proof path for R001/R002/R003/R004/R008/R009.

## Files Likely Touched

- `extensions/btw.ts`
- `README.md`
- `package.json`
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md`
- `.gsd/milestones/M001/slices/S01/tasks/T01-PLAN.md`
- `.gsd/milestones/M001/slices/S01/tasks/T02-PLAN.md`
- `.gsd/STATE.md`
