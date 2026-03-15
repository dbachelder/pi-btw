# S04: Contract hardening and cleanup

**Goal:** Harden the runtime test suite to cover the full M002 contract, update all M001 assertions for the sub-session model, and remove dead M001 plumbing that the sub-session replaces.
**Demo:** `npm test` passes with comprehensive coverage of sub-session lifecycle, event-driven transcript, slash dispatch, handoff, parallel execution, and mode semantics. No dead code from the manual stream/context/slash-dispatch era remains.

## Must-Haves

- All M001 contract assertions are updated for the sub-session model (or removed if no longer applicable)
- New assertions cover: sub-session creation, tools active, dispose on Escape, dispose on /btw:clear, mode switching creates new sub-session, event-to-transcript mapping, slash routing through prompt, inject/summarize from sub-session messages, parallel execution
- Dead M001 plumbing removed: manual `streamSimple`/`completeSimple` calls, `buildBtwContext()`, `BtwSlot` model (replaced by transcript entries), hand-built slash dispatch in `submitFromOverlay()`, unsupported-slash fallback warning
- README updated to reflect BTW as a real sub-session with tool access
- Context filtering still excludes BTW sub-session activity from main-session context

## Verification

- `npm test -- tests/btw.runtime.test.ts` — all assertions pass
- `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts` returns no hits (dead code removed)
- Manual: full BTW workflow in live pi — open, ask with tool use, slash command, inject, dismiss

## Tasks

- [ ] **T01: Update test harness for sub-session model** `est:1h`
  - Why: The M001 test harness mocks `streamSimple`/`completeSimple` — it needs to mock `createAgentSession` or the Agent layer instead, and assert on sub-session lifecycle events.
  - Files: `tests/btw.runtime.test.ts`
  - Do: Replace `streamSimpleMock`/`completeSimpleMock` with a mock `createAgentSession` that returns a controllable fake `AgentSession` (with `prompt()`, `subscribe()`, `dispose()`, `messages`, `isStreaming`, `state`). Update existing M001 assertions to work against the sub-session model. Add new assertions for: sub-session created on BTW open, tools include read/bash/edit/write, dispose called on Escape, dispose called on /btw:clear, /btw:new disposes old and creates new, mode switch disposes and recreates with correct context. Preserve all M001 contract assertions that still apply (handoff, mode semantics, context filtering).
  - Verify: `npm test` passes with updated and new assertions
  - Done when: test harness exercises sub-session lifecycle and the mock infrastructure supports the new model

- [ ] **T02: Add transcript, slash, and parallel assertions** `est:45m`
  - Why: S02 and S03 introduced event-driven transcript and slash dispatch — these need contract-grade assertions.
  - Files: `tests/btw.runtime.test.ts`
  - Do: Add assertions for: tool-call events produce transcript entries, tool-result events populate results, streaming events update assistant text, slash input routes through prompt, inject extracts from sub-session messages, summarize generates summary from sub-session, main session independence from BTW streaming state. Cover edge cases: dispose during active tool execution, inject with empty sub-session, slash command that fails.
  - Verify: `npm test` passes with all new assertions
  - Done when: transcript rendering, slash dispatch, handoff, and parallel execution have named runtime assertions

- [ ] **T03: Remove dead M001 plumbing and update README** `est:30m`
  - Why: The manual stream/context/slash-dispatch code from M001 is dead weight now that the sub-session handles everything. Clean it up.
  - Files: `extensions/btw.ts`, `README.md`
  - Do: Remove: `buildBtwContext()`, `buildMainMessages()`, direct `streamSimple`/`completeSimple` imports and calls, `BtwSlot` type and `slots[]` state, `BtwDetails` for manual thread entries (if fully replaced), the manual `parseOverlaySlashCommand()` + `dispatchBtwCommand()` hand-dispatch path, the unsupported-slash fallback warning. Keep: BTW command registration, overlay component, inject/summarize handoff, context filtering hook, and any hidden-entry persistence that's still needed. Update README to document BTW as a real sub-session with tool access and native slash commands.
  - Verify: `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts` returns no hits; `npm test` still passes; README accurately describes M002 behavior
  - Done when: no dead M001 plumbing remains and README reflects the sub-session reality

## Files Likely Touched

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
- `README.md`
