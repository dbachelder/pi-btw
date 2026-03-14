# S02 — Research

**Date:** 2026-03-13

## Summary

S02 owns the contract-preservation work, not the modal shell. The active requirements this slice directly owns or materially supports are **R005** (preserve `/btw`, `/btw:new`, `/btw:clear`, `/btw:tangent` thread semantics), **R006** (keep contextual vs tangent behavior distinct), **R010** (hidden BTW thread state survives and restores correctly), and **R014** (BTW stays out of main-session context unless explicitly handed back). It also supports **R007** indirectly by preserving the hidden-thread boundary that S03 depends on. The key finding is that the current implementation already concentrates these semantics in a small set of functions: `buildBtwContext()`, `resetThread()`, `restoreThread()`, and the command handlers in `extensions/btw.ts`. That is good news: S02 should mostly be executable proof plus narrowly targeted fixes, not a new architecture pass.

The biggest surprise is how much of the contract is already encoded in hidden reset markers rather than in live UI state. `resetThread()` appends a `btw-thread-reset` entry with a `mode`, and `restoreThread()` reconstructs both `pendingMode` and the hidden thread by scanning the current branch after the last reset. That means restore semantics are branch-log driven, which is the right source of truth for S02. It also means S02 can and should test behavior by inspecting appended custom entries and reconstructed state rather than by inferring contract from modal text alone. Another notable constraint: the overlay follow-up path uses `pendingMode`, so if mode/reset semantics drift, the modal will quietly preserve the wrong contract even if the UI still “looks right.”

## Recommendation

Take a **runtime-harness-first contract-proof approach**. Extend `tests/btw.runtime.test.ts` to add explicit tests for:
- `/btw:new` clearing prior thread state and reopening a fresh contextual thread
- `/btw:tangent` building a contextless request and clearing when switching from contextual to tangent or back
- `/btw:clear` appending a reset marker, dismissing the overlay, and removing the active hidden thread from subsequent restore
- `session_start` / `session_switch` / `session_tree` rehydrating the correct thread and mode from hidden entries
- hidden BTW notes remaining excluded from main-session context via the `context` hook

Avoid broad refactors unless a failing proof forces one. The existing design already routes command entrypoints and overlay follow-ups through the same stateful core. The right S02 implementation strategy is to preserve that center of gravity and tighten proofs around it. If anything fails, fix the contract in `resetThread()`, `restoreThread()`, or command handlers first; do not patch over semantics in overlay-only code.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| BTW thread persistence and mode restore | Hidden custom entries: `btw-thread-entry` + `btw-thread-reset` in `extensions/btw.ts` | Already defines the durable contract for restore and mode separation; adding parallel state would drift from README semantics |
| Contextual vs tangent request shaping | `buildBtwContext(ctx, question, thread, mode)` | Centralizes whether main-session messages are included; S02 should prove this rather than duplicate it |
| Save-visible-note behavior without polluting hidden thread logic | `saveVisibleBtwNote()` | Keeps `--save` separate from hidden-thread persistence and lets S02 reason clearly about visible vs hidden effects |
| Main-context separation | `pi.on("context", ...)` filtering `btw-note` messages | This is the current anti-pollution boundary; preserve and test it instead of inventing another filter layer |
| Contract verification seam | `tests/btw.runtime.test.ts` harness | Already mocks overlay, session entries, commands, and model calls; cheapest path to executable contract proof |

## Existing Code and Patterns

- `extensions/btw.ts` — Source of truth for S02 contract. `resetThread()`, `restoreThread()`, `buildBtwContext()`, and the core command handlers define the semantics that must match the README.
- `extensions/btw.ts` — `resetThread(ctx, persist = true, mode = "contextual")` aborts active slots, clears in-memory thread state, sets `pendingMode`, optionally appends a `btw-thread-reset`, and syncs UI. This is the mode-switch and clear boundary.
- `extensions/btw.ts` — `restoreThread(ctx)` scans the current branch, finds the last reset marker, restores `pendingMode` from that reset, and rebuilds `pendingThread` / `slots` only from entries after it. This is the restore contract, not the modal.
- `extensions/btw.ts` — `/btw` and `/btw:tangent` explicitly call `resetThread(..., true, targetMode)` when the mode changes. That is how the README promise “modes do not mix” is currently enforced.
- `extensions/btw.ts` — `/btw:new` always calls `resetThread(ctx, true, "contextual")` before optionally asking a new question. This already matches the README’s “fresh thread, still contextual” contract.
- `extensions/btw.ts` — `/btw:clear` calls `resetThread(ctx)` and `dismissOverlay()`. This should be the only path that both clears hidden thread state and dismisses the modal.
- `extensions/btw.ts` — `buildBtwContext()` includes `buildMainMessages(ctx)` only in contextual mode; tangent mode sends no inherited main-session conversation. This is the core of R006.
- `extensions/btw.ts` — `pi.on("context", ...)` filters visible BTW notes (`btw-note`) out of the main LLM context. S02 should verify the boundary remains intact even as modal behavior changes.
- `README.md` — User-facing contract is precise: `/btw` continues, `/btw:new` clears then starts fresh contextual, `/btw:tangent` is contextless and switching modes clears, `/btw:clear` dismisses and clears, hidden state survives reload/restart and preserves mode.
- `tests/btw.runtime.test.ts` — Existing harness already proves reopen, follow-up, missing-credentials handling, and overlay mode. It is the right place to add contract tests for mode switching, reset markers, and rehydration.

## Constraints

- S02 must preserve the README semantics exactly; it is not allowed to reinterpret contextual vs tangent behavior.
- The modal is intentionally thin. Overlay state is not authoritative; hidden entries and reset markers are.
- `submitFromOverlay()` routes follow-ups with `pendingMode`, so any restore/mode bug leaks directly into the multi-turn modal UX.
- Restore behavior is branch-based: `restoreThread()` only looks at entries after the last `btw-thread-reset` in the current branch.
- Tangent mode is defined by request construction, not just label text. S02 must verify `buildBtwContext()` omits main-session messages in tangent mode.
- Main-session separation currently filters visible BTW note messages from LLM context, while hidden thread entries live in custom session entries and are not part of normal message context construction.
- Live TUI automation remains environmentally unreliable here; the established verification fallback is the Vitest runtime harness.

## Common Pitfalls

- **Testing only UI text** — A passing modal transcript does not prove the contract. Inspect reset markers, appended hidden entries, and restored state through the harness.
- **Patching semantics in overlay code** — If a command contract is wrong, fix `resetThread()`, `restoreThread()`, or the command handlers, not `ensureOverlay()`.
- **Confusing visible BTW notes with hidden thread state** — `--save` writes `btw-note` messages for the transcript, but the continuing side thread is persisted separately via hidden custom entries.
- **Assuming mode survives only in memory** — It actually survives via `btw-thread-reset` entries with `mode`; failing to preserve those entries breaks restart/session-switch truth.
- **Forgetting switch-clears-thread semantics** — `/btw` after tangent and `/btw:tangent` after contextual must reset so the modes do not mix.

## Open Risks

- The current harness does not yet expose the registered `context` hook directly, so S02 may need a small test-seam expansion to assert R014 cleanly.
- There is no existing proof yet that `session_switch` and `session_tree` restore exactly like `session_start`; this is coded, but unverified.
- `buildBtwContext()` relies on `buildSessionContext(...)`; if hidden custom entries or visible BTW notes are unexpectedly included upstream, tangent/contextual boundaries could blur without obvious UI breakage.
- The README says hidden BTW state survives reloads and restarts; the current proof story is branch restoration inside the harness, not full app lifecycle. That is acceptable for now, but the slice should be explicit about the verification class.
- S03 depends on S02 preserving the hidden-thread boundary. Any shortcut that mixes injection state into normal BTW continuation will create downstream handoff bugs.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Vitest | `onmax/nuxt-skills@vitest` | available via `npx skills add onmax/nuxt-skills@vitest` |
| TypeScript | `wshobson/agents@typescript-advanced-types` | available via `npx skills add wshobson/agents@typescript-advanced-types` |
| Pi extension authoring | `scientiacapital/skills@extension-authoring` | available via `npx skills add scientiacapital/skills@extension-authoring` |
| Pi extension authoring | `zenobi-us/dotfiles@creating-pi-extensions` | available via `npx skills add zenobi-us/dotfiles@creating-pi-extensions` |
| TUI / Ink-style design | `joelhooks/pi-tools@pi-tui-design` | available via `npx skills add joelhooks/pi-tools@pi-tui-design` |
| TUI / Ink-style design | `hyperb1iss/hyperskills@tui-design` | available via `npx skills add hyperb1iss/hyperskills@tui-design` |
| OpenAI API | none directly relevant found for this slice | none found |

## Sources

- README contract for `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, hidden thread persistence, and explicit inject/summarize behavior (source: `README.md`)
- Core contract implementation: hidden entry types, mode enum, context-building, reset/restore logic, context filtering, and command handlers (source: `extensions/btw.ts`)
- Existing executable proof harness and currently-covered runtime behaviors (source: `tests/btw.runtime.test.ts`)
- Slice boundary and forward-intelligence guidance emphasizing that S02 should focus on contract tests around `runBtw()`, `resetThread()`, and `restoreThread()` (source: `S01-SUMMARY`, preloaded context)
