# S03 — Research

**Date:** 2026-03-13

## Summary

S03 is the handoff-and-boundary slice. Based on the current code, this slice owns **R007** (explicit handoff stays explicit) and **R011** (BTW continues to coexist with main-session work in the background), while supporting **R002** (lightweight/disposable), **R010** (restore continuity), and the already-validated boundary requirement **R014**. The good news is that the production extension already has the core handoff pipeline: `extensions/btw.ts` implements `btw:inject` and `btw:summarize`, both route through `sendThreadToMain()`, and both explicitly clear hidden BTW state and dismiss the overlay after successful handoff. That means the underlying architecture already matches the intended separation contract.

The main gap is not raw capability but **surface and proof**. The modal currently provides transcript, status, focused input, Escape dismissal, and follow-up submit, but no dedicated in-modal inject/summarize controls. Handoff is still command-driven. That creates the key S03 decision: either treat “from the modal” as “while the modal is the active interaction surface, via BTW commands,” or add explicit overlay affordances. Given the current lightweight goal, existing command contract, and S04’s pending slash-command feasibility work, the safest S03 path is to keep the handoff mechanics command-owned for now, prove they work cleanly with the overlay state, and only add UI affordances if they can remain minimal and avoid coupling the modal to a second command system.

## Recommendation

Use **the existing handoff commands as the authoritative S03 seam**, and expand `tests/btw.runtime.test.ts` to prove the following before changing production code:

1. `btw:inject` sends exactly one user message to the main agent, then clears hidden BTW thread state and dismisses the overlay.
2. `btw:summarize` summarizes the current hidden thread, sends the resulting summary to the main agent, then clears hidden BTW state and dismisses the overlay.
3. When the main session is busy, handoff uses `deliverAs: "followUp"` rather than interrupting work.
4. Failed summarize preserves the thread and keeps the overlay open with retry-oriented status.
5. Main-session context isolation still holds until one of these explicit handoff commands is invoked.

Primary recommendation: **do not invent a separate handoff mechanism for S03**. Reuse `btw:inject`, `btw:summarize`, `sendThreadToMain()`, `resetThread()`, and `dismissOverlay()` as-is unless new tests expose a concrete failure. If the user experience later demands visible inject/summarize buttons inside the modal, that should be treated as a thin UI wrapper over the same command-path logic, not as a second implementation path.

## Don’t Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Sending side-thread content back to the main agent | `sendThreadToMain(ctx, content)` in `extensions/btw.ts` | Already handles idle vs busy main-session delivery using `pi.sendUserMessage()` and `deliverAs: "followUp"` |
| Explicit full-thread handoff | `btw:inject` command | Already formats the thread, sends it to the main session, resets BTW state, and dismisses the overlay |
| Explicit condensed handoff | `btw:summarize` command + `summarizeThread()` | Already summarizes using the active model, injects the result, clears state on success, and preserves thread on failure |
| Preserving side-thread restore and mode semantics | hidden custom entries `btw-thread-entry` and `btw-thread-reset` | S02 established these as the contract source of truth; S03 should not bypass them |
| Preserving separation from main context | `context` hook filtering of `btw-note` messages | Keeps BTW notes out of normal main-session context unless explicitly handed back |

## Existing Code and Patterns

- `extensions/btw.ts` — The authoritative production seam for S03. Relevant pieces:
  - `sendThreadToMain()` chooses `pi.sendUserMessage(content)` vs `pi.sendUserMessage(content, { deliverAs: "followUp" })` based on `ctx.isIdle()`.
  - `btw:inject` formats the full thread, sends it to the main agent, then calls `resetThread(ctx)` and `dismissOverlay()`.
  - `btw:summarize` sets overlay status to summarizing, ensures the overlay remains open during the operation, then on success sends a summary, resets state, and dismisses the overlay; on failure it preserves the thread and sets retry-oriented status.
- `extensions/btw.ts` — `ensureOverlay()` and `submitFromOverlay()` show the modal is currently an input/transcript surface, not a full action menu. This matters because S03 should avoid overloading the modal before S04 resolves command support scope.
- `extensions/btw.ts` — `resetThread()` remains the boundary primitive. Any successful handoff depends on this to clear hidden state and make subsequent reopen behavior truthful.
- `tests/btw.runtime.test.ts` — Existing harness already captures `sentUserMessages`, `notifications`, overlay handles, hidden custom entries, and overlay components. This is enough to prove S03 behavior without building new test scaffolding.
- `skills/btw/SKILL.md` — User-facing BTW contract already frames handoff as explicit commands: `/btw:inject [instructions]` and `/btw:summarize [instructions]`. This supports the “command-owned handoff first” approach.
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/send-user-message.ts` — Confirms the intended platform behavior of `pi.sendUserMessage()`: normal send while idle, `deliverAs: "followUp"` while busy.

## Constraints

- Hidden BTW state and reset markers are the source of truth. S03 should not add alternate shadow state for “handed off” vs “not handed off”.
- The modal is intentionally lightweight. Adding complex overlay controls or a second action routing layer would cut against R002 unless clearly justified.
- Overlay follow-up submission currently requires a command context (`getSystemPrompt` presence). Any future in-modal handoff affordance must respect that same command/runtime boundary or explicitly recreate it.
- `btw:summarize` depends on the active model and credentials via `ctx.model` and `ctx.modelRegistry.getApiKey(model)`. Failure handling must therefore remain first-class and observable.
- Main-session contamination is only acceptable through explicit handoff. S03 must preserve the already-validated `context` filtering behavior and avoid accidental side-channel leakage.

## Common Pitfalls

- **Treating overlay visibility as proof of separation** — The overlay can look separate while hidden BTW state still leaks or handoff behaves incorrectly. Verify `sentUserMessages`, reset markers, and preserved hidden entries directly.
- **Re-implementing handoff formatting in the overlay layer** — This risks drift between buttons/commands later. If S03 adds any UI affordance, it should delegate to the same inject/summarize logic.
- **Clearing thread state on summarize failure** — Current production behavior preserves the thread for retry or injection. S03 tests should lock that in.
- **Ignoring busy-main-session delivery semantics** — `sendThreadToMain()` deliberately uses follow-up delivery when the main agent is not idle. S03 must verify this because it is part of the “main work continues in the background” contract.
- **Assuming “from the modal” means visible buttons are required** — The stronger requirement is explicit handoff while BTW remains separate. Existing slash commands may already satisfy the contract with less UI weight.

## Open Risks

- The current modal has no dedicated inject/summarize affordances, so users may still perceive handoff as “outside” the modal even if it works correctly while the modal is open.
- If S03 adds overlay actions before S04 settles slash-command behavior, the implementation could duplicate command-dispatch concerns or create inconsistent affordances.
- Summarize depends on model availability and credentials, so operational failures are more likely than plain inject. Those failures must keep the thread intact and the modal recoverable.
- There are currently no explicit runtime tests for overlay dismissal + thread reset after handoff, so a regression could slip through even if S02 contract tests keep passing.

## Requirement Targeting

### Primary owned by S03
- **R007 — BTW handoff back to main session stays explicit**
  - Research target: verify that only `btw:inject` and `btw:summarize` cross the boundary into main-session user messages, and that close/Escape do not.
- **R011 — BTW continues to coexist with main-session work in the background**
  - Research target: verify busy-session handoff queues as a follow-up and does not replace or interrupt the main workspace model.

### Supported by S03
- **R002 — BTW opens quickly and stays lightweight/disposable**
  - Constraint: avoid turning S03 into a heavy action-rich modal unless necessary.
- **R010 — Existing BTW thread state still survives and restores according to the current contract**
  - Constraint: successful handoff should clear via reset marker semantics; failure should preserve current thread.
- **R014 — BTW preserves separation from main-session context except when explicit handoff is requested**
  - Constraint: no new leakage path besides the explicit handoff commands.

## Suggested S03 Verification Additions

Add targeted runtime assertions to `tests/btw.runtime.test.ts`:

1. **`/btw:inject` success path**
   - seed or create a BTW thread
   - open overlay
   - run `btw:inject`
   - assert one `sentUserMessages` entry with formatted full thread
   - assert latest reset marker appended
   - assert overlay handle hidden / dismissed
   - assert reopening `/btw` shows empty thread

2. **`/btw:inject` while main agent busy**
   - set harness idle=false
   - run `btw:inject`
   - assert `sentUserMessages.at(-1)?.options` matches `{ deliverAs: "followUp" }`

3. **`/btw:summarize` success path**
   - stub `completeSimpleMock` to return summary text
   - assert summary is what gets sent to main session, not raw thread transcript
   - assert reset + dismiss after success

4. **`/btw:summarize` failure path**
   - stub summarization to error or missing credentials
   - assert no `sentUserMessages`
   - assert thread entries preserved
   - assert overlay remains available and status contains retry guidance

5. **Explicit boundary proof**
   - verify Escape dismissal or ordinary follow-up submit does not create any `sentUserMessages`
   - only inject/summarize should do that

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| BTW workflow semantics | `btw` | installed |
| Vitest | `onmax/nuxt-skills@vitest` | available |
| TypeScript | `wshobson/agents@typescript-advanced-types` | available |
| Terminal UI / TUI interaction | `pproenca/dot-skills@terminal-ui` | available |
| pi-specific TUI design | `joelhooks/pi-tools@pi-tui-design` | available |

Notes:
- The installed `btw` skill is directly relevant to the explicit-handoff contract and user-facing command guidance.
- The external Vitest and terminal-ui skills are plausible support skills if implementation or test complexity grows, but they do not need to be installed for S03 research.

## Sources

- Existing BTW skill confirms explicit handoff is command-owned (`/btw:inject`, `/btw:summarize`) and should remain operationally sharp. (source: `skills/btw/SKILL.md`)
- Production handoff already exists via `sendThreadToMain()`, `btw:inject`, and `btw:summarize`; success clears state and dismisses the overlay, summarize failure preserves the thread. (source: `extensions/btw.ts`)
- Modal implementation currently provides transcript + composer + dismiss, but no dedicated inject/summarize UI controls. (source: `extensions/btw.ts`)
- Runtime harness already captures `sentUserMessages`, overlay handles, notifications, and hidden entries, making S03 test expansion straightforward. (source: `tests/btw.runtime.test.ts`)
- pi example confirms `pi.sendUserMessage()` + `deliverAs: "followUp"` is the intended mechanism for background-session integration while the agent is busy. (source: `node_modules/@mariozechner/pi-coding-agent/examples/extensions/send-user-message.ts`)
