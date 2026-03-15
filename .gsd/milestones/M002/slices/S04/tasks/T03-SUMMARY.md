---
id: T03
parent: S04
milestone: M002
provides:
  - Removes the last dead M001 BTW plumbing, keeps summarize on the AgentSession path, and updates the README to describe BTW as a real tool-enabled sub-session
key_files:
  - extensions/btw.ts
  - tests/btw.runtime.test.ts
  - README.md
key_decisions:
  - BTW summary generation now runs through a short-lived AgentSession instead of a direct `completeSimple` call
patterns_established:
  - Keep BTW execution and verification on the `createAgentSession` seam; use separate in-memory sessions for both the interactive BTW thread and summarize-only work
observability_surfaces:
  - BTW overlay status text
  - `BtwOverlayComponent.getTranscriptEntries()`
  - `tests/btw.runtime.test.ts` `subSessionRecords` / `promptCalls`
duration: 1h54m
verification_result: passed
completed_at: 2026-03-15 12:33:18 PDT
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# T03: Remove dead M001 plumbing and update README

**Removed the last direct M001 BTW completion path, moved summarize onto a short-lived AgentSession, and updated the BTW docs/test harness to match the real sub-session model.**

## What Happened

`extensions/btw.ts` no longer imports or calls `completeSimple`; BTW summarize now creates a short-lived in-memory AgentSession with a summarize-specific system prompt, prompts it with the extracted BTW thread, and disposes it immediately after use. I also removed the standalone `buildMainMessages()` helper by inlining the contextual seeding logic into `buildBtwSeedState()`, which keeps the hidden-note filtering behavior without leaving the old helper surface around.

`tests/btw.runtime.test.ts` was cleaned up to stop pretending BTW still depends on `streamSimple` / `completeSimple`. The harness now drives both normal BTW prompts and summarize behavior through `createAgentSessionMock` plus `promptStreamMock`, and the summarize assertions now inspect the second AgentSession record instead of a removed direct completion mock.

`README.md` now explicitly describes BTW as a real pi sub-session with coding-tool access, documents the real sub-session model, and keeps the native slash-routing explanation aligned with the M002 runtime.

## Verification

- `npm test -- tests/btw.runtime.test.ts` ✅
- `npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state|summarize failure preserves BTW thread state and keeps the overlay recoverable"` ✅
- `npm test` ✅
- `rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts` ✅ no hits
- Manual live-pi verification: attempted via `which pi && pi --help | head -n 20`; local `pi` startup surfaced unrelated extension-loading failures in the installed agent environment before a BTW flow could be exercised, so the manual smoke path was not completed in this unit

## Diagnostics

- `extensions/btw.ts` overlay status text remains the first-line signal for streaming, tool execution, summarize/inject handoff, and recoverable failures
- `BtwOverlayComponent.getTranscriptEntries()` remains the inspectable event-driven transcript surface for BTW UI/runtime assertions
- `tests/btw.runtime.test.ts` `subSessionRecords` now covers both the interactive BTW session and the short-lived summarize session, so later work can inspect prompt text, seeded messages, tools, disposal, and listener counts from the same seam

## Deviations

- The dispatched task-plan path `.gsd/milestones/M002/slices/S04/tasks/T03-PLAN.md` did not exist locally, so execution used the T03 contract embedded in `.gsd/milestones/M002/slices/S04/S04-PLAN.md`

## Known Issues

- Manual live-pi BTW smoke verification is currently blocked on the local `pi` installation failing to load several default agent extensions (`@gsd/pi-coding-agent` / `@gsd/pi-ai` export errors) before interactive validation begins

## Files Created/Modified

- `extensions/btw.ts` — removed the last direct completion path, inlined contextual seed-message filtering, and moved summarize onto a short-lived AgentSession
- `tests/btw.runtime.test.ts` — replaced leftover legacy AI-helper mock terminology with a session-first harness and updated summarize assertions to inspect AgentSession records
- `README.md` — documented BTW as a real pi sub-session with tool access and clarified the sub-session/slash model
