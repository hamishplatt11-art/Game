# NBA 2K27 gameplay research notes

This document records what was actually researched for this project, which
sources could not be accessed, and how each researched mechanic maps to an
implementation in the code.

## What was and was not inspected

| Source | Status |
|---|---|
| YouTube: official gameplay trailer (`vQ2jNNbh1TU`) | **Not watched.** The development environment cannot play video. Fetching the page returned only YouTube's navigation and footer, with no title, description, chapters or transcript. |
| YouTube: Courtside Report, Gameplay (`ukgQhX1m34g`) | **Not watched.** Same limitation. |
| YouTube: extended 4K gameplay (`EDhwrj9eoOU`) | **Not watched.** |
| YouTube: The City Courtside Report (`y6uPM73HsKI`) | **Not watched.** |
| YouTube: MyNBA Courtside Report (`GqulFBLQRbg`) | **Not watched.** |
| YouTube search phrases from the brief | **Not run.** No video search or playback was available. |
| 2K newsroom: "NBA 2K27 Gameplay Unleashes Complete On-Court Control…" | **Read** (text). Findings below. |
| 2K newsroom: "MyNBA… back-to-basics franchise overhaul and modern CBA rules" | **Read** (text). Findings below. |
| 2K ANZ newsroom: "MyPLAYER Builder… Badge Tokens… Synergy" | **Read** (text). Findings below. |
| nba2klab.com "how to dribble" | **Read.** Only the signature size-up input was in the page text: quickly move the right stick left and right repeatedly. Other move inputs are in embedded videos and were not accessible. |
| nba2klab.com "learn to dribble" | Not fetched. |

**Everything listed under "requires visual inspection" below is still
unverified.** Controller mappings and timings that are not quoted from the
text sources come from long-standing NBA 2K conventions (prior editions), not
from 2K27 footage.

## Findings from the official text (2K27 Gameplay article)

- **Dribbling:** "Expanded Dribbling Customization" breaks signature packages
  into **29 decoupled movements** that can be combined.
- **Rhythm Shooting:** returns with a Shot Meter that shows the ideal tempo,
  using "a tick mark synced to Pro Stick movement". A Rhythm Shot requires
  **greening the Timing**. Rhythm shooting now extends to free throws for Pro
  Stick shooters.
- **Dynamic Layup Engine:** "adjusts movements mid-air for unique, clean finishes."
- **Dunk Meter:** "logic-driven… more realistic outcomes all the way to the rim."
- **Step-through up-and-under:** new move for separation.
- **Hands-up defence:** choose more or less aggressive contests.
- **Shot contest feedback:** colour-coded quality **and the direction it came from**.
- **Defensive cutoffs:** an expanded system lets skilled defenders match offensive combos.
- **Ankle breakers:** skill-based and logic-driven (not random).
- **Ball collision system:** compares both players' ratings to decide if a
  cutoff or steal dislodges the ball, while giving the handler a chance to recover it.
- **Takeover:** 5 disciplines (Shooting, Finishing, Playmaking, Defense,
  Rebounding), each with a meter that rises and falls with performance across
  **6 tiers**; a maxed meter auto-triggers the equipped ability.
- **AI:** "Set AI" keeps facilitators at the hub of the offence; gameplans adapt
  to matchups in real time; Enhanced Matchup Switching.
- **Animation:** ProPLAY, 7,000+ new animations (proprietary, not used here).

## Findings from MyPLAYER / MyNBA articles

- 53 badges (19 new), 20 badge slots across six disciplines (Physicals is
  new), Badge Tokens earned from performance, 16 Synergy slots, loadouts.
- 40 signature blueprints; build performance depends on height, weight,
  wingspan and ratings.
- MyNBA: Second/First Apron rules, incentives (Guaranteed, Likely or
  Unlikely), 10-day contracts, buyout market, 4-team trades with up to 9
  assets, 3-2-1 lottery, NBA Cup, rule-change engine and a morale system.
  **None of MyNBA is implemented yet.**

## Mechanic → implementation map

Each row lists the event, input, preconditions, animation, displacement, ball,
defender reaction, camera, resulting state, assets and acceptance test.

| Mechanic | Input (keyboard / pad) | Preconditions | Animation | Displacement | Ball | Defender reaction | Camera | Result | Assets | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|---|
| Jump shot (rhythm/green) | Hold `J` / `X` or hold RS down, release at the set point | Holder with ball, not inbounding | `jumpShot`/`fadeaway`/`hook`; the release key is time-locked to the sim's ideal release | Momentum decays; fadeaway drifts back | Solved trajectory from the release point; physical make detection | AI contests or blocks with a reaction delay; contest value from distance, angle, hands, reach and timing | Unchanged | Make/miss resolved by physics; FGA/FGM | Procedural clip | `tests/user.test.js`: an exact release grades Excellent and goes in |
| Pump fake | Tap `J` | Holder | `pumpFake` | None | Held | Low-awareness defenders may bite and jump | — | Dribble picked up | Clip | `user.test.js` pump-fake test |
| Dribble moves (crossover, between legs, behind back, hesitation, in-and-out, spin, half spin, stepback, side-step, escape, snatchback, size-up, jab, drop step) | Arrow keys / RS flick (relative to ball hand), `R` / RS rotate = spin, `E` = size-up | Live dribble (or triple threat for jab) | `crossL`/`crossR`/`hesi`/`spin`/`stepback`/`sizeup`/`jab` | Root-motion curves per move, keeps entry momentum | Ball crosses hands over a bounce; hand IK tracks the ball | Ankle-breaker logic: committed defender velocity vs move direction, ratings and badges | — | Hand switch, shot-ready window, defender stumble/fall | Clips | `user.test.js` crossover and stepback tests |
| Layups (standard L/R, euro, hop, reverse, finger roll, spin, up-and-under, step-through) | `J` near the rim; hold an arrow/RS for euro (left/right) or hop (down) | Driving within ~4.4 m | Per-style clips mapped to sim takeoff and release times | Gather steps then an arc to the rim | Soft-arc solve; physical make | Rim protectors contest; mid-air adjustment against block attempts | — | Make/miss | Clips | Headless match produces layups and adjustments (`midairAdjust` events) |
| Dunks (one/two hand, tomahawk, windmill, reverse, power, standing, alley-oop) | Sprint + `J` near the rim; dunk meter by release | Rating and vertical allow it | Dunk clips locked to takeoff and slam | Takeoff, rise, rim hang | Ball driven down through the rim; failed dunks hit the back rim | Pressure narrows the meter window live; contact dunks stagger defenders | — | Score / miss | Clips | `dunk` and `poster` events in the match tests |
| Passing (chest, bounce, lob, alley-oop, icon) | `K`/`L`/`I`, `Q`+1–4 | Holder | Pass clips | Slight slowdown | Drag-compensated timed solve with lead; bounce passes hit the floor | Lane geometry interceptions and deflections | — | Catch / turnover | Clips | `user.test.js` pass test; pass completion analysis |
| On-ball D / cutoffs | `C` stance, WASD | Off ball | `defIdle`/`shuffleL/R`/`backpedal`/`handsUp` | Lateral shuffle speed by ratings | — | Body contact: charge, block or cutoff; rating-based ball dislodge | — | Fouls or loose ball | Clips | Fouls/strips appear in headless games |
| Steals | `F` / `X` on D | Near the holder | `steal` | — | Clean steal or poke-out | Reach-in risk when shielded | — | Steal / foul | Clip | `user.test.js` steal attempt |
| Blocks / contests / rebounds | `Space` / `Y` | — | `block`/`contest`/`rebound` | Jump | Physical hand-to-ball checks, goaltending | — | — | Block / goaltend / rebound | Clips | Block events in headless games |
| Takeover | Automatic | Performance | — | — | — | — | — | 6-tier meters, auto activation | — | `takeover` events |

## Requires visual inspection (not yet verified)

- Exact NBA 2K27 controller layout and Pro Stick gestures for each of the 29 dribble components.
- Shot meter visual design, size and placement in 2K27.
- Default 2K27 gameplay camera height, zoom and tracking behaviour.
- Animation durations: gather, release and landing timings; dribble move lengths.
- Pass speeds, typical possession flow and CPU spacing in continuous footage.
- The City and Blacktop presentation details.
- Broadcast HUD layout and colours.
