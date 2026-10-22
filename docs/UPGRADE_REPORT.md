# Hardwood 27 — upgrade 0.2 report

Baseline: commit `6dabbbf` (the first playable milestone). Everything below
was measured in this development container: Linux, **no GPU**, Chromium
rendering through **SwiftShader (software)**. No Mac or GPU was available,
so GPU frame rates on Apple Silicon have **not** been measured. Press F3 on
your Mac to read them.

I could not watch any videos (YouTube or other) in this environment. No
observation in this report comes from gameplay footage. Reference work used
written sources only (see `docs/RESEARCH.md`) and general basketball
knowledge.

## 1. What changed and why

| Area | Files | Change |
|---|---|---|
| Rotations & fatigue | `sim/Player.js`, `sim/Simulation.js`, `sim/Match.js`, `sim/ai/Coach.js` | Exertion-based stamina (standing < jogging < sprinting, airborne cost, rating/badge modifiers), scaled to game length (`12 / quarter minutes`, clamped 1–4). Dead-ball and bench recovery, period-break recovery. Coach subs at legal stoppages only, with tired thresholds, cooldowns, clutch logic, starters returning, never a fouled-out player, never the inbounder, ball owner or FT shooter. |
| Transition | `sim/ai/TeamAI.js` | Transition window, hit-ahead passes, lane filling (wings wide, bigs rim-run or trail), push when the defence isn't back. |
| Rules | `sim/Match.js`, `sim/Simulation.js` | Out of bounds: defence-last-touch keeps offence possession (no turnover); untouched missed shot = team rebound; FT-phase handling. CPU handlers no longer drift out of bounds; holder clamped after collisions. |
| Startup robustness | `core/Platform.js`, `render/Renderer.js`, `main.js`, `core/Settings.js`, `ui/DebugHud.js`, `ui/HUD.js` | WebGL2/GPU/software-renderer detection, **Auto** quality, readable error screens with *Retry with Low graphics*, context-loss overlay and recovery, ResizeObserver + DPR change handling, delta clamp, pause on tab hide, full GPU disposal, settings schema v2 migration, F3 debug HUD. |
| Leaks | `render/Renderer.js` | DPR `matchMedia` listener kept every old renderer and scene alive; now detached on dispose. |
| Movement feel | `render/PlayerView.js`, `sim/Player.js`, `sim/Simulation.js` | Strafe protect-dribble (hold C/LT: square up to the rim and side-step), momentum lean with acceleration, banking into turns, plant crouch on hard cuts, exhausted slump. Two-bone foot IK with ankle/toe ground alignment and standing foot locks. |
| Pose bug | `render/PlayerView.js` | three.js skips writing unchanged bone values, so procedural layers compounded on idle frames and flipped the referees upside down. The clip pose is now restored before every mixer update. A browser check guards this. |
| Input | `input/InputManager.js`, `core/Game.js`, `ui/Menus.js`, `ui/HUD.js` | Ignore keys while typing; release keys on blur, tab hide and Cmd chords; pause on controller disconnect; remap swaps conflicting keys (Esc cancels); pregame controls primer. |
| Practice | `sim/Match.js`, `sim/PracticeStats.js`, `ui/PracticePanel.js`, `core/Game.js`, `ui/Menus.js` | Shot log, live shot chart, zone splits, timing error/bias, streak, coaching tip; 8 shooting spots with reset (X) and next spot (Z); instant replay (B); stand-in or active defender; ball-returned or chase-your-own-rebound modes. A defender possession is returned to the shooter and never logged. |
| Characters | `render/HumanModel.js`, `render/AnimationLibrary.js` | Neck re-proportioned (~12–13 cm wide on a 1.9 m athlete, trapezius flare, forward lean). Head/hair/beard LOD per quality. |
| Tools | `dev/ModelViewer.js`, `dev/RigCheck.js`, `render/Retarget.js` | Model viewer views/scrub/speed/skeleton/joint inspector/uniform switch; rig validation; GLB export; GLB import with name mapping and world-space retargeting. |
| Performance | `render/Arena.js`, `render/HumanModel.js` | Low preset crowd 1824 → ~1100 fans with 20-tri heads; head/hair LOD. Visible triangles at Low in a game view: ~431k → ~200k. |
| Audio | `core/Game.js`, `ui/Commentary.js`, `audio/AudioSystem.js` | Compressor + limiter on the master bus, mute (also mutes TTS), crowd lift scaled by context (clutch, fast-break dunk, lead change; free throws quiet), commentary that never repeats a recent line, fast-break/clutch/lead-change calls. |
| Tests | `tests/*.test.js`, `tests/browser/*` | +13 headless tests (rotation, rules, practice); browser journey with 20 checks and JSON metrics; Mac-portable Chrome finder; before/after capture script. |

## 2. Measurements

**Unit tests:** `npm test` → 37/37 passed (baseline had 16).

**Browser journey** (`npm run test:browser`, SwiftShader, Low quality): 20/20
checks passed. One earlier run failed the pass check because a legitimate
violation was whistled mid-pass while the software renderer ran at ~3 FPS.
The check now waits for a clean live possession.

| Metric | Value (software rendering — not representative of a Mac) |
|---|---|
| GPU string | ANGLE / SwiftShader (hardware accelerated: **false**) |
| Menu ready | 3.7 s |
| Play Now load to pregame | 35.8 s (software shader compilation) |
| FPS / render ms | 2.5 FPS, ~350 ms render per frame |
| Simulation per frame | 0.39 ms |
| Draw calls / triangles | 138 / ~199k |
| Restarts (3 identical loads) | 1 canvas, 202 geometries, 74 textures, 43 MB JS heap each time (after forced GC) |

**CPU vs CPU audits** (`node tests/audit.mjs`):

12-minute quarters, 4 seeds:

| seed | score | FGA (both) | subs | bench min (H/A) | fast-break pts | TOV |
|---|---|---|---|---|---|---|
| 1 | 112-120 | 199 | 56 | 58/61 | 16/20 | 17/23 |
| 2 | 107-103 | 196 | 66 | 76/65 | 20/10 | 10/20 |
| 3 | 143-151 | 237 | 41 | 86/52 | 20/26 | 15/12 |
| 4 | 156-113 | 215 | 48 | 63/85 | 16/20 | 12/26 |

3-minute quarters, 6 seeds: 24–54 substitutions per game, 5–18 bench minutes
per team, 0–8 fast-break points per team. Before the upgrade: 0
substitutions and end-of-game stamina 0.97–1.00 in every game.

## 3. Visual evidence

`docs/visual/*.jpg`: before (`6dabbbf`) and after, from the same scripted
camera spots (`tests/browser/compare.mjs`, Medium quality, SwiftShader):
full court, athlete front, athlete side, sprint/plant, dribble move, jump
shot near release, layup/dunk at the rim, block/rebound, main menu and
MyPLAYER builder. Game moments come from the same seed, but the two builds'
simulations differ, so the in-game frames show comparable situations, not
identical ones.

Flaws found from the screenshots and then fixed: referees rendered upside
down (compounding pose); neck as wide as the head; shoes sinking up to 10 cm
into the floor at toe-off and take-off (the rig validator measured this on
skinned vertices; now 0 failing clips); the practice panel's CSS colliding
with the player card over the score bug.

## 4. Remaining issues

**Fixed**
- No substitutions and flat stamina; no transition offense.
- Defence-last-touch out of bounds counted as an offensive turnover.
- Black screen or crash paths on WebGL failure; no context-loss handling; renderer leak across matches.
- Stuck keys on blur; game keys firing while typing; remap conflicts.
- Upside-down referees; shoes through the floor; oversized neck.

**Partially improved**
- Movement: procedural lean, banking, plants, strafe and foot IK help, but the clips are still hand-keyed (no mocap or motion matching).
- Characters: better proportions and LOD; still procedural and not photoreal. The GLB pipeline is in place, but no licensed model is shipped.
- Pace and scoring: rotations and turnovers are plausible; FGA and points per game run high.
- Audio: limiter, mute and contextual crowd/commentary; all sound is still synthesised and not positional.
- Performance: Low preset roughly halves triangles. 60 FPS on Apple Silicon is unmeasured.

**Dependencies**
- `npm audit fix` moved Vite to 7.3.7, which patches the dev-server path-traversal advisory. `npm audit` still reports advisories in vitest 3's internals (`@vitest/mocker`, `tinypool`). These are used only when running unit tests. The fix is vitest 4, but npm 10.9 currently fails to install vitest 4 here (`Cannot read properties of null (reading 'edgesOut')`), so vitest 3 is kept. Nothing from these packages ships in the game build.

**Not implemented**
- MyCAREER / offline career demo, Franchise, online multiplayer.
- Pro Stick aiming and tempo tick, per-player hot/cold zones, configurable meter position.
- Rendered bench players; recorded commentary or PA.
- Cloth simulation, facial animation, WebGPU.
