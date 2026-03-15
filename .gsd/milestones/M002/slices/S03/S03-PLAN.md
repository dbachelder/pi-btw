# S03: Slash commands, handoff, and parallel execution

**Goal:** Slash commands typed in the BTW overlay route through the sub-session's `prompt()`, inject/summarize extract content from the sub-session for handoff to the main session, and the main session continues working while BTW runs tools.
**Demo:** User types `/help` in BTW and it works. User types `/btw:inject` and the sub-session's conversation is sent to the main session. User keeps working in the main session while BTW reads files in the background.

## Must-Haves

- Text starting with `/` in the BTW overlay is routed through `btwSession.prompt()` which handles command dispatch
- BTW-owned commands (`/btw:new`, `/btw:clear`, `/btw:tangent`, `/btw:inject`, `/btw:summarize`) still work with their documented semantics
- `/btw:inject` extracts the sub-session's conversation content and sends it to the main session via `pi.sendUserMessage()`
- `/btw:summarize` summarizes the sub-session's conversation and sends the summary to the main session
- The main session is not blocked while BTW is open — both sessions accept input and stream independently
- Handoff (inject/summarize) clears the BTW sub-session and dismisses the overlay

## Proof Level

- This slice proves: integration (slash dispatch through sub-session prompt, handoff across sessions, parallel execution)
- Real runtime required: yes (two AgentSession instances active simultaneously)
- Human/UAT required: yes (parallel execution perception)

## Verification

- `npm test -- tests/btw.runtime.test.ts` — assertions that slash input routes through `prompt()`, inject extracts sub-session content, summarize produces a summary, main session is never blocked during BTW execution
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state"` — inspectable failure-path proof that BTW surfaces real session errors/status without losing the recoverable sub-session state
- Manual: open BTW, run a slash command, verify it executes; inject content to main session; type in main while BTW runs

## Observability / Diagnostics

- The BTW overlay status line is the first-line runtime signal for slash dispatch, tool execution, summarize/handoff progress, and request failures.
- `BtwOverlayComponent.getTranscriptEntries()` is the inspectable diagnostic surface for sub-session state; tests should prefer it over rendered-text scraping when proving streaming, slash-routed turns, tool activity, and preserved failure state.
- Non-BTW slash input in the overlay must not emit an unsupported-slash fallback warning; if sub-session prompt handling fails, surface the real error through transcript/status/notification state instead.
- Successful inject/summarize handoff clears the BTW thread and dismisses the overlay; failed handoff preserves the sub-session for retry/recovery.
- Do not add any diagnostic path that echoes secrets beyond the existing transcript/tool-result truncation behavior.

## Integration Closure

- Upstream surfaces consumed: `AgentSession.prompt()` from S01, sub-session message state, `pi.sendUserMessage()` for handoff
- New wiring introduced in this slice: slash dispatch through sub-session `prompt()` instead of hand-dispatch; `sendThreadToMain()` rewritten to extract from sub-session messages; parallel execution proven
- What remains before the milestone is truly usable end-to-end: contract hardening (S04)

## Tasks

- [x] **T01: Route slash commands through sub-session prompt** `est:45m`
  - Why: The whole point of the sub-session is that slash commands work naturally. The M001 hand-dispatch and unsupported-slash fallback are replaced.
  - Files: `extensions/btw.ts`
  - Do: In `submitFromOverlay()`, replace the manual `parseOverlaySlashCommand()` + `dispatchBtwCommand()` + unsupported-slash fallback with a unified path: all input (text and slash commands) goes through `btwSession.prompt(value)`. BTW-owned commands (`/btw:new`, `/btw:clear`, `/btw:tangent`) need special handling — they should still be intercepted before hitting the sub-session because they control BTW lifecycle (create/dispose sub-session). Only `/btw:inject` and `/btw:summarize` need custom handling since they cross the session boundary. Everything else goes to the sub-session's `prompt()`. Remove the M001 unsupported-slash fallback warning — all commands are now potentially valid.
  - Verify: runtime assertions that non-BTW slash input goes to `prompt()`, BTW lifecycle commands still work, no unsupported-slash warnings
  - Done when: slash input in BTW overlay either routes to sub-session prompt or is handled as BTW lifecycle, with no rejected/unsupported category

- [x] **T02: Rewrite inject/summarize to extract from sub-session** `est:45m`
  - Why: Inject/summarize currently read from `pendingThread[]` which is M001's manual thread state. They need to read from the sub-session's message history instead.
  - Files: `extensions/btw.ts`
  - Do: Rewrite `sendThreadToMain()` to extract conversation content from `btwSession.messages` (or `btwSession.getLastAssistantText()` and message history). For inject: format the sub-session's conversation as user+assistant turns and send via `pi.sendUserMessage()`. For summarize: use `completeSimple` to summarize the sub-session's conversation (or use the sub-session itself to generate the summary). After successful handoff: dispose the sub-session, dismiss the overlay, clear BTW state. On failure: leave the sub-session intact for recovery.
  - Verify: runtime assertions that inject sends sub-session content to main session, summarize generates and sends summary, handoff disposes sub-session
  - Done when: inject/summarize work against the sub-session's real message history, not manual thread state

- [x] **T03: Prove parallel execution** `est:30m`
  - Why: The main session must not block while BTW is running tools. This needs explicit proof since concurrent AgentSession usage is novel.
  - Files: `extensions/btw.ts`, `tests/btw.runtime.test.ts`
  - Do: Verify that `btwSession.prompt()` is called without `await` blocking the main session's event loop (it's async but the overlay renders independently). Ensure the main session's `prompt()` path is not gated on BTW state. Add runtime assertions that the main session can accept input while the BTW sub-session is streaming. Document any observed concurrency issues.
  - Verify: runtime assertion that main session `isIdle` state is independent of BTW sub-session streaming state
  - Done when: proven that both sessions can be active simultaneously without blocking each other

## Files Likely Touched

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
