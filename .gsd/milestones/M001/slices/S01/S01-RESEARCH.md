# M001/S01 — Research

**Date:** 2026-03-13

## Summary

S01 owns or directly supports the slice requirements around the new modal shell itself: **R001, R002, R003, R004, R008, R009**, and it supports **R005** as the UI surface through which the existing command semantics will continue to run. The core finding is that pi already exposes the exact class of UI primitive this slice needs: a **focused custom overlay** via `ctx.ui.custom(..., { overlay: true })`, plus built-in `Input`/`Editor` components and explicit keyboard handling for `Enter` and `Escape`. So the main S01 risk is no longer "can pi render a modal chat shell?" — it can. The real work is wiring that overlay to BTW’s existing completion, persistence, and restore pipeline without breaking the lightweight feel or the current thread contract.

The current BTW implementation is entirely command-driven and widget-only. `extensions/btw.ts` persists hidden side-thread entries with `pi.appendEntry(...)`, rehydrates them on `session_start` / `session_switch` / `session_tree`, filters BTW notes out of main context via the `context` hook, and renders transcript state with `ctx.ui.setWidget("btw", ...)` above the editor. What it does not have is any focused input surface, modal lifecycle, or key handling. That means S01 should not replace BTW’s data model first; it should add a modal controller that reuses `runBtw()`, `buildBtwContext()`, `restoreThread()`, and the existing `pendingThread` / `pendingMode` semantics while swapping the presentation layer from passive widget to active overlay.

## Recommendation

Build S01 around a **real custom overlay component** instead of trying to stretch the existing above-editor widget into an interactive shell.

Recommended shape:
- Keep the current hidden-thread storage model (`BTW_ENTRY_TYPE`, `BTW_RESET_TYPE`, `pendingThread`, `pendingMode`) intact.
- Keep the current completion pipeline intact (`buildBtwContext()`, `streamSimple()`, summary/inject logic later).
- Introduce a modal/overlay controller opened by BTW commands when UI is available.
- Implement the composer with a built-in `Editor` or `Input` inside `ctx.ui.custom(..., { overlay: true })`.
- Let the overlay own focus while open; `Enter` submits a follow-up turn, `Escape` dismisses the modal, and render updates come from local component state + `tui.requestRender()`.
- Treat the old widget as a compatibility/fallback surface for non-interactive or minimal cases rather than the primary S01 UX.

Why this approach:
- It directly satisfies **R003/R004/R008** with the platform’s intended modal/focus APIs, instead of inventing a fake modal out of a widget plus raw input interception.
- It preserves the current hidden persistence model, which reduces risk for later **R005/R010/R014** work in S02.
- It keeps BTW lightweight because the overlay can be narrowly scoped to transcript + composer + status, without turning BTW into a second editor or session workspace.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Floating modal over existing UI | `ctx.ui.custom(..., { overlay: true, overlayOptions })` | This is pi’s built-in focused overlay mechanism and matches the desired modal behavior directly. |
| Focused text entry in custom UI | `Editor` / `Input` from `@mariozechner/pi-tui` | Avoids raw terminal text handling and gives cursor/editing behavior for free. |
| Escape / Enter handling | `matchesKey(data, Key.escape|Key.enter)` | Standard pi TUI key handling; consistent with existing overlay examples. |
| BTW hidden persistence | `pi.appendEntry(...)` + restore on session events | Already matches the current BTW contract and survives reloads/restores. |
| Visible message rendering for saved notes | `pi.registerMessageRenderer(...)` | Already implemented; no need to redesign message display for S01. |

## Existing Code and Patterns

- `extensions/btw.ts` — Current BTW implementation. Reuse `buildBtwContext()`, `runBtw()`, `restoreThread()`, `resetThread()`, and the hidden-entry types instead of replacing BTW state management.
- `extensions/btw.ts` — `renderWidget()` shows the current transcript rendering assumptions. Useful as a starting point for transcript formatting, but it is passive UI only and should not be stretched into the modal shell.
- `README.md` — Source-of-truth contract for `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, `/btw:summarize`. S01 must not silently redefine these semantics.
- `/Users/dan/src/gsd-2/packages/pi-coding-agent/src/core/extensions/types.ts` — Confirms `ctx.ui.custom`, `overlay`, `overlayOptions`, `setWidget`, `input`, `editor`, and raw terminal listener APIs exist.
- `/Users/dan/src/gsd-2/docs/extending-pi/12-custom-ui-visual-components.md` — Documents focused custom components, overlays, built-in `Input`, and keyboard handling; this is the primary implementation guide for the modal shell.
- `/Users/dan/src/gsd-2/docs/pi-ui-tui/06-ctx-ui-custom-full-custom-components.md` — Shows the expected custom component pattern: local state, `render(width)`, `handleInput(data)`, `done(...)`, and `tui.requestRender()`.
- `/Users/dan/src/gsd-2/docs/pi-ui-tui/12-overlays-floating-modals-and-panels.md` — Confirms overlays render over existing content, preserve the main session behind them, and route focus to the topmost overlay.
- `/Users/dan/src/gsd-2/src/resources/extensions/get-secrets-from-user.ts` — Real extension example using `ctx.ui.custom()` with an `Editor` and explicit Enter/Escape handling. Good reference for BTW composer wiring.
- `/Users/dan/src/gsd-2/src/resources/extensions/gsd/dashboard-overlay.ts` — Real overlay component class. Useful reference for longer-lived overlay structure and Escape dismissal.

## Constraints

- S01’s owned requirements are **R001, R002, R003, R004, R008, R009**; it also supports **R005** because the shell cannot make future contract-preservation work harder.
- The current BTW implementation stores side-thread state in extension-private custom entries (`BTW_ENTRY_TYPE`, `BTW_RESET_TYPE`) and reconstructs from branch history; changing that storage model in S01 would raise unnecessary S02 risk.
- `ctx.ui.custom()` is blocking from the command handler’s point of view, but the overlay component itself can remain interactive and submit multiple turns internally before calling `done()`. That is the right fit for a multi-turn modal shell.
- Widgets (`ctx.ui.setWidget`) are persistent but not focused input surfaces. They are suitable for transcript/status display but not for the core composer UX required by **R004/R009**.
- Overlay components are disposed when closed. Any modal instance/state must be recreated on reopen rather than reused from stale references.
- BTW currently streams via `streamSimple()` into slot state and re-renders on deltas. The overlay will need the same invalidation behavior, likely by sharing or adapting the `slots` model.
- `Escape` today has no BTW-specific modal meaning because there is no modal. In S01 it must dismiss the overlay quickly without implying `btw:clear`; thread clearing remains an explicit command concern under the documented contract.

## Common Pitfalls

- **Using `setWidget()` as the primary modal implementation** — Widgets render above/below the editor but do not take focus. Use a real overlay for the shell and keep widget rendering as fallback/auxiliary UI.
- **Coupling dismissal to thread reset** — `Escape` should close the modal, not automatically clear hidden thread state. Clearing is a separate command/contract path.
- **Rewriting BTW persistence too early** — S01 does not need a new storage scheme. Reuse `appendEntry` + restore logic first, then verify behavior before any deeper refactor.
- **Submitting follow-ups through the main editor** — That would fail **R004/R009** and recreate the current bounce-back UX. The overlay must own its own composer and submit path.
- **Hand-parsing raw terminal text when `Editor`/`Input` already exists** — Use built-in components unless a specific UX gap forces lower-level handling.
- **Forgetting overlay disposal rules** — Never assume a dismissed modal instance can be revived; reopen with a fresh component instance.

## Open Risks

- The existing `runBtw()` function is command-oriented and mutates module-level `slots` / `widgetStatus` with widget rendering side effects. It will likely need a light refactor so the overlay can drive the same request lifecycle without duplicating streaming logic.
- There is an architectural choice between keeping the old widget visible behind the modal, replacing it entirely while the modal is open, or using the overlay as the only surface. The wrong choice could make BTW feel heavier or visually redundant.
- Multi-turn overlay flow may expose new concurrency edge cases: e.g. one request still streaming while the user dismisses, reopens, or starts a second prompt. S01 should define clear single-modal/single-stream invariants.
- Slash-command behavior inside the modal is not needed for S01, but the composer should not be painted into a corner. Avoid an implementation that makes later scoped parsing impossible.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| BTW workflow | `btw` | installed |
| pi extension authoring | `scientiacapital/skills@extension-authoring` | available |
| pi extension authoring | `zenobi-us/dotfiles@creating-pi-extensions` | available |
| terminal UI | `pproenca/dot-skills@terminal-ui` | available |
| terminal UI | `mhagrelius/dotfiles@building-tui-apps` | available |

## Sources

- Pi already supports focused floating overlays via `ctx.ui.custom(..., { overlay: true })`, which is the right primitive for the BTW modal shell (source: `/Users/dan/src/gsd-2/docs/extending-pi/12-custom-ui-visual-components.md`).
- Overlays render on top of existing content and keep the underlying screen visible, which aligns with BTW’s modal-over-main-session requirement (source: `/Users/dan/src/gsd-2/docs/pi-ui-tui/12-overlays-floating-modals-and-panels.md`).
- Built-in `Input` and `Editor` components exist for focused text entry in custom TUI surfaces, avoiding raw terminal text handling (source: `/Users/dan/src/gsd-2/docs/pi-ui-tui/07-built-in-components-the-building-blocks.md`).
- Current BTW stores hidden thread state with `pi.appendEntry(...)`, restores from branch history, and filters BTW notes out of main LLM context via the `context` hook (source: `extensions/btw.ts`).
- The README contract explicitly says `/btw` continues the side thread, `/btw:tangent` is contextless, mode switches clear the prior side thread, and `/btw:clear` dismisses and clears (source: `README.md`).
- Real extension examples show `ctx.ui.custom()` with `Editor`, Enter submit, Escape cancel, cached render lines, and explicit `tui.requestRender()` — a direct fit for BTW composer implementation style (source: `/Users/dan/src/gsd-2/src/resources/extensions/get-secrets-from-user.ts`, `/Users/dan/src/gsd-2/src/resources/extensions/remote-questions/remote-command.ts`).
- Pi extension types confirm the relevant UI and lifecycle APIs: dialogs, widgets, custom overlays, editor control, raw terminal input listeners, and session events (source: `/Users/dan/src/gsd-2/packages/pi-coding-agent/src/core/extensions/types.ts`, `/Users/dan/src/gsd-2/docs/extending-pi/07-events-the-nervous-system.md`, `/Users/dan/src/gsd-2/docs/extending-pi/13-state-management-persistence.md`).
