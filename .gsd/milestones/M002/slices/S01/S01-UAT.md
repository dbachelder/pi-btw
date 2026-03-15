# S01: Sub-session lifecycle and agent loop — UAT

**Milestone:** M002
**Written:** 2026-03-15

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: this slice changed both runtime contracts and interactive BTW behavior, so it needs executable harness proof plus a real live-overlay check for tool use and dismissal feel.

## Preconditions

- Run from the repo root: `/Users/dan/src/pi-btw`
- `gsd` is on `PATH`
- OpenAI access is available for a live `gsd` run
- BTW extension loads from `./extensions/btw.ts`
- No existing BTW overlay is open when starting the manual checks

## Smoke Test

Launch:

```bash
gsd --no-extensions --extension ./extensions/btw.ts --provider openai --model gpt-4o-mini --no-session
```

Then submit:

```text
/btw what is the package.json name field? Use the read tool and answer briefly.
```

**Expected:** a BTW overlay opens, shows a `Tool` section with a `read` call against `package.json`, and answers `pi-btw`.

## Test Cases

### 1. Contextual BTW runs through a real tool-backed sub-session

1. Start `gsd` with the BTW extension loaded.
2. In the main session, submit `/btw what is the package.json name field? Use the read tool and answer briefly.`
3. Watch the BTW overlay while the request runs.
4. **Expected:** the overlay shows BTW streaming activity, including `Tool`, `→ read {"path":"package.json"}`, and `✓ read` before the assistant answers `pi-btw`.
5. Submit a second BTW follow-up inside the same overlay: `What tool did you just use?`
6. **Expected:** the reply comes back in the same BTW surface, proving the prompt path is using the real sub-session rather than a one-shot call.

### 2. Escape aborts and disposes an in-flight BTW run cleanly

1. Start a fresh `gsd` instance with the BTW extension loaded.
2. Submit `/btw read package.json and explain the file in detail, step by step.`
3. As soon as the BTW overlay is visibly streaming or showing tool activity, press `Escape`.
4. **Expected:** the overlay dismisses immediately.
5. Reopen BTW with `/btw what is the package name? Use the read tool.`
6. **Expected:** BTW opens normally again, runs a fresh sub-session, and answers instead of getting stuck in a prior streaming state.

### 3. Contextual mode inherits main-session context while tangent mode restarts clean

1. Start a fresh `gsd` instance with the BTW extension loaded.
2. In the main session, send: `Remember this token exactly: alpha-main-context-42.`
3. After the main assistant acknowledges it, submit `/btw what token did I just ask you to remember? Answer with the token only.`
4. **Expected:** contextual BTW can answer `alpha-main-context-42` because the main-session messages were seeded into the sub-session.
5. Then submit `/btw:tangent what token did I just ask you to remember? Answer with the token only if you actually know it.`
6. **Expected:** tangent BTW does not inherit the main-session token and responds that it does not know or lacks that context.

## Edge Cases

### `/btw:new` replaces the live sub-session instead of reusing stale state

1. Open BTW and complete one tool-backed turn.
2. Submit `/btw:new what is the package.json name field? Use the read tool and answer briefly.`
3. **Expected:** BTW opens a fresh thread/session, does not carry over the prior sub-session's streaming state, and still runs the tool-backed prompt successfully.

## Failure Signals

- `/btw` echoes in the main composer without opening the BTW overlay
- The overlay answers without any visible tool activity for a prompt that explicitly requires `read`
- Escape hides the overlay but reopening BTW leaves it stuck in streaming or otherwise unusable
- Contextual BTW cannot see the just-sent main-session token, or tangent BTW incorrectly can
- `/btw:new` reuses stale transcript or streaming state from the prior BTW run

## Requirements Proved By This UAT

- R002 — BTW still feels lightweight enough to open and dismiss during live use
- R006 — contextual BTW inherits main-session context while tangent BTW recreates a clean contextless sub-session
- R020 — BTW can use real coding tools in the live overlay
- R023 — BTW behaves as a disposable sub-session that can be dismissed and recreated cleanly

## Not Proven By This UAT

- R015 — full slash-command parity with the main input is not covered here
- R021 — true simultaneous main-session and BTW execution is not explicitly exercised here
- R022 — the final rich event transcript rendering is not covered because S01 still uses the simplified text bridge

## Notes for Tester

- Use `--extension ./extensions/btw.ts` for the live run; that path was reliable in PTY-backed verification.
- The overlay transcript is intentionally still simplified in S01. Seeing tool rows and assistant streaming is enough for this slice; richer event rendering lands in S02.
- If the first live run fails due to provider/auth issues, fix that first and rerun. The slice is not done without a truthful live tool-backed BTW check.
