---
estimated_steps: 5
estimated_files: 3
---

# T01: Extend the BTW runtime gate to prove explicit handoff and busy-session integration

**Slice:** S03 — Explicit handoff and background-session integration
**Milestone:** M001

## Description

Strengthen the existing BTW runtime contract suite so S03 is closed by executable proof instead of new UI speculation. This task should prove that handoff remains explicit, successful inject/summarize flows clear and dismiss correctly, busy main-session delivery uses follow-up semantics, and summarize failure preserves the side thread for recovery.

## Steps

1. Add a runtime test for `/btw:inject` success that seeds or builds a BTW thread, executes the command while the modal is active, and asserts the main-session user message payload, reset marker behavior, overlay dismissal, and fresh reopen semantics.
2. Add a runtime test for `/btw:inject` while the main session is busy that asserts `sendUserMessage(..., { deliverAs: "followUp" })` behavior rather than idle delivery.
3. Add runtime tests for `/btw:summarize` success and failure using `completeSimpleMock`, asserting success sends summary content plus reset/dismiss behavior while failure sends nothing back, preserves hidden thread entries, and leaves retry-oriented overlay state visible.
4. Add an explicit-boundary runtime test showing ordinary BTW follow-up submit and Escape dismissal do not create `sentUserMessages`, so only handoff commands cross back into the main session.
5. If any new assertion fails against production, make the smallest contract-preserving fix in `extensions/btw.ts`, then update `.gsd/REQUIREMENTS.md` so S03-owned requirements cite the new proof.

## Must-Haves

- [ ] Runtime assertions cover both successful and failed handoff paths, including busy-main-session delivery semantics.
- [ ] The final suite proves that only explicit handoff commands send content to the main session and that successful handoff clears/dismisses through the existing reset-marker contract.

## Verification

- `npm test -- tests/btw.runtime.test.ts`
- `npm test`

## Observability Impact

- Signals added/changed: test-visible assertions over `sentUserMessages`, delivery options, reset markers, overlay hidden state, and summarize failure status/notifications
- How a future agent inspects this: rerun `tests/btw.runtime.test.ts` and inspect the named failing assertion before touching `extensions/btw.ts`
- Failure state exposed: handoff leaks, wrong delivery mode while busy, lost thread on summarize failure, or overlay dismissal/reset drift

## Inputs

- `tests/btw.runtime.test.ts` — S02-established runtime harness exposing hidden entries, overlay handles, and sent user messages
- `extensions/btw.ts` — authoritative inject/summarize and reset/dismiss production seam identified by S03 research
- S02 forward intelligence — reason from reset markers and context boundaries, not just overlay appearance

## Expected Output

- `tests/btw.runtime.test.ts` — named S03 assertions covering inject/summarize handoff, busy-session follow-up delivery, failure preservation, and explicit-boundary behavior
- `.gsd/REQUIREMENTS.md` — updated proof text for S03-owned requirements once the assertions pass
- `extensions/btw.ts` — only minimal contract-preserving changes if the new tests expose a real production gap
