# S04: Contract hardening and cleanup — UAT

**Milestone:** M002
**Written:** 2026-03-15

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: S04 is mostly contract hardening and cleanup, so the decisive proof is the runtime suite plus a lightweight live BTW smoke to ensure the shipped overlay still behaves like a real sub-session in an interactive terminal.

## Preconditions

- Repo is at the S04-complete state.
- Dependencies are installed (`npm install` already run).
- `OPENAI_API_KEY` is available for the live smoke path.
- `gsd` is installed and available on `PATH`.
- Run from the repository root: `/Users/dan/src/pi-btw`.

## Smoke Test

Run:

```bash
npm test -- tests/btw.runtime.test.ts
```

**Expected:** `tests/btw.runtime.test.ts` passes with all BTW runtime assertions green.

## Test Cases

### 1. Full S04 contract suite stays green

1. Run:
   ```bash
   npm test -- tests/btw.runtime.test.ts
   ```
2. Confirm the suite passes all BTW runtime assertions.
3. **Expected:** the suite proves sub-session creation, transcript rendering, slash routing, handoff, clear/dispose behavior, and parallel execution without failures.

### 2. Failure-path diagnostics stay recoverable and inspectable

1. Run:
   ```bash
   npm test -- tests/btw.runtime.test.ts -t "preserves BTW overlay recoverability after agent prompt failure|transcript inspection exposes streaming and failure state|summarize failure preserves BTW thread state and keeps the overlay recoverable"
   ```
2. Inspect the selected tests for pass/fail output.
3. **Expected:** all three targeted tests pass, proving the overlay keeps diagnostic transcript/status state after prompt and summarize failures instead of silently dropping the BTW thread.

### 3. Dead M001 plumbing is gone

1. Run:
   ```bash
   rg "streamSimple|completeSimple|BtwSlot|buildBtwContext" extensions/btw.ts
   ```
2. **Expected:** no matches.
3. Open `README.md` and confirm it describes BTW as a real in-memory sub-session with coding-tool access and native slash routing.

### 4. Live BTW smoke: ask a tool-backed question and use an in-modal BTW slash command

1. Start an interactive run:
   ```bash
   gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session
   ```
2. At the prompt, enter:
   ```text
   /btw read package.json and answer with only the package name
   ```
3. Wait for the BTW overlay answer.
4. In the BTW overlay, enter:
   ```text
   /btw:new Reply with exactly S04-SLASH-OK
   ```
5. **Expected:** BTW answers `pi-btw` for the first question, then resets/reopens the BTW thread and answers `S04-SLASH-OK` in the new BTW turn.

### 5. Live BTW smoke: explicit handoff and dismiss behavior

1. With the BTW overlay open after a completed BTW reply, enter:
   ```text
   /btw:inject Use this in the main run.
   ```
2. Confirm the BTW overlay closes and the main session receives the handoff as a new user message or follow-up.
3. Reopen BTW:
   ```text
   /btw quick dismiss check
   ```
4. Press `Escape`.
5. **Expected:** inject performs an explicit handoff and resets BTW state; reopening BTW works; `Escape` dismisses the overlay immediately without errors or leaked in-progress BTW output.

## Edge Cases

### Clear during active tool execution

1. Trigger a BTW prompt likely to run a tool for a noticeable moment.
2. Before the BTW turn completes, issue:
   ```text
   /btw:clear
   ```
3. **Expected:** the BTW thread is cleared, the active sub-session is aborted/disposed cleanly, and reopening BTW starts from a fresh thread.

### Routed slash failure remains recoverable

1. Open BTW.
2. Enter a slash command that routes through the BTW sub-session and is expected to fail in the current environment.
3. **Expected:** the failure is visible in BTW status/transcript state, but the existing BTW thread remains recoverable instead of being silently discarded.

## Failure Signals

- `tests/btw.runtime.test.ts` fails or hangs.
- `rg` finds `streamSimple`, `completeSimple`, `BtwSlot`, or `buildBtwContext` in `extensions/btw.ts`.
- BTW no longer shows tool-call/result transcript rows for tool activity.
- Non-BTW slash input inside the overlay falls back to a BTW-local warning instead of routing through the sub-session.
- `/btw:clear`, `/btw:new`, or `Escape` leaves a stuck BTW stream or leaked listener/sub-session.
- Inject/summarize silently drops the BTW thread on failure instead of preserving a recoverable overlay state.

## Requirements Proved By This UAT

- R015 — BTW overlay slash input still follows the shipped parity model.
- R020 — BTW behaves as a real tool-enabled side-agent in a live interactive run.
- R021 — explicit handoff and dismiss checks exercise BTW’s separation from the main session.
- R022 — tool-backed BTW replies remain visible as a real transcript surface, not a plain Q&A stub.
- R023 — clear/dismiss behavior checks that BTW remains disposable and ephemeral.

## Not Proven By This UAT

- Direct startup-latency benchmarking for R002.
- Any broader future “embedded workspace” behavior from deferred R016.

## Notes for Tester

- The runtime suite is the authoritative proof surface for inject/summarize failure handling, listener disposal, and parallel execution. Use the live smoke for confidence that the shipped overlay still feels real; use the test suite when terminal rendering makes post-handoff state hard to observe precisely.
- If interactive GSD cannot run in your automation environment because no TTY is available, perform the live smoke manually in a real terminal and rely on the automated runtime suite for the rest.
