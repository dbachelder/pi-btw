# S04: Slash-command support and graceful fallback

**Goal:** Add the lightest clean slash behavior inside the BTW modal by intercepting BTW-owned slash commands in the composer, reusing the existing command/thread contract, and making unsupported slash inputs degrade coherently without pretending full main-input parity.
**Demo:** While the BTW modal is open, submitting `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, or `/btw:summarize` from the composer executes the same semantics as the registered BTW commands, while unsupported slash input stays lightweight and visibly falls back according to an explicit BTW-local rule instead of silently pretending to be full slash support.

## Must-Haves

- BTW modal slash handling directly advances S04-owned active requirements R012 and R013.
- BTW-owned slash commands entered in the modal reuse the authoritative command/thread semantics already proven for `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, and `/btw:summarize`.
- Unsupported slash input inside the modal degrades intentionally and observably, without implying that arbitrary main-session slash commands ran.
- Verification proves both command-path reuse and the fallback rule through executable runtime assertions, not README inspection alone.

## Proof Level

- This slice proves: integration
- Real runtime required: no
- Human/UAT required: no

## Verification

- `npm test -- tests/btw.runtime.test.ts`
- `npm test`
- `npm test -- tests/btw.runtime.test.ts -t "unsupported slash input in the modal surfaces BTW-local fallback and does not execute a command"`
- `tests/btw.runtime.test.ts` expanded with named assertions for in-modal BTW slash command dispatch and unsupported-slash fallback observability

## Observability / Diagnostics

- Runtime signals: overlay status text and notifications for unsupported slash fallback; hidden `btw-thread-entry` / `btw-thread-reset` effects and `sentUserMessages` for command-path truth
- Inspection surfaces: `tests/btw.runtime.test.ts`, modal runtime state exposed by the harness, and `extensions/btw.ts` slash-routing seam in `submitFromOverlay()`
- Failure visibility: whether slash input became a hidden BTW entry, appended reset markers, dismissed the overlay, queued handoff, or surfaced a fallback warning/status
- Redaction constraints: preserve existing BTW/thread redaction boundaries; no secrets in status or test fixtures

## Integration Closure

- Upstream surfaces consumed: `extensions/btw.ts` command handlers, `submitFromOverlay()`, `runBtw()`, `resetThread()`, `dismissOverlay()`, and the runtime harness in `tests/btw.runtime.test.ts`
- New wiring introduced in this slice: a narrow modal slash-dispatch seam that routes BTW-owned slash inputs to the same command-owned semantics and surfaces an explicit fallback rule for unsupported slash input
- What remains before the milestone is truly usable end-to-end: milestone wrap-up and acceptance recheck after slash behavior is proven

## Tasks

- [x] **T01: Wire BTW-scoped slash dispatch and prove fallback behavior** `est:1.5h`
  - Why: S04 is small but high-risk: the modal currently sends every slash-prefixed input to the side model, so one task should close the whole loop by adding narrow routing at the composer seam, proving command reuse, and making the unsupported-slash rule inspectable.
  - Files: `extensions/btw.ts`, `tests/btw.runtime.test.ts`, `README.md`, `.gsd/REQUIREMENTS.md`, `.gsd/milestones/M001/M001-ROADMAP.md`
  - Do: Add a small parser/dispatcher in the overlay submit path that intercepts slash-prefixed input before `runBtw()`, allows only BTW-owned commands, and routes them through shared command-owned behavior rather than duplicating semantics; define and implement an explicit unsupported-slash fallback policy that stays lightweight and does not imply full parity; extend the runtime harness with named in-modal slash tests covering at least one reset command, one mode-switch or reopen command, one handoff command, and an unsupported slash input; update README and requirements/roadmap evidence only after code and tests make the policy true.
  - Verify: `npm test -- tests/btw.runtime.test.ts && npm test`
  - Done when: modal BTW-owned slash inputs execute the same authoritative semantics from inside the composer, unsupported slash input has an explicit coherent fallback, and the docs/state artifacts match the proven behavior.

## Files Likely Touched

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
- `README.md`
- `.gsd/REQUIREMENTS.md`
- `.gsd/milestones/M001/M001-ROADMAP.md`
- `.gsd/milestones/M001/slices/S04/S04-SUMMARY.md`
- `.gsd/milestones/M001/slices/S04/S04-UAT.md`
