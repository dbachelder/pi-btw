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
