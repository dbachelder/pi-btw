# S02: Overlay transcript rendering from agent events

**Goal:** Replace the simple `BtwSlot` text model with a rich transcript that renders tool calls, tool results, thinking, and streaming assistant output from the sub-session's agent event stream.
**Demo:** User asks BTW to read a file — the overlay shows "read: path/to/file" with the result, then the assistant's answer streaming in. The transcript scrolls, wraps, and renders inline like a real mini-session.

## Must-Haves

- Tool calls appear in the transcript with tool name and arguments (e.g. "read: src/lib/auth.ts")
- Tool results appear below their call (truncated for large outputs, expandable not required)
- Assistant text streams in token-by-token in the transcript
- Thinking content renders in the transcript (collapsible not required, but visually distinct)
- The transcript auto-scrolls to follow new content (existing PgUp/PgDn still works)
- Multiple turns render sequentially in the transcript with clear turn boundaries
- The transcript model is driven by `session.subscribe()` events, not manual slot management

## Proof Level

- This slice proves: integration (agent event stream rendered into TUI components)
- Real runtime required: yes (event stream subscription and rendering pipeline)
- Human/UAT required: yes (visual quality of the transcript rendering)

## Verification

- `npm test -- tests/btw.runtime.test.ts` — assertions that tool-call events produce transcript entries, tool-result events populate results, streaming events update assistant text
- `npm test -- tests/btw.runtime.test.ts -t "transcript inspection exposes streaming and failure state"` — verifies the inspectable transcript surface shows tool/result rows plus preserved failure output when a BTW request aborts or errors
- Manual: open BTW in live pi, ask it to read a file, verify tool call and result render in the overlay

## Observability / Diagnostics

- Runtime signals: transcript entry count and types visible in test assertions
- Inspection surfaces: `getTranscriptEntries()` or equivalent for tests to inspect rendered state
- Failure visibility: missing or malformed transcript entries surface as test failures

## Integration Closure

- Upstream surfaces consumed: `AgentSessionEvent` stream from S01 sub-session subscription (`tool_execution_start`, `tool_execution_end`, `message_start`, `message_update`, `message_end`, `turn_start`, `turn_end`)
- New wiring introduced in this slice: event-driven transcript model replaces `BtwSlot[]`; overlay component renders from transcript entries instead of slots
- What remains before the milestone is truly usable end-to-end: slash commands and handoff (S03), contract hardening (S04)

## Tasks

- [x] **T01: Define transcript entry model and event-to-transcript mapper** `est:1h`
  - Why: The overlay needs a data model that can represent tool calls, tool results, assistant text, thinking, and user messages — driven by agent events instead of manual slot management.
  - Files: `extensions/btw.ts`
  - Do: Define `BtwTranscriptEntry` types — `user-message`, `tool-call` (name + args), `tool-result` (content, truncated), `assistant-text` (streaming), `thinking` (streaming), `turn-boundary`. Write an event handler that subscribes to the sub-session's event stream and maps events to transcript entries. `tool_execution_start` → `tool-call` entry. `tool_execution_end` → `tool-result` entry. `message_update` → update `assistant-text` or `thinking` entry. `turn_start` / `turn_end` → turn boundaries. Store entries in a `BtwTranscript` array that replaces `slots[]`.
  - Verify: unit/runtime tests that feed agent events and check transcript entries are created with correct types and content
  - Done when: agent events reliably map to typed transcript entries

- [x] **T02: Render transcript entries in the overlay component** `est:1h`
  - Why: The transcript entries from T01 need to be rendered visually in the overlay with appropriate styling for each entry type.
  - Files: `extensions/btw.ts`
  - Do: Rewrite `buildOverlayTranscript()` to render from `BtwTranscriptEntry[]` instead of `BtwSlot[]`. Tool calls render with a distinct badge and tool name + truncated args. Tool results render as dimmed/indented text with truncation for large outputs. Assistant text renders with the existing assistant badge and streams in-place. Thinking renders with the existing thinking badge. Turn boundaries render as separator lines. Update `BtwOverlayComponent.refresh()` to use the new transcript. Ensure the scrolling/viewport logic still works with variable-height entries.
  - Verify: manual visual check in live pi plus runtime assertions on rendered line content
  - Done when: overlay shows a visually coherent transcript with tool calls, results, and assistant text distinguishable

- [x] **T03: Wire event subscription lifecycle to overlay** `est:30m`
  - Why: The subscription to the sub-session's event stream must start when the overlay opens and unsubscribe when it closes — no leaked listeners.
  - Files: `extensions/btw.ts`
  - Do: Subscribe to the sub-session's event stream when the overlay is created (in `ensureOverlay`). Store the unsubscribe function. Call it on Escape/dismiss/dispose. Ensure that refresh calls propagate to `tui.requestRender()` so streaming updates appear in real-time. Handle the case where events arrive while the overlay is hidden (buffer or discard).
  - Verify: runtime assertions that unsubscribe is called on dismiss, no events processed after dispose
  - Done when: event subscription lifecycle is clean — subscribes on open, unsubscribes on close, no leaks

## Files Likely Touched

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
