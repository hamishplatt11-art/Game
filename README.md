# Hardwood 27: HTML5 basketball simulation

A 3D, 5-on-5 basketball game for desktop browsers, built with Three.js and
WebGL2. It is inspired by the on-court feel of modern NBA 2K games: timing-based
shooting with a meter, right-stick dribble moves, dynamic layups and a dunk
meter, contest-aware shots, team AI, NBA rules and a broadcast presentation. It
uses original code and assets and a fictional league.

> **Status: first playable milestone.** Full 5v5 Play Now games, Blacktop
> (1v1–5v5) and Practice work end to end. Characters and animations are
> original procedural stand-ins, not photoreal scans or motion capture. See
> [Missing features](#missing-features) and [docs/ASSETS.md](docs/ASSETS.md).

## Run it

Requires Node 18+ and a desktop browser with WebGL2 (Chrome, Edge or Firefox).

```bash
npm install          # install dependencies (three, vite, vitest, playwright-core)
npm run dev          # start the dev server at http://localhost:5173
npm run build        # production build into dist/
npm run preview      # serve the production build at http://localhost:4173
npm test             # headless simulation tests (physics, rules, full matches, user input)
npm run test:browser # Chromium smoke test (needs a Chromium binary, see below)
```

Open the printed URL. Opening `index.html` directly from disk does not work,
because ES modules need a server.

Developer views:
- `?view=model`: character and animation viewer. Pick a clip, drag to orbit,
  scroll to zoom. Parameters: `team`, `p`, `uni`, `clip`, `t`.
- Settings → Gameplay → **Performance overlay** shows FPS, simulation and
  render milliseconds, draw calls, triangles and heap.

## Controls

### Keyboard (all keys can be remapped in Settings → Controls)

| Key | Offence | Defence |
|---|---|---|
| `W A S D` | Move (screen relative) | Move |
| `Shift` | Sprint | Sprint |
| `J` | Hold to shoot, release at the top of the meter. Tap to pump fake. Near the rim: layup (hold `Shift` to dunk) | — |
| `K` | Chest pass (toward the movement direction). Off ball: call for the ball | — |
| `L` / `I` | Bounce pass / lob (lob to a cutter = alley-oop). Off ball, `I` calls for an alley-oop | — |
| `Q` + `1–4` | Icon pass | — |
| `Arrow keys` | Dribble moves, relative to your ball hand (below) | `↑` hands up |
| `R` / `E` | Spin / size-up combo | — |
| `C` | Hold: protect the dribble. Tap near the paint: post up | Hold: defensive stance |
| `F` | — | Steal |
| `Space` | — | Block, contest or rebound (contextual) |
| `G` | Call for a screen (pick-and-roll) | — |
| `V` / `H` | — | Take charge / hands up |
| `Tab` | — | Switch to the defender nearest the ball |
| `T` | Timeout | Timeout (dead ball) |
| `M` | Cycle camera | Cycle camera |
| `Esc` / `P` | Pause | Pause |

**Dribble moves (arrow key or right-stick flick):**
- Toward your off hand: crossover.
- Back toward your off hand: between the legs.
- Back toward your ball hand: behind the back.
- Toward your ball hand: in-and-out, or side-step when standing.
- Forward: hesitation.
- Straight back: stepback, snatchback when moving, escape when sprinting.

Moves chain into combos, and a stepback or side-step opens a rhythm-jumper window.

**Layup direction:** hold `←`/`→` while pressing `J` for a Euro step, `↓` for a hop step.

### Gamepad (Xbox / PlayStation, standard mapping)

Left stick moves. RT sprints. X/□ shoots and steals. A/✕ passes and switches.
B/○ bounce passes and takes charges. Y/△ lobs and blocks. RB + face button is
icon passing, LB calls for a screen, LT posts up or plays intense D.

The right stick handles dribble moves (flick), spin (rotate), Pro Stick jumpers
(hold down, release to shoot) and hands up on defence. View calls a timeout,
Menu pauses, D-pad up cycles the camera.

Settings → Controls includes a live **controller test** (axes, buttons,
detected flicks, holds and rotations). The layout follows long-standing NBA 2K
conventions and has not been verified against NBA 2K27 footage (see
[docs/RESEARCH.md](docs/RESEARCH.md)).

## Implemented features

**Simulation (headless, deterministic, seeded)** (`src/sim`)
- NBA Rule 1 court geometry: 94×50 ft, 10 ft rim, 18" rim, 4 ft board offset,
  23.75/22 ft three-point line, 16 ft lane, 15 ft free-throw line, restricted area.
- Ball physics with gravity, quadratic drag, floor restitution with spin and
  friction, rim torus and backboard box collisions, and net damping. A basket
  only counts when the ball physically passes down through the ring. Shots and
  passes are solved on the same integrator, so make/miss outcomes, timing
  grades and the visible flight agree.
- Momentum-based movement: acceleration and deceleration by rating, planted
  cuts on sharp turns, wider turns at speed, defensive shuffle speed,
  sprint stamina drain and recovery, and inelastic body collisions weighted
  by mass and strength.
- Shooting: catch-and-shoot, pull-up, stepback, fadeaway, hook, floater and
  free throws. Release timing is graded (Excellent / Slightly Early/Late /
  Early/Late / Very Early/Late) against a window sized by rating, badges,
  takeover, contest and difficulty. User greens follow a "green = make unless
  heavily contested" rule. Contests use distance, angle, hands, airborne
  timing and reach versus release height, and report the direction.
- Dribbling: 14 moves with root motion, hand switching, combos, steal
  exposure windows, stamina cost and logic-driven ankle breakers (defender
  momentum versus move direction and ratings).
- Finishing: dynamic layup selection (standard, Euro, hop, reverse, finger
  roll, spin, up-and-under, step-through) with mid-air adjustment against shot
  blockers. Dunks (one/two hand, tomahawk, windmill, reverse, power, standing)
  use a dunk meter whose window narrows live with defensive pressure. Contact
  "poster" dunks and alley-oops are included.
- Passing: chest, bounce, lob, alley-oop and icon passes with lead and
  accuracy. Interceptions and deflections depend on lane geometry and timing.
- Defence: stance, cutoffs with rating-based ball dislodging, steals with
  reach-in risk, blocks and goaltending from hand-to-ball geometry,
  box-outs and contested rebounds.
- Rules: 24-second shot clock (14 on offensive rebounds off the rim),
  8-second and backcourt violations, offensive and defensive 3 seconds,
  out of bounds, travelling and double dribble (user), shooting, personal,
  blocking, charge, reach-in, moving-screen, loose-ball and technical fouls,
  and-ones, bonus free throws, foul-outs, goaltending, jump-ball tip-off,
  alternating period possession, timeouts, substitutions, quarters, halftime
  side switch, overtime, and the game clock stopping after makes in the last
  two minutes.
- Team AI: formations (5-out, 4-out-1-in, horns), play calling (pick-and-roll
  and pick-and-pop, isolation, post-ups, motion with backdoor cuts),
  mismatch hunting, transition pushes, drive-and-kick, utility-scored shot,
  pass and drive decisions with a clock-dependent quality bar, man and 2-3
  zone defence, help and closeouts, switching on screens, contests, steals
  and rebounding.
- Coaching AI: scheme changes, timeouts to stop runs, and fatigue and foul-trouble rotations.
- Ratings (30 attributes), 17 badges with tiers, and Takeover (5 disciplines × 6 tiers).
- Full box score: points, field goals, threes, free throws, rebounds,
  assists, steals, blocks, turnovers, fouls, minutes and plus-minus. Team
  stats cover paint, fast-break, second-chance and bench points and the biggest lead.

**Presentation** (`src/render`, `src/ui`, `src/audio`)
- Procedurally generated rigged athletes: 24 bones, height, wingspan and
  weight per player, muscle relief, sculpted heads with eyelids, hair and
  beards, and uniforms with names and numbers.
- About 50 hand-keyed clips. A locomotion blend tree uses a shared,
  stride-synced gait phase. One-shot clips are time-locked to simulation
  events, with two-bone arm IK on the ball and head look-at.
- Arena: painted regulation hardwood, glass backboards, rims, cloth-simulated
  nets, padded stanchions, live shot clocks, an instanced crowd (up to ~9,000)
  that reacts to plays, LED ribbons, scorer's table, benches and a jumbotron.
  Blacktop uses an outdoor court.
- Cameras: 2K-style elevated (default), broadcast, sideline, high and
  player-follow, plus cinematic pregame and replay orbits and a free-throw camera.
- Instant replays of dunks, blocks, ankle breakers and alley-oops.
- HUD: score bug with possession, timeouts and fouls; shot clock; player
  panel with stamina and takeover; shot, dunk and layup meters; contest
  feedback; banners; captions; icon-pass badges; move labels.
- MyPLAYER builder: name, number, position, height, weight, wingspan, skin
  tone, hair, facial hair, blueprint (archetype), and 60 skill points across
  six categories with physique-based caps (size trade-offs). Jumper release
  speed and arc are adjustable. It has a live 3D preview, is saved locally,
  and plays in Practice and Blacktop.
- Three referees (lead, trail, slot) follow the play.
- Menus: Play Now (teams, uniforms, control side, difficulty, quarter length),
  Blacktop (size, target, scoring, make-it-take-it), Practice (player,
  defender), Settings (graphics, audio, gameplay, camera), key remapping and
  controller test. Pregame, pause, box score, substitutions, timeout,
  halftime and final screens are included.
- Synthesised audio: dribbles, squeaks, rim, board, swish, whistle, buzzer,
  crowd ambience and reactions, and menu music. Text commentary can
  optionally be voiced by browser TTS.
- Graphics presets: Low, Medium, High (bloom, 2K shadows) and Ultra (planar
  floor reflection, 4K shadows).

## Missing features

- **Photoreal characters and real likenesses.** Characters are procedural
  stand-ins, and no licensed NBA players, teams or uniforms are included.
- **Motion-captured animation.** The clip library is hand-keyed and much
  smaller than a AAA library. It has no foot IK planting, motion matching or
  motion warping, and no full cloth simulation.
- MyCAREER (season and career progression), Franchise/MyNBA and online
  multiplayer are not implemented; they are marked "In development" in the
  menu. The MyPLAYER builder exists, but its player can only be used in
  Practice and Blacktop for now.
- The Pro Stick shot is "hold down, release" only. There is no aiming and no
  tempo tick on the meter.
- Bench players are not rendered. Referees are on the floor but are visual
  only; calls come from the rules engine.
- Commentary is text only (optional browser TTS); there is no recorded commentary.
- No WebGPU path; the renderer is WebGL2 only.
- The physics layer is custom code, not Rapier. The ball and body collisions
  were written for this game (see "Technical notes").

## Known issues

- Shoulders, armpits and hands are simplified, so close-ups show seams where
  the arms join the torso.
- Fast direction changes can still show some foot sliding, because there is no foot IK yet.
- CPU box scores are in an NBA-like range but not tuned to league averages.
  Turnovers (out-of-bounds plays) and three-point volume for some teams run high.
- Players can be pushed out of bounds through body contact, as in real play,
  which is called as a violation.
- In software-rendered browsers (no GPU) the game runs at about 1 FPS. It
  needs a hardware-accelerated WebGL2 GPU.

## Testing

- `npm test` runs:
  - `tests/physics.test.js`: ball rests on the floor; centred shots from 300
    random spots go through the rim more than 97% of the time; front-rim aims
    miss and hit the rim; entry angle is above 38°.
  - `tests/match.test.js`: a full CPU-vs-CPU game reaches a final with five
    players per side every step. Team scores equal the box score, and
    per-player points equal 2×FG2 + 3×FG3 + FT. Possession changes, passes,
    rebounds and period ends occur. A 3v3 Blacktop game reaches its target.
  - `tests/user.test.js`: the user input path. A perfectly timed jumper grades
    Excellent and goes in; an early release grades early; a tap is a pump fake
    that picks up the dribble; a flick crosses over and switches hands; a back
    flick is a stepback with a jumper window; the user can pass to a teammate,
    switch on defence and attempt a steal.
- `npm run test:browser` builds the game, launches Chromium and walks from
  the menu through setup, loading, pregame and tip-off into live play. It
  records console errors and screenshots in `tests/browser/out/`.
  `tests/browser/shots.mjs` and `tests/browser/ingame.mjs` capture character
  and in-game close-ups. Set `CHROME=/path/to/chrome` if Chromium is not under
  `/opt/pw-browsers`.
- `node tests/runMatch.mjs [quarterMinutes] [seed]` simulates a match
  headless and prints the box score (about 25× real time).

Measured in this development container (no GPU): the simulation step for 10
players costs about 0.04 ms in Node. In headless Chromium with SwiftShader
software rendering, a full arena frame takes about 220 ms. GPU frame times
have **not** been measured yet; use the in-game performance overlay on real
hardware.

## Project structure

```text
index.html, vite.config.js, package.json
src/
  main.js                 app shell: menu scene, routing, services
  core/                   Game session loop, settings, events, math, seeded RNG
  sim/                    headless simulation (no Three.js)
    constants.js          NBA court geometry
    BallPhysics.js        ball integrator and rim/board/net/floor collisions
    ShotSolver.js         launch solvers on the same integrator
    Player.js             movement, stamina, balance
    Attributes.js         ratings, archetypes, badges
    Shooting.js           timing windows, contests, make probability, aim points
    DribbleMoves.js       move library and right-stick classification
    Simulation.js         ball ownership, actions, user input, collisions, fouls
    Match.js              rules engine and match state machine
    Takeover.js           takeover meters
    ai/TeamAI.js, ai/Coach.js
  render/                 Renderer, Arena, NetView, HumanModel, AnimationLibrary, PlayerView, BallView, CameraSystem, Textures
  ui/                     HUD, Menus, Commentary
  input/InputManager.js   keyboard + gamepad, flicks/holds/rotations, remapping
  audio/AudioSystem.js    Web Audio synthesis
  dev/ModelViewer.js      character/animation viewer (?view=model)
  data/rosters.json       fictional league (6 teams × 9 players)
docs/RESEARCH.md          what was researched, what still needs visual verification
docs/ASSETS.md            asset manifest and licensing
tests/                    vitest + Playwright tests
```

## Technical notes

- **Fixed timestep:** the simulation runs at 60 Hz in fixed steps (at most
  5 per frame to avoid a spiral of death). Rendering interpolates positions,
  so shot timing and physics don't depend on frame rate.
- **Why no Rapier:** the ball needs exact sphere–torus rim contact,
  thin-board contact and a solver that matches the live integrator exactly.
  Rapier's solver would break the "planned trajectory = actual trajectory"
  guarantee. Player bodies are kinematic, momentum-driven circles, which is
  enough for basketball contact.
- **Rosters** are data (`src/data/rosters.json`). A licensed roster in the
  same schema can be dropped in without engine changes.

## Suggested next priorities

1. **Characters:** commission or license GLB athletes (scanned heads,
   sculpted bodies) on the `BONES` rig, and add facial blendshapes.
2. **Animation:** record or license basketball mocap. Add foot-plant IK,
   motion matching for locomotion and motion warping for layups and dunks.
   Grow toward the "29 movement components" dribble system.
3. **Shooting feel:** Pro Stick aiming and tempo tick (rhythm shooting), and
   per-player jumpshot bases.
4. **AI tuning:** run stat-sampling to calibrate pace, three-point rate,
   turnovers and fouls to league averages per difficulty. Add more set plays,
   such as Spain pick-and-roll, floppy and hand-offs.
5. **Presentation:** referees, bench players, broadcast intros and halftime
   show, and recorded commentary.
6. **Modes:** MyCAREER on top of the MyPLAYER builder, then MyNBA. Online play would
   need server-authoritative simulation; the headless deterministic simulation
   is designed to make this possible.
