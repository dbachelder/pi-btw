# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| 1 | 2026-03-15 | M002 / S03 / T03 | How to prove BTW/main-session parallelism | Prove concurrency in `tests/btw.runtime.test.ts` by asserting the overlay submit path is fire-and-forget and a simulated main-session input can start while the BTW sub-session is still streaming, instead of adding new production-only blocking state or diagnostics | The shipped runtime already uses `void submitFromOverlay(...)` and independent `ctx.isIdle()` checks; the missing work was proof, not new orchestration code | Yes |
| 2 | 2026-03-15 | M002 / S03 / T01 | Where overlay slash interception stops | Intercept only BTW-owned lifecycle and handoff commands in the overlay; route every other slash-prefixed input through the BTW sub-session `prompt()` path | Full slash parity depends on using the real sub-session dispatch path. A modal-local unsupported-slash warning would diverge from main-session behavior and hide real command failures | Yes |
| 3 | 2026-03-15 | M002 / S03 / T02 | How BTW handoff payloads are derived | Derive inject and summarize payloads from sub-session message history starting at a recorded BTW side-thread boundary, and strip only the resume marker pair before formatting user/assistant turns | Handoff must reflect the real active BTW conversation without leaking seeded main-session context or internal continuation markers | Yes |
| 4 | 2026-03-15 | M002 / S04 / T02 | How to harden remaining BTW runtime assertions | Extend the existing AgentSession harness with command-path assertions that inspect transcript/status/sub-session records, instead of adding production-only hooks or new runtime diagnostics | The missing work was contract proof for slash failure, incremental streaming, empty-thread injection, and clear-during-tool disposal; existing observability surfaces were already sufficient | Yes |
| 5 | 2026-03-15 | M002 / S04 / T03 | How BTW summary generation should run after removing `completeSimple` | Generate BTW summaries through a short-lived `createAgentSession()` sub-session with an in-memory session, no tools, and a summarize-specific system prompt | This keeps BTW execution on the AgentSession contract used everywhere else in M002, removes the last direct `pi-ai` completion path, and lets tests prove summarize behavior through the same `subSessionRecords` seam as normal BTW prompts | Yes |

