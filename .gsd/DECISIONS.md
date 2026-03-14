# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| D001 | M001 | scope | BTW interaction model | Replace the current one-turn widget flow with a lightweight modal multi-turn side chat | The user wants a real inline chat interaction without turning BTW into a full second workspace | No |
| D002 | M001 | convention | BTW behavioral contract | Preserve the current README-documented semantics for `/btw`, `/btw:new`, `/btw:clear`, and `/btw:tangent` | The user explicitly wants the interaction model changed without changing BTW thread semantics | No |
| D003 | M001 | pattern | Main-session boundary | Keep BTW handoff to the main session explicit via inject/summarize-style actions | The user wants BTW to remain a tangent and not auto-pollute the main session | No |
| D004 | M001 | scope | Slash-command ambition | Treat broad slash-command support as desirable but feasibility-sensitive | The user wants to see what is possible, but not at the cost of making BTW heavy or messy | Yes — if pi exposes a clean embedded command surface |
| D005 | M001/S01 | pattern | BTW modal architecture | Keep hidden BTW entries and reset markers as the source of truth and layer the modal over them via `ctx.ui.custom(..., { overlay: true })` | This preserves existing thread semantics for later slices while replacing the interaction surface | No |
| D006 | M001/S01 | verification | Pi TUI fallback proof | Use a narrow Vitest runtime harness for overlay/thread/error semantics when full live TUI automation is blocked by environment issues | The modal contract still needs executable proof even when terminal automation is unavailable | Yes — live TUI proof should supersede it when available |
| D007 | M001/S02 | verification | BTW contract gate | Treat `tests/btw.runtime.test.ts` as the executable gate for BTW command, restore, and context-boundary semantics, and only change production helpers when a named contract assertion fails | This keeps hidden entries and reset markers authoritative and avoids speculative churn in `extensions/btw.ts` | Yes — if broader runtime coverage later proves this gate insufficient |
