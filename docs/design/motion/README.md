# Motion design handoff

Status: **design reference, not yet integrated.** Nothing in this folder is
imported by `apps/web`. It exists so the motion work can be picked up as its
own task without re-deriving the design.

Author: Claude (design), at the founder's request, 2026-11-10.
Integrator: Codex, in a separate PR, when the founder asks for it.

## What is here

| File                | Purpose                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview.html`      | Open in a browser. A phone mock-up that plays each animation, with slow-motion and reduced-motion switches. The table beside the phone is generated from the same numbers the phone plays, so it is the source of truth for per-element values. |
| `motion-tokens.css` | The only durations, easing curves and distances the app may use.                                                                                                                                                                                |

The mock-up inside `preview.html` is illustrative. Its names, venue, copy and
markup are placeholders: **do not copy its HTML or copy text into the app.**
Apply the motion to the real components.

The mock-up is drawn with a burgundy (`#590907`) and cream (`#E8D2B5`)
palette. The app currently uses `--accent: #a3412a`. Changing the palette is a
separate founder decision and is **out of scope** for the motion task.

## Moments to animate

Sequence values (element, property change, duration, delay, easing) are in the
table shown for each moment in `preview.html`, and in the `MOMENTS` array in
its script.

| Moment                         | Trigger                                      | Plays                                        |
| ------------------------------ | -------------------------------------------- | -------------------------------------------- |
| Introduction arrives           | First time an introduction is shown          | Once per introduction                        |
| Private answer (accept / pass) | Tapping either decision button               | Once; the decision is final                  |
| Mutual match                   | First open after both answers are yes        | Once per pair                                |
| Plan confirmed                 | Second person confirms the same plan version | Once per confirmed plan version              |
| Onboarding step change         | Continue / Back with a valid answer          | Every step; Back mirrors the direction       |
| Loading and empty week         | Introductions loading, then none left        | Pulse only while loading                     |
| "Something felt off" sheet     | Tapping the entry point anywhere             | Every time, never queued behind other motion |

## Rules (these are requirements, not suggestions)

1. Use only the tokens in `motion-tokens.css`. No new durations or curves.
2. Accept and pass use the same non-directional motion. Nothing slides
   sideways on a decision; nothing may resemble a swipe.
3. No confetti, hearts, bounces, shakes, counting-up numbers or sound. The
   mutual-match screen is the only warm moment.
4. Nothing loops except the loading pulse, which stops when content arrives.
5. Animate only on a real state change. Never animate to invite another tap.
6. Nothing exceeds 600ms and no animation blocks input.
7. Honour `prefers-reduced-motion`: opacity only, 150ms or less, no travel,
   no pulse. The token file already collapses the values; component code must
   not hard-code movement that bypasses the tokens.
8. "Plays once" moments must be driven by persisted state (for example a
   seen/acknowledged timestamp from the server), not by component mount, so a
   reload does not replay them.
9. Keep WCAG 2.2 AA and 44px touch targets. Motion must not move focus
   unexpectedly; the sheet traps focus while open and returns it on close.

## Suggested integration steps

1. Copy the declarations from `motion-tokens.css` into
   `apps/web/app/globals.css`. Check the global `button` rule does not fight
   existing button styles; scope it if it does.
2. Apply the sequences to the real components for the seven moments above,
   preferring CSS transitions/animations over a JS animation library.
3. Add a Playwright run with `reducedMotion: 'reduce'` covering onboarding,
   decision, plan confirmation and the safety sheet, asserting the flows
   still complete.
4. Record the adoption in `docs/DECISIONS.md` and open a separate PR. Do not
   mix this with milestone or security work.

## Open questions for the founder

- Palette: keep the current terracotta accent or move to burgundy and cream?
- Is a server-side "seen" marker for the mutual-match moment acceptable, or
  should it be stored per device?
