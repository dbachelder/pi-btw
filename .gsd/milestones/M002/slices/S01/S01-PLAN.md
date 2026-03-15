# S01: Sub-session lifecycle and agent loop

**Goal:** Replace BTW's manual `streamSimple`/`completeSimple` plumbing with a real `AgentSession` sub-session created via `createAgentSession()` with `SessionManager.inMemory()`. The sub-session has full coding tools and runs through the proper agent loop. Escape disposes it cleanly.
**Demo:** User opens BTW, types a question, and it runs through the real agent loop — tools execute, the agent streams back an answer, and Escape disposes the session. Transcript rendering still uses simplified text (agent event rendering comes in S02).

## Must-Haves

- BTW creates a real `AgentSession` via `createAgentSession({ sessionManager: SessionManager.inMemory(), model, modelRegistry, tools: codingTools })` when opened
- The sub-session shares the main session's model and model registry (no duplicate auth)
- `session.prompt(question)` drives the agent loop — not `streamSimple()`
- The sub-session has read, bash, edit, write tools active
- Escape calls `session.dispose()` and aborts any in-flight agent work
- No extension runner is bound on the sub-session (skip `bindExtensions()`)
- The sub-session's system prompt includes the BTW side-agent role description
- Creating the sub-session is fast enough that opening BTW doesn't feel sluggish (< 200ms overhead)

## Proof Level

- This slice proves: integration (real `createAgentSession()` exercised with in-memory session)
- Real runtime required: yes (actual `AgentSession` created, though LLM/tools are mocked in tests)
- Human/UAT required: yes (startup speed perception)

## Verification

- `npm test -- tests/btw.runtime.test.ts` — updated harness asserting sub-session creation, prompt routing through agent loop, tool activation, Escape dispose, and no leaked resources
- Manual: open BTW in live pi, verify tool execution appears in the overlay

## Observability / Diagnostics

- Runtime signals: sub-session event stream via `session.subscribe()` — tool_execution_start/end, message_start/update/end
- Inspection surfaces: `session.state` for agent state, `session.isStreaming` for activity
- Failure visibility: agent errors surface through the event stream; dispose failures would leave `overlayRuntime` in inconsistent state

## Integration Closure

- Upstream surfaces consumed: `createAgentSession` SDK, `SessionManager.inMemory()`, `ModelRegistry`, `codingTools`, `AgentSession` event stream
- New wiring introduced in this slice: BTW command handlers create/dispose real AgentSession instead of calling streamSimple
- What remains before the milestone is truly usable end-to-end: rich transcript rendering (S02), slash commands and handoff (S03), contract hardening (S04)

## Tasks

- [ ] **T01: Create sub-session helper and wire into BTW open** `est:1h`
  - Why: This is the core change — replacing manual LLM calls with a real AgentSession. Everything else depends on this.
  - Files: `extensions/btw.ts`
  - Do: Write `createBtwSubSession(ctx)` that calls `createAgentSession()` with `SessionManager.inMemory()`, the main session's model (from `ctx.model`) and `ctx.modelRegistry`, `codingTools` as tools, a custom BTW system prompt, and no extension binding. Wire this into the BTW open path so `/btw`, `/btw:new`, and `/btw:tangent` create a sub-session instead of calling `streamSimple()` directly. Replace `runBtw()` to call `btwSession.prompt(question)`. Subscribe to the sub-session's event stream and feed simplified text into the existing `BtwSlot` model (bridge — S02 replaces this). Handle contextual mode by injecting main-session messages into the sub-session context via `before_agent_start` or by prepending to the prompt. Handle tangent mode by using a clean sub-session with no main-session context.
  - Verify: `npm test -- tests/btw.runtime.test.ts` passes with updated assertions; `/btw question` creates a sub-session, runs prompt, and produces an answer
  - Done when: BTW questions route through `AgentSession.prompt()` and the agent loop, not through manual `streamSimple`

- [ ] **T02: Sub-session dispose on Escape and /btw:clear** `est:45m`
  - Why: Clean lifecycle is critical — no leaked agent loops, abort controllers, or subscriptions after dismiss.
  - Files: `extensions/btw.ts`
  - Do: Wire Escape dismissal to call `btwSession.abort()` then `btwSession.dispose()`. Wire `/btw:clear` to dispose the sub-session as well. Handle the case where the sub-session is mid-stream (tool executing, LLM streaming) — abort must be clean. Ensure `/btw:new` disposes the old sub-session before creating a fresh one. Track the active sub-session reference and null it on dispose. Verify no event listeners remain subscribed after dispose.
  - Verify: runtime assertions that dispose is called on Escape, `session.isStreaming === false` after abort, no lingering subscriptions
  - Done when: Escape and /btw:clear cleanly dispose the sub-session with no resource leaks

- [ ] **T03: Mode handling and sub-session context** `est:45m`
  - Why: Contextual mode must feed main-session messages into the sub-session; tangent mode must not. This replaces `buildBtwContext()`.
  - Files: `extensions/btw.ts`
  - Do: For contextual mode, prepend main-session messages (from `buildMainMessages()`) as context before the user's question — either via the sub-session's system prompt or by injecting messages through `session.sendCustomMessage()`. For tangent mode, the sub-session starts clean with only the BTW system prompt. Handle mode switches (`/btw:tangent` after `/btw`) by disposing the old sub-session and creating a new one with the appropriate context. Preserve the BTW system prompt as a preamble in all modes.
  - Verify: runtime assertions that contextual mode includes main-session messages in the sub-session context and tangent mode does not
  - Done when: mode behavior matches M001 semantics — contextual gets main-session context, tangent gets none

## Files Likely Touched

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
- `package.json` (if new imports needed)
