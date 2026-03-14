# S04: Slash-command support and graceful fallback — Research

**Date:** 2026-03-13

## Summary

S04 directly owns the remaining active slash-related requirements: **R012** (support useful slash commands inside the BTW modal if that can be done cleanly) and **R013** (degrade gracefully if full slash parity is not feasible). It also depends on preserving the already-validated command/thread invariants from S02 and the explicit handoff boundary from S03. Research confirms the current BTW modal composer is a plain `Input` inside `BtwOverlayComponent`, with submit wired directly to `submitFromOverlay()` and then `runBtw()`. There is **no existing embedded slash-command router, parser, autocomplete, or scoped command execution surface** inside the modal today.

The key surprise is that broad slash parity is not merely “not implemented”; the current architecture actively routes every overlay submission as BTW chat content. That means a user typing `/btw:clear` in the modal today would send that literal text to the side model, not execute the command. The cleanest viable S04 path is therefore **small, explicit, scoped command interception in the overlay composer**, not reuse of the main input command system. Full parity with the main slash surface looks out of scope for M001 and aligns with deferred R015. A coherent fallback is very feasible: support a deliberately tiny set of BTW-owned commands in-modal (`/btw:clear`, `/btw:inject`, `/btw:summarize`, likely `/btw:new`, `/btw:tangent`, `/btw`) and treat everything else as normal chat text while surfacing a clear status/notification explaining that only BTW-scoped commands run inside the modal.

## Recommendation

Take a **BTW-scoped slash interception** approach inside the modal composer.

Specifically:
- Parse overlay submissions beginning with `/` before sending them to `runBtw()`.
- Execute only a narrow allowlist of BTW-owned commands whose semantics are already proven by the runtime harness: `/btw`, `/btw:new`, `/btw:tangent`, `/btw:clear`, `/btw:inject`, `/btw:summarize`.
- Reuse the already-registered command handlers or a shared internal dispatcher so command semantics stay anchored to the same production paths tested in `tests/btw.runtime.test.ts`.
- For all other slash inputs, **degrade intentionally**: do not try to emulate the full main command system. Either treat them as plain BTW text or reject them with a clear BTW-local message. The lighter and less confusing option is to treat unknown slash text as plain chat **only if** the status text makes the rule explicit; otherwise users will think commands ran when they did not.

The strongest constraint is semantic drift. S02 established `tests/btw.runtime.test.ts` as the command/thread contract gate, so S04 should avoid creating a second command implementation path in overlay-only code. If slash support is added, it should dispatch into the same contract-owned seams that `/btw*` commands already use. If that proves awkward, prefer the graceful fallback and document the limits clearly rather than inventing a half-parity embedded command system.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| BTW command semantics | Existing registered command handlers in `extensions/btw.ts` | They already own reset, restore, mode-switch, and handoff semantics proven by the runtime harness |
| Contract verification | `tests/btw.runtime.test.ts` | Already exposes command execution, hidden entries, overlay handles, sent user messages, and context behavior |
| Overlay lifecycle | `ensureOverlay()`, `dismissOverlay()`, `submitFromOverlay()` | Reusing these avoids creating a second modal state machine just for slash behavior |
| Hidden thread truth | `btw-thread-entry` and `btw-thread-reset` entries | These are the durable source of truth; slash support must not bypass them |

## Existing Code and Patterns

- `extensions/btw.ts` — `BtwOverlayComponent` uses a plain `Input` with `onSubmit` and `onEscape`; there is no built-in slash parsing in the composer. This is the exact seam where S04 can attach a lightweight interceptor.
- `extensions/btw.ts` — `submitFromOverlay(ctx, value)` currently trims text, rejects empty input, and always forwards non-empty input to `runBtw(ctx, question, false, pendingMode)`. This is the main place where slash-aware routing could branch.
- `extensions/btw.ts` — registered commands `/btw`, `/btw:tangent`, `/btw:new`, `/btw:clear`, `/btw:inject`, and `/btw:summarize` already encode the authoritative semantics. Reuse them; do not duplicate their behavior in bespoke overlay code.
- `extensions/btw.ts` — `resetThread()`, `restoreThread()`, and `buildBtwContext()` remain the real contract seams. Any slash behavior that changes threads or mode must still flow through these helpers.
- `tests/btw.runtime.test.ts` — the harness already proves command semantics, overlay dismissal, inject/summarize handoff, and explicit-boundary behavior. It is the right place to add S04 proofs for in-modal slash handling or fallback.
- `README.md` — currently documents the BTW command set but does not claim broad slash-command parity inside the modal. That leaves room for an intentional “BTW commands only” policy without contradicting existing docs.

## Constraints

- The overlay composer is a raw `Input`, not the main pi command line. There is no evidence in this codebase of a reusable embedded slash-command UI, autocomplete surface, or command palette integration.
- `submitFromOverlay()` only has an `ExtensionContext | ExtensionCommandContext`; it explicitly requires command context for submission. Any slash execution from the modal must preserve that assumption or fail coherently.
- S02 made `tests/btw.runtime.test.ts` the contract gate. If slash support diverges from registered command behavior, S04 will silently break proven semantics.
- S03 showed overlay dismissal and handoff depend on the live overlay runtime handle. Slash-triggered clear/inject/summarize must reuse those same paths, not bypass them.
- Full parity with “commands like GSD commands” is not supported by any visible infrastructure in this extension. Achieving that would likely require embedding or reusing pi’s main command parser/dispatcher, which is outside the current local code and likely too heavy for M001.

## Common Pitfalls

- **Executing slash text as BTW chat by accident** — right now every overlay submit becomes `runBtw(...)`. Add explicit routing before that call.
- **Duplicating command semantics in a new overlay-only switch statement** — if slash support reimplements clear/new/tangent/inject/summarize behavior separately, it will drift from the proven command handlers.
- **Pretending unknown slash commands succeeded** — if unsupported commands are silently sent to the model, users may believe a command ran. Any fallback must be explicit in status/UX.
- **Breaking thread/reset invariants while adding slash support** — mode switches and clears must still append `btw-thread-reset` appropriately and preserve restore semantics.
- **Overreaching into full command parity** — R015 is deferred. Trying to make the BTW modal a second full command surface risks violating R002 and R013.

## Open Risks

- The cleanest code path may require extracting a shared internal dispatcher so both registered commands and overlay slash handling call the same logic. If that extraction is done sloppily, it could churn stable code in `extensions/btw.ts`.
- Unknown-slash fallback policy is a UX decision with real consequences: “treat as chat” is lightweight but potentially ambiguous; “reject with warning” is clearer but slightly harsher.
- The current harness does not yet test in-modal slash input. S04 will need new assertions that simulate `overlay.input.onSubmit?.("/btw:clear")` and friends, then inspect reset markers, overlay state, and sent user messages.
- If the pi runtime has hidden command-dispatch helpers outside this repo, they were not surfaced here. Research in this repo does not show an easy embeddable command surface.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| BTW workflow | installed `btw` skill | installed |
| Vitest | `onmax/nuxt-skills@vitest` | available — `npx skills add onmax/nuxt-skills@vitest` |
| TypeScript TUI / terminal UI | `pproenca/dot-skills@terminal-ui` | available — `npx skills add pproenca/dot-skills@terminal-ui` |
| pi TUI design | `joelhooks/pi-tools@pi-tui-design` | available — `npx skills add joelhooks/pi-tools@pi-tui-design` |
| TypeScript extension work | none clearly relevant found | none found |

## Sources

- The current BTW modal composer is a plain `Input` with `onSubmit`, `onEscape`, and hint text mentioning `/btw:clear`, but no slash parser or command dispatch exists in the modal path. (source: `extensions/btw.ts`)
- `submitFromOverlay()` currently sends all non-empty modal input through `runBtw(..., pendingMode)`, which means slash-prefixed text is currently treated as side-chat content. (source: `extensions/btw.ts`)
- Registered BTW commands already exist for `/btw`, `/btw:tangent`, `/btw:new`, `/btw:clear`, `/btw:inject`, and `/btw:summarize`; these are the authoritative semantics S04 should reuse. (source: `extensions/btw.ts`)
- The runtime harness already proves reset markers, restore behavior, handoff behavior, overlay dismissal, and explicit-boundary semantics, making it the right verification seam for S04 slash tests. (source: `tests/btw.runtime.test.ts`)
- README documents BTW commands and modal behavior but does not promise full main-session slash parity inside the modal, leaving room for an intentional BTW-scoped fallback policy. (source: `README.md`)
