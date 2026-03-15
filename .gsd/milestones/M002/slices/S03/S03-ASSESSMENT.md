# S03 Assessment — M002 roadmap after S03

Verdict: **no roadmap rewrite needed.** S03 retired the risks it was supposed to retire, and the remaining work still belongs in **S04: Contract hardening and cleanup**.

## Success-Criterion Coverage Check

- User can open BTW, ask it to read a file, and see the tool call and result rendered in the overlay transcript → S04
- User can type any slash command in the BTW overlay and have it execute through the sub-session's own command dispatch → S04
- Main session continues accepting input and streaming while BTW is actively running tools in the overlay → S04
- Dismissing BTW with Escape cleanly disposes the sub-session with no orphaned agent loops or leaked resources → S04
- Inject/summarize still hand BTW content back to the main session explicitly → S04
- BTW opens fast enough that the sub-session creation overhead is not perceptible → S04

Coverage check result: **pass**.

## Why the roadmap still holds

- **S03 retired its intended risks.** Slash routing now uses the real sub-session `prompt()` path, handoff now derives from sub-session history, and parallel BTW/main-session behavior is explicitly proven in the runtime harness.
- **No new ordering problem emerged.** Nothing from S03 suggests a new slice, a reordered slice, or a split/merge. The remaining work is still “prove everything together, harden contracts, and remove obsolete compatibility code.”
- **The boundary map is still broadly correct.** S04 still needs to consume the sub-session lifecycle, event-driven transcript, slash-routing contract, and handoff extraction seams that S01–S03 established.
- **Concrete cleanup work still exists.** `extensions/btw.ts` still carries compatibility/persistence bridge state such as `pendingThread`, plus a narrow handoff fallback to persisted thread data when no active/recreatable sub-session is available. That is exactly the kind of cleanup/hardening work S04 is for.

## Clarification for S04 cleanup

One seam is now clearly **intentional**, not dead plumbing: the overlay-owned BTW command boundary (`parseOverlayBtwCommand()` / `dispatchBtwCommand()`) that intercepts only BTW lifecycle/handoff commands. S04 should preserve that D020 behavior while removing obsolete M001-era fallback/manual paths around it.

## Requirement coverage

Requirement coverage remains sound.

- **No requirement status changes** are needed from S03 reassessment.
- S03's validations for **R015**, **R021**, and **R022** still stand.
- The remaining active requirements (**R001**, **R002**, **R004**) keep credible coverage through existing owning slices; S04 is hardening/proof work, not a scope change.

## Evidence checked

- `extensions/btw.ts`
- `tests/btw.runtime.test.ts`
- `npm test -- tests/btw.runtime.test.ts`
