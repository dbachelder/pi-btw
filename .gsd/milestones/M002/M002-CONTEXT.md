# M002: BTW sub-session — Context

**Gathered:** 2026-03-15
**Status:** Queued — pending auto-mode execution

## Project Description

Replace BTW's extension-managed state and manual `streamSimple`/`completeSimple` plumbing with a real `AgentSession` sub-session backed by `createAgentSession()` and `SessionManager.inMemory()`. BTW becomes a true side-agent with its own agent loop, tool registry, slash-command dispatch, and message lifecycle — running parallel to the main session in the same working directory with full tool access (read, bash, edit, write).

## Why This Milestone

M001 shipped a working modal side chat, but BTW still manually builds LLM context, hand-dispatches a narrow set of BTW-owned slash commands, and calls `streamSimple`/`completeSimple` directly — none of which scale. The narrow slash policy (D010) was explicitly bounded because BTW lacked a real session backing. A sub-session removes that constraint at the root: slash commands work naturally through `AgentSession.prompt()`, tools come free from the session's tool registry, compaction is handled by the session, and the agent loop manages message lifecycle properly.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Open BTW and use it as a real working side-agent: ask it to read files, run commands, edit code, and answer questions — all inside the modal overlay.
- Use any slash command inside BTW naturally, not just the narrow BTW-owned set from M001.
- Continue working in the main session while BTW is open and executing — both run in parallel.
- See the full tool-call/result transcript inside the BTW overlay, like a real mini-session.
- Use inject/summarize to explicitly hand BTW work products back to the main session.
- Dismiss BTW with Escape and have the ephemeral sub-session cleaned up.

### Entry point / environment

- Entry point: `/btw`, `/btw:new`, `/btw:tangent`, `/btw:inject`, `/btw:summarize`, `/btw:clear` commands and BTW overlay composer
- Environment: local dev in pi TUI extension runtime
- Live dependencies involved: pi extension API, `createAgentSession` SDK, `SessionManager.inMemory()`, TUI overlay/rendering, model/provider access shared with main session

## Completion Class

- Contract complete means: BTW opens a real `AgentSession` sub-session with tools and slash commands working through the session's own `prompt()` path, proven by runtime assertions.
- Integration complete means: BTW sub-session runs parallel to the main session in the same cwd, shares the same model/provider, and the overlay renders tool calls and results as a real transcript.
- Operational complete means: ephemeral sub-session lifecycle is clean — created on BTW open, disposed on BTW dismiss, no leaked resources, no stale agent loops.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A user can open BTW, ask it to read a file, see the tool call and result in the overlay transcript, and get an answer — all without leaving the modal.
- A user can type a slash command (not just BTW-owned ones) inside the BTW overlay and have it execute through the sub-session's agent loop.
- The main session continues accepting input and streaming while BTW is open and actively running tools.
- Dismissing BTW with Escape disposes the sub-session cleanly — no orphaned agent loops, no leaked abort controllers.
- Inject/summarize still work to hand BTW content back to the main session explicitly.

## Risks and Unknowns

- `createAgentSession()` may not be designed for concurrent use alongside the main session in the same process — this matters because both sessions share the same event loop, model registry, and potentially bash execution.
- Extension loading for the sub-session may conflict with the main session's extension runner — this matters because `createAgentSession()` calls `loadExtensions` and the sub-session should probably not load extensions at all (or load a minimal set).
- The TUI overlay currently renders simple text (question/answer slots) — upgrading it to render a full tool-call/result transcript requires significant rendering work and may need to hook into the sub-session's event stream.
- Sharing cwd with no write coordination means both agents can edit the same file simultaneously — this is accepted as user's responsibility (no guardrails), but could produce confusing outcomes.
- The `AgentSession` API exposes `prompt()` for slash commands, but some commands may assume they're running in the primary interactive session and access UI or session state that doesn't exist in the BTW sub-session context.
- Ephemeral `SessionManager.inMemory()` means BTW thread state no longer survives pi restarts — this is a deliberate tradeoff, but the restore behavior from M001 changes (hidden custom entries for thread persistence may need rethinking or removal).

## Existing Codebase / Prior Art

- `extensions/btw.ts` — current BTW implementation with manual `streamSimple`/`completeSimple` calls, hand-built context, custom slash dispatch, overlay rendering, and hidden-entry thread persistence.
- `tests/btw.runtime.test.ts` — M001 runtime proof covering modal behavior, command semantics, restore, handoff, and slash fallback. This test surface will need significant updates.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.d.ts` — `createAgentSession()` and `CreateAgentSessionOptions` define the sub-session creation surface.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts` — `AgentSession` class with `prompt()`, `subscribe()`, `dispose()`, tool management, and event stream.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.d.ts` — `SessionManager.inMemory()` for ephemeral sessions.
- `README.md` — current user contract for BTW semantics.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001 — BTW modal supports real multi-turn side chat. Sub-session makes this a proper agent conversation, not manual stream management.
- R002 — BTW opens quickly and stays lightweight. Ephemeral in-memory session keeps startup fast; must verify `createAgentSession` overhead is acceptable.
- R004 — BTW takes keyboard focus while open. Unchanged — overlay still captures input.
- R012 — Slash-command support. Sub-session solves this at the root — commands run through `prompt()` natively instead of hand-dispatch.
- R015 — Full parity with main-session slash commands (currently deferred). Sub-session may advance or fully satisfy this.

## Scope

### In Scope

- Replace BTW's manual `streamSimple`/`completeSimple` plumbing with a real `AgentSession` sub-session via `createAgentSession()`.
- Use `SessionManager.inMemory()` for ephemeral sub-session state.
- Give the sub-session full tools (read, bash, edit, write) and natural slash-command dispatch via `prompt()`.
- Share the main session's model, provider, and cwd with the sub-session.
- Run the sub-session parallel to the main session — no blocking.
- Render full tool-call/result transcript in the BTW overlay.
- Clean sub-session lifecycle: create on open, dispose on dismiss, no leaks.
- Preserve explicit inject/summarize handoff to the main session.
- Update the BTW overlay rendering to handle tool calls, tool results, and multi-turn agent output.

### Out of Scope / Non-Goals

- Write coordination or conflict prevention between BTW and main session.
- Persistent BTW sub-sessions that survive pi restart.
- Loading extensions inside the BTW sub-session (it should run with tools only, not recursively load extensions).
- Turning BTW into a full peer workspace with session switching, forking, or branching.
- Changing the explicit handoff model (inject/summarize stay as-is).

## Technical Constraints

- The sub-session must not recursively load extensions — it needs tools and agent loop, not a full extension runtime.
- `createAgentSession()` options must be configured to skip or minimize extension loading.
- The sub-session's system prompt should reflect its role as a side-agent (adapted from current `BTW_SYSTEM_PROMPT`).
- Ephemeral session means no hidden custom entries for thread persistence — the sub-session's own in-memory state replaces the current `btw-thread-entry`/`btw-thread-reset` pattern for the active thread (though entries may still be needed for restore-on-reopen within a single pi run).
- The overlay must handle async tool execution and streaming output without blocking the main TUI event loop.

## Integration Points

- `createAgentSession()` SDK — sub-session creation, tool and model configuration.
- `AgentSession.prompt()` — slash command dispatch and agent loop entry.
- `AgentSession.subscribe()` — event stream for rendering tool calls, results, and assistant output in the overlay.
- `AgentSession.dispose()` — clean shutdown on BTW dismiss.
- `SessionManager.inMemory()` — ephemeral session backing.
- Main session model/provider — shared model registry and API key resolution.
- TUI overlay rendering — upgrade from simple text slots to full transcript rendering.
- Existing inject/summarize handoff — adapting `sendThreadToMain` to extract content from the sub-session rather than manual thread state.

## Open Questions

- Does `createAgentSession()` support skipping extension loading entirely, or does it always try to load extensions? — Current thinking: pass empty `customTools` and configure options to minimize; may need to inspect the implementation or pass a flag.
- How does the sub-session share the main session's model and API key? — Current thinking: pass the same `Model` object and `modelRegistry` from the main session's extension context.
- Can two `AgentSession` instances run concurrently in the same Node.js process without interfering? — Current thinking: likely yes since they're independent state machines, but bash execution and file system access are inherently shared. Need to verify no global state conflicts.
- How should the BTW overlay render tool calls and results? — Current thinking: subscribe to the sub-session's event stream and render entries as they arrive, similar to how the main TUI renders agent output but in a compact overlay format.
- What happens to the existing hidden-entry thread persistence model? — Current thinking: within a single pi run, the sub-session's in-memory state replaces manual thread tracking. Cross-restart restore is dropped (ephemeral). Hidden entries may still be useful for the inject/summarize handoff path.
