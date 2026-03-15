# BTW freeze findings

Date: 2026-03-14
Context: local dev path version of `pi-btw` loaded from `~/src/pi-btw`

## Issue

Running `/btw` opens the modal, submits the first prompt, then pi appears to lock up:
- the modal remains visible
- the transcript does not update with the assistant response
- typing and Escape appear non-functional while the BTW request is in flight

## Evidence

### Observable behavior
- User report: the entire pi agent loop feels locked while BTW is running.
- Screenshot evidence shows:
  - modal is rendered
  - prompt `hi` is already in transcript
  - status shows `0 exchanges · streaming`
  - transcript shows in-flight placeholders (`thinking...`, `streaming...`)
  - no assistant response has appeared

This rules out "modal failed to open" and strongly suggests the BTW request never progressed past initial placeholder state.

### Relevant production code
File: `extensions/btw.ts`

#### Overlay startup currently blocks until dismissal
`ensureOverlay()` does:

- `await ctx.ui.custom<void>(...)`

The overlay calls `done()` only on dismissal.

#### BTW request waits for overlay startup to finish
`runBtw()` does:
- create slot / set status
- `await ensureOverlay(ctx)`
- only **after that** call `streamSimple(...)`
- then consume `for await (const event of stream)`

If `ensureOverlay()` does not return until dismissal, then the stream never starts while the modal is open.

#### Overlay component is also missing container-level keyboard forwarding
`BtwOverlayComponent`:
- has `focused` getter/setter
- wires `input.onSubmit` and `input.onEscape`
- does **not** implement `handleInput(data: string)`

In real pi-tui, focused components receive key events through `handleInput()`.

### Framework / example evidence
Checked:
- `/Users/dan/src/gsd-2/packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts`
- `/Users/dan/src/gsd-2/packages/pi-tui/src/tui.ts`
- `/Users/dan/src/gsd-2/packages/pi-coding-agent/src/modes/interactive/components/extension-input.ts`
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/qna.ts`
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/overlay-test.ts`

Findings:
- `ctx.ui.custom()` in interactive mode returns a `Promise<T>` that resolves only when `done(result)` is called.
- Overlay mode still behaves this way; showing the overlay does **not** resolve the promise.
- `showExtensionCustom()` in interactive mode wraps `ctx.ui.custom()` in a promise and only resolves inside the close path.
- `Focusable` only requires `focused: boolean`; missing `focus()` / `unfocus()` is **not** the primary issue.
- Real interactive components implement `handleInput()` and forward key events to an embedded `Input`.

## Root Cause

### Primary root cause
`ensureOverlay()` incorrectly awaits `ctx.ui.custom(...)` as if showing the overlay were non-blocking.

In reality:
- `ctx.ui.custom()` resolves only when `done()` is called
- BTW only calls `done()` on dismiss
- therefore `await ensureOverlay(ctx)` blocks until the modal is dismissed
- therefore `runBtw()` never reaches `streamSimple(...)` while the modal is open

This exactly matches the live symptom:
- modal appears
- placeholder streaming state renders
- no assistant output ever arrives
- pi feels locked because the command is still waiting inside overlay setup

### Secondary root cause
`BtwOverlayComponent` is missing `handleInput(data: string)` forwarding to the embedded `Input`.

Why this matters:
- even after fixing the blocking overlay-start bug, typing/Escape in the live modal is likely still incomplete without container-level key forwarding
- runtime tests missed this because they call `input.onSubmit` / `input.onEscape` directly instead of sending actual key events through the component

## Recommended Fix

### 1. Make overlay startup non-blocking
Refactor `ensureOverlay()` in `extensions/btw.ts` so it does **not** await `ctx.ui.custom(...)`.

Target behavior:
- launch the overlay
- capture its runtime / handle
- return immediately
- allow `runBtw()` to continue straight into `streamSimple(...)`

Current blocking pattern to replace:

```ts
const component = await ctx.ui.custom<void>(...)
void component;
```

This is the primary fix.

### 2. Add container-level keyboard forwarding on the modal component
In `BtwOverlayComponent`, add:

```ts
handleInput(data: string): void {
  this.input.handleInput(data);
}
```

If needed, branch for Enter/Escape before forwarding, but the main requirement is that the focused overlay component must forward terminal input to the embedded `Input`.

## Verification Plan

After implementing:

1. Launch pi with the local `pi-btw` checkout active.
2. Run `/btw hi`.
3. Verify:
   - assistant text begins streaming into the modal
   - modal remains responsive during the request
   - Escape dismisses
   - typing works after reopen
4. Verify follow-up inside the modal.
5. Re-run:
   - `npm test -- tests/btw.runtime.test.ts`
6. Add at least one regression test covering the non-blocking overlay-start assumption if the harness can observe it.

## Confidence / Risk

Confidence:
- Very high on the blocking `await ctx.ui.custom(...)` call being the primary issue
- High on missing `handleInput()` being a second real live-TUI bug

Risk of fix:
- Low risk to README command semantics if only overlay execution flow is changed
- Medium risk of introducing overlay lifecycle cleanup issues while refactoring startup/dismiss paths
- Medium risk of overlapping BTW requests if background execution is added without in-flight guards

## Notes

Earlier analysis that focused on command-loop blocking was directionally close but not precise enough. The stronger diagnosis is that the code blocks **before the LLM stream even starts**, because `ensureOverlay()` awaits a promise that only resolves when the modal is dismissed.
