---
estimated_steps: 5
estimated_files: 3
---

# T01: Wire the BTW overlay shell onto the existing thread pipeline

**Slice:** S01 — Modal BTW chat shell
**Milestone:** M001

## Description

Replace BTW’s widget-only interaction with a focused overlay shell that still runs on top of the current hidden-thread, restore, and streaming pipeline. This task establishes the modal transcript/composer/status surface, keeps BTW lightweight, and preserves the data/model seams S02 will need for exact contract preservation.

## Steps

1. Refactor BTW UI state so transcript rendering and request status can be driven by an overlay controller rather than only `setWidget()`.
2. Implement a focused BTW overlay with transcript region, composer, Enter submit, and Escape dismiss using pi’s custom overlay UI primitives.
3. Route overlay submissions through the existing BTW request lifecycle so follow-up turns append to the same hidden BTW thread instead of bouncing through the main editor.
4. Keep dismissal separate from reset/clear behavior, and ensure reopen can rebuild the modal from current thread state.
5. Update README wording where needed so the primary BTW UX is described as a modal shell while preserving the existing command/thread contract language.

## Must-Haves

- [ ] BTW commands can open a real focused modal without replacing the underlying hidden-thread persistence model.
- [ ] The BTW composer can submit follow-up prompts from inside the modal and streamed output appears in the modal transcript/status surface.
- [ ] Escape dismisses only the overlay; it does not invoke BTW clear/reset semantics.
- [ ] README does not misdescribe the primary BTW UI as widget-only after the implementation changes.

## Verification

- `npm pack --dry-run`
- Inspect `extensions/btw.ts` to confirm modal submit/dismiss flows still compose through existing BTW thread helpers instead of bypassing persistence.
- Confirm README command semantics still match the documented `/btw`, `/btw:new`, `/btw:tangent`, and `/btw:clear` contract.

## Observability Impact

- Signals added/changed: modal-local status/transcript/error state becomes the primary BTW runtime signal instead of widget-only state.
- How a future agent inspects this: run pi with the local extension and inspect BTW overlay behavior plus the hidden-thread rebuild path in `extensions/btw.ts`.
- Failure state exposed: overlay shows stalled/errored BTW request state without requiring the main editor to receive focus.

## Inputs

- `extensions/btw.ts` — existing BTW commands, streaming helpers, widget rendering, and hidden-thread persistence model.
- `README.md` — current contract text that must stay true even if the visual surface changes.
- `S01-RESEARCH.md` (preloaded) — overlay-first recommendation and modal lifecycle constraints.

## Expected Output

- `extensions/btw.ts` — overlay-backed BTW shell wired to current request/thread state.
- `README.md` — updated UI wording that reflects the modal shell without changing documented thread semantics.
- `package.json` — unchanged or only minimally adjusted if verification/development wiring requires it.
