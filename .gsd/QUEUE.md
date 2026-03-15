# Queue

<!-- Append-only log of queued milestones. -->

## 2026-03-15

- **M002: BTW sub-session** — Replace BTW's manual stream/context plumbing with a real AgentSession sub-session backed by `createAgentSession()`. Full tools (read, bash, edit, write), native slash-command dispatch via `prompt()`, parallel execution with main session, ephemeral in-memory session, full tool transcript in overlay. Advances R015, R020, R021, R022, R023.
