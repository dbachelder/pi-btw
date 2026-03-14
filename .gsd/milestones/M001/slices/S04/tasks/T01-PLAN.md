---
estimated_steps: 5
estimated_files: 5
---

# T01: Wire BTW-scoped slash dispatch and prove fallback behavior

**Slice:** S04 — Slash-command support and graceful fallback
**Milestone:** M001

## Description

S04 should stay as one task because the slice has one real seam and one real risk: `submitFromOverlay()` currently routes every non-empty input into BTW chat, so slash support and graceful fallback either both become true there or they do not. The safest plan is to add only BTW-scoped slash interception at that seam, force it to reuse the same command/thread semantics already proven in the runtime harness, and extend the harness so unsupported slash behavior is explicit and inspectable rather than ambiguous.

## Steps

1. Inspect the current overlay submit path and extract the smallest shared command-dispatch helper needed so in-modal `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize` can reuse authoritative behavior without duplicating command semantics in a second switch tree.
2. Implement overlay slash interception before `runBtw()`, keeping BTW-owned commands lightweight and scoped while adding an explicit unsupported-slash fallback rule that does not imply arbitrary main-input command support.
3. Extend `tests/btw.runtime.test.ts` with named in-modal slash assertions covering command reuse through the overlay for thread reset/mode/handoff behavior plus at least one unsupported slash submission that proves the fallback signal and non-execution behavior.
4. Update `README.md` to document the in-modal BTW-scoped slash policy and fallback rule only after the behavior is executable and passing.
5. Update milestone/requirements slice artifacts to reflect the proved S04 behavior and close the roadmap item once verification passes.

## Must-Haves

- [ ] In-modal BTW slash handling reuses the real command/thread contract instead of inventing overlay-only semantics.
- [ ] Unsupported slash input is handled by an explicit, user-visible BTW-local fallback rule and is proven not to masquerade as a successful command.
- [ ] Runtime tests cover both successful BTW-owned slash execution from the modal and the unsupported-slash fallback behavior.

## Verification

- `npm test -- tests/btw.runtime.test.ts`
- `npm test`

## Observability Impact

- Signals added/changed: modal status and/or notification signal for unsupported slash input; runtime-observable command effects such as reset markers, overlay dismissal, mode changes, and sent main-session messages from overlay-submitted slash commands
- How a future agent inspects this: rerun `tests/btw.runtime.test.ts` and inspect `extensions/btw.ts` around `submitFromOverlay()` plus any extracted shared command-dispatch helper
- Failure state exposed: whether a slash input incorrectly became BTW chat, incorrectly mutated hidden thread state, or failed to surface the documented fallback rule

## Inputs

- `extensions/btw.ts` — current modal input seam, registered BTW command handlers, and authoritative reset/handoff helpers
- `tests/btw.runtime.test.ts` — established contract gate and harness for overlay state, hidden entries, and sent main-session messages
- S04 research and S01/S02/S03 forward intelligence — keep the overlay thin, preserve reset-marker truth, and reuse stable overlay runtime/command boundaries rather than broadening BTW into a second command system

## Expected Output

- `extensions/btw.ts` — BTW-scoped modal slash routing plus explicit fallback behavior for unsupported slash input
- `tests/btw.runtime.test.ts` — named runtime assertions proving in-modal BTW slash dispatch and graceful fallback
- `README.md` — concise BTW-modal slash policy documentation aligned with shipped behavior
- `.gsd/REQUIREMENTS.md` — R012/R013 updated with concrete proof text if the work validates them
- `.gsd/milestones/M001/M001-ROADMAP.md` — S04 marked complete once the slice behavior is proved
