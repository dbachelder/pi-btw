# M002: BTW sub-session

**Vision:** Replace BTW's manual stream/context plumbing with a real `AgentSession` sub-session, making BTW a true working side-agent with full tools, native slash commands, parallel execution, and a rich tool-call transcript — while keeping the disposable, lightweight BTW feel.

## Success Criteria

- User can open BTW, ask it to read a file, and see the tool call and result rendered in the overlay transcript
- User can type any slash command in the BTW overlay and have it execute through the sub-session's own command dispatch
- Main session continues accepting input and streaming while BTW is actively running tools in the overlay
- Dismissing BTW with Escape cleanly disposes the sub-session with no orphaned agent loops or leaked resources
- Inject/summarize still hand BTW content back to the main session explicitly
- BTW opens fast enough that the sub-session creation overhead is not perceptible

## Key Risks / Unknowns

- `createAgentSession()` may have hidden startup cost or global state that conflicts with the main session — this matters because two `AgentSession` instances sharing a process is novel territory for the SDK
- The overlay rendering must show tool calls/results from the agent event stream — this matters because the current `BtwSlot` model is text-only and replacing it with a rich transcript is the largest implementation surface
- `AgentSession.prompt()` without `bindExtensions()` won't dispatch extension-registered commands — this matters because some slash commands (like `/btw` itself) are extension commands, not built-in

## Proof Strategy

- `createAgentSession` concurrency risk → retire in S01 by creating a real in-memory sub-session alongside the main session and running `prompt()` through the agent loop with tool execution
- Overlay rendering risk → retire in S02 by rendering real agent events (tool calls, tool results, assistant streaming) in the overlay from the sub-session's event stream
- Extension command dispatch gap → retire in S03 by binding a minimal extension subset (or documenting which commands work/don't) and proving slash commands route through `prompt()`

## Verification Classes

- Contract verification: Vitest runtime harness asserting sub-session creation, lifecycle, event dispatch, overlay state, and handoff — extending the M001 `tests/btw.runtime.test.ts` pattern
- Integration verification: real `createAgentSession()` with `SessionManager.inMemory()` exercised in the test harness with mocked LLM/tool responses
- Operational verification: sub-session dispose on Escape, no leaked subscriptions or abort controllers after dismiss
- UAT / human verification: live pi session demonstrating BTW with tool use and parallel main-session interaction

## Milestone Definition of Done

This milestone is complete only when all are true:

- BTW opens a real `AgentSession` sub-session via `createAgentSession()` with `SessionManager.inMemory()`
- The sub-session has full coding tools (read, bash, edit, write) working through the agent loop
- The overlay renders tool calls, tool results, and streaming assistant output from the sub-session event stream
- Slash commands typed in the BTW overlay route through `prompt()` and execute
- The main session is not blocked while BTW is open and actively executing
- Escape dismisses BTW and disposes the sub-session cleanly
- Inject/summarize extract content from the sub-session and hand it to the main session
- The existing test harness is updated to cover sub-session creation, lifecycle, event rendering, and handoff
- Success criteria are re-checked against runtime assertions, not just code artifacts

## Requirement Coverage

- Covers: R015, R020, R021, R022, R023
- Partially covers: R001 (sub-session makes multi-turn more natural), R002 (must verify startup speed), R014 (separation maintained through separate session)
- Leaves for later: R016 (full embedded workspace)
- Orphan risks: none

## Slices

- [x] **S01: Sub-session lifecycle and agent loop** `risk:high` `depends:[]`
  > After this: user opens BTW and it creates a real `AgentSession` sub-session with tools; submitting a question runs through the agent loop with tool execution, and Escape disposes the sub-session cleanly. Transcript still shows basic text (not yet full tool-call rendering).

- [x] **S02: Overlay transcript rendering from agent events** `risk:medium` `depends:[S01]`
  > After this: user sees tool calls, tool results, thinking, and assistant streaming rendered inline in the BTW overlay as the sub-session executes — a real mini-session transcript instead of simple Q&A slots.

- [x] **S03: Slash commands, handoff, and parallel execution** `risk:medium` `depends:[S01]`
  > After this: user can type slash commands in BTW that route through the sub-session, use inject/summarize to hand content back to the main session, and the main session continues working while BTW runs in parallel.

- [ ] **S04: Contract hardening and cleanup** `risk:low` `depends:[S01,S02,S03]`
  > After this: runtime test suite covers sub-session lifecycle, event rendering, slash dispatch, handoff, and parallel execution — all M001 contract assertions are updated for the sub-session model, and dead M001 plumbing (manual streamSimple, hand-built context, custom slash dispatch) is removed.

## Boundary Map

### S01 → S02

Produces:
- `createBtwSubSession()` helper in `extensions/btw.ts` — creates an `AgentSession` with `SessionManager.inMemory()`, shared model/modelRegistry, coding tools, BTW system prompt, and no extension binding
- `BtwSubSession` lifecycle contract — `create()` on BTW open, `dispose()` on Escape/clear, `session.prompt()` for input, `session.subscribe()` for events
- `AgentSessionEvent` stream from the sub-session — consumed by S02 for transcript rendering
- Sub-session state replaces `BtwSlot[]` and `pendingThread[]` as the source of truth for BTW thread content

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- `AgentSession.prompt()` as the input path — S03 uses this for slash command routing
- `session.messages` / `session.getLastAssistantText()` — S03 reads these for inject/summarize content extraction
- Sub-session abort/dispose contract — S03 depends on this for clean parallel execution

Consumes:
- nothing (first slice)

### S02 → S04

Produces:
- `BtwTranscriptEntry` types and `buildOverlayTranscript()` rewritten for agent events — rendering infrastructure that S04 hardens
- Overlay refreshes driven by sub-session event subscription — the reactive rendering pipeline

Consumes from S01:
- `AgentSessionEvent` stream from sub-session subscription

### S03 → S04

Produces:
- Slash command dispatch through `prompt()` — exercised by S04's contract assertions
- Updated `sendThreadToMain()` extracting from sub-session messages instead of `pendingThread[]`
- Parallel execution contract — main session not blocked during BTW tool execution

Consumes from S01:
- `AgentSession.prompt()` input path
- Sub-session message access for handoff content
