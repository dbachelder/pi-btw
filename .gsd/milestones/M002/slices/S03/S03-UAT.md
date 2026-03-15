# S03: Slash commands, handoff, and parallel execution — UAT

**Milestone:** M002
**Written:** 2026-03-15

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: this slice changed both runtime contract and user-visible BTW behavior. Automated runtime tests already prove slash routing, handoff extraction, transcript inspection, and concurrency; this UAT checks the real terminal feel for slash execution, explicit handoff, and parallel use.

## Preconditions

- Run from this repo in a real terminal with a TTY.
- Start a clean session that loads only this extension, for example:
  - `gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session`
- Use a provider/model configuration that can answer ordinary prompts.
- The repo should be readable so BTW can run a simple tool-backed request if needed.

## Smoke Test

Open BTW, type `/help` in the BTW composer, and confirm the overlay stays open and shows real sub-session output instead of a modal-local “unsupported slash input” warning.

## Test Cases

### 1. Non-BTW slash input routes through the sub-session

1. Start a clean `gsd` session.
2. Open BTW with `/btw`.
3. In the BTW composer, enter `/help`.
4. Wait for the BTW overlay to respond.
5. **Expected:** the overlay transcript/status shows the sub-session handling `/help`; there is no BTW-specific unsupported-slash warning.

### 2. BTW-owned lifecycle commands still stay local to BTW

1. Open BTW with `/btw explain the current package briefly` and let it answer.
2. In the BTW composer, enter `/btw:new`.
3. **Expected:** the BTW transcript clears and the overlay stays open in contextual BTW mode, ready for a fresh prompt.
4. Enter `/btw:tangent brainstorm without current chat context`.
5. **Expected:** BTW starts a fresh tangent-side thread that does not continue the prior contextual thread.
6. Enter `/btw:clear`.
7. **Expected:** the BTW overlay dismisses and the BTW thread is cleared.

### 3. Inject hands off the real BTW sub-session thread to main

1. Open BTW and have a short two-turn conversation.
2. Enter `/btw:inject implement that plan in the main session`.
3. **Expected:** the BTW status shows handoff progress.
4. **Expected:** on success, BTW dismisses and clears.
5. **Expected:** the main session receives a new user message containing the BTW conversation content plus the inject instructions.

### 4. Summarize hands off a summary and then clears BTW

1. Open BTW and create a short thread with enough content to summarize.
2. Enter `/btw:summarize give the main session a short handoff`.
3. **Expected:** the BTW status shows summarize/handoff progress.
4. **Expected:** on success, BTW dismisses and clears.
5. **Expected:** the main session receives a concise summary, not a raw dump of the full BTW thread.

### 5. Main-session input still works while BTW is busy

1. Open BTW with a request that takes long enough to watch, ideally one that triggers at least one tool call.
2. While BTW is still streaming, move focus back to the main session input.
3. Enter a harmless main-session message such as `Main-session responsiveness check`.
4. **Expected:** the main session accepts the input immediately; BTW continues streaming independently.
5. **Expected:** once BTW finishes, its final answer still appears in the overlay transcript/history.

## Edge Cases

### Handoff failure preserves BTW for retry

1. Force or simulate a summarize failure in a controlled test environment.
2. Run `/btw:summarize ...`.
3. **Expected:** BTW surfaces a failure message in status/transcript, but the overlay and BTW thread remain available for retry or `/btw:inject`.

### Slash-command failure surfaces the real session error

1. In BTW, enter a slash command that the sub-session cannot execute successfully.
2. **Expected:** BTW shows the real failure through status/transcript state.
3. **Expected:** BTW does not replace the failure with a synthetic “unsupported slash input” warning.

## Failure Signals

- BTW shows an “unsupported slash input” warning for `/help` or another non-BTW slash command.
- `/btw:inject` or `/btw:summarize` sends stale content that does not match the active BTW conversation.
- Successful inject/summarize leaves the BTW overlay open or leaves stale BTW thread state behind.
- Main-session input is blocked until BTW finishes.
- BTW loses transcript state after a slash-command or handoff failure instead of staying recoverable.

## Requirements Proved By This UAT

- R015 — non-BTW slash input works through the real BTW sub-session while BTW-owned lifecycle/handoff commands keep their special semantics.
- R021 — BTW and the main session can both accept work concurrently.
- R022 — the BTW overlay exposes real transcript/status output during slash execution, tool activity, and failure paths.

## Not Proven By This UAT

- R002 — this UAT gives a subjective feel check for lightweight behavior, but it does not measure startup latency precisely.
- Full S04 contract hardening/cleanup work.

## Notes for Tester

- Use a clean `gsd --no-extensions --extension ./extensions/btw.ts ...` session to avoid unrelated globally installed extensions affecting the run.
- Prefer short, obvious prompts so it is easy to tell whether inject/summarize used the correct BTW content.
- For the parallel test, a prompt that triggers a visible tool call is best because it makes “BTW still busy while main is usable” easy to judge.
