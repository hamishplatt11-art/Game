# Hardwood 27: HTML5 basketball simulation

A 3D, 5-on-5 basketball game for desktop browsers, built with Three.js and
WebGL2. It is inspired by the on-court feel of modern NBA 2K games: timing-based
shooting with a meter, right-stick dribble moves, dynamic layups and a dunk
meter, contest-aware shots, team AI, NBA rules and a broadcast presentation. It
uses original code and assets and a fictional league.

> **Status: upgraded playable build.** Play Now (full 5v5 with real
> rotations), Blacktop (1v1–5v5), Practice (shot lab with chart, replay and
> defender options) and the MyPLAYER builder work end to end. Characters and
> animations are original procedural models and hand-keyed clips, **not**
> photoreal scans or motion capture. A GLB import/retarget path exists for
> legitimately sourced character models. See [Missing features](#missing-features),
> [docs/UPGRADE_REPORT.md](docs/UPGRADE_REPORT.md) and [docs/ASSETS.md](docs/ASSETS.md).

## Quickest way to play (no `npm install`)

The repository includes a ready-built copy of the game in `prebuilt/`, plus a
small launcher that needs nothing but Node.js:

```bash
cd Hardwood27
node play.mjs            # opens http://localhost:8080 in your browser
```

Use this if `npm install` is blocked (for example, by a certificate error
on your network). Tests and the dev server still need `npm install`.
Maintainers: refresh `prebuilt/` after changing the code with
`npm run prebuild:refresh`.

## Run it on a Mac

Requirements: macOS 12+, [Node.js 18 or newer](https://nodejs.org/) (the LTS
installer, or `brew install node`), and Chrome, Edge, Safari 15+ or Firefox
with hardware acceleration on (the default).

```bash
cd Hardwood27            # the unzipped folder
npm install              # one time: three, vite, vitest, playwright-core
npm run dev              # dev server; open the printed URL, normally http://localhost:5173
```

Production build:

```bash
npm run build            # writes dist/ (must finish without errors)
npm run preview          # serves dist/ at http://localhost:4173
```

Opening `index.html` straight from Finder does not work: ES modules need the
local server above. The same commands work on Windows and Linux.

**If `npm install` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`:** your
network or security software is re-signing HTTPS traffic, and Node doesn't
trust its certificate. Run `npm config get cafile` and
`npm config get strict-ssl`, and remove stale settings with
`npm config delete cafile` / `npm config set strict-ssl true`. Then try
`NODE_OPTIONS=--use-system-ca npm install` (Node 22.15+/23.8+; this trusts
your macOS Keychain), try another network, or point npm at the
organisation's root certificate with `npm config set cafile /path/to/root.pem`.
`vite: command not found` just means the install didn't finish.

**Graphics quality.** Settings → Graphics → Quality defaults to **Auto**, which
picks a preset from the detected GPU (Apple M-series → High, integrated →
Medium, software rendering → Low). If the browser has no WebGL2 or is using a
software renderer, the menu says so and explains how to turn hardware
acceleration on. If the 3D scene fails to start, an error screen offers
**Retry with Low graphics** instead of a black screen. Press **F3** in game for
the developer HUD (GPU, WebGL2, FPS, median/95th-percentile frame time, draw
calls, triangles, camera, simulation phase, controlled player, ball, input).

Developer views:
- `?view=model`: character viewer with front/side/back/three-quarter/top
  views, clip list with play/pause/speed and a timeline scrubber, skeleton
  overlay and joint inspector, team/player/uniform switching, **Validate rig**
  (bones, skin weights, symmetry, per-clip floor contact), **Export GLB** and
  **Import GLB** (maps a Mixamo/UE/Blender-style skeleton onto this rig and
  retargets the selected clip live). URL parameters: `team`, `p`, `uni`,
  `clip`, `t`, `view`, `yaw`, `pitch`, `dist`, `glb`.
- Settings → Gameplay → **Performance overlay**.

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
  models with painted textures. No licensed NBA players, teams, uniforms or
  2K assets are included. Photoreal athletes need a legitimately sourced or
  commissioned GLB; the import/retarget path in `src/render/Retarget.js` is
  the hook for that.
- **Motion capture / motion matching.** Clips are hand-keyed. On top of them
  the game now layers momentum lean, turn banking, plant crouch, fatigue
  posture, strafe dribbling, two-bone foot IK with ground alignment and
  standing foot locks, but there is no mocap, motion matching, motion warping
  or cloth simulation.
- MyCAREER, Franchise/MyNBA and online multiplayer are not implemented (they
  stay labelled "In development"). The MyPLAYER builder player can be used in
  Practice and Blacktop.
- Pro Stick aiming and a tempo tick are not implemented.
- Bench players are not rendered (they exist in the simulation and rotate in).
- Audio is synthesised (no recorded samples); commentary is text with
  optional, labelled browser text-to-speech. Sound is not positional.
- No WebGPU path; WebGL2 only. Physics is custom (not Rapier), see notes.

## Known issues

- 60 FPS on Apple Silicon is the target but has **not been measured** by the
  developer (no Mac/GPU was available; see the report). Use F3 on your Mac.
- CPU-vs-CPU pace is high in 12-minute quarters: about 200–235 combined field
  goal attempts and 100–150 points per team (NBA ≈ 175 FGA, ≈ 115 points).
- Shoulders, armpits, hands and ears are simplified; close-ups show seams.
- Players can be pushed out of bounds through body contact (called as a
  violation unless the defence touched the ball last).
- Software-rendered browsers (no GPU) run at roughly 2–3 FPS; the game warns
  about it and drops to Low quality.

## Testing

```bash
npm test                     # 37 headless simulation tests (vitest)
npm run test:browser         # end-to-end browser journey with metrics (20 checks)
npm run test:browser:all     # journey + practice + model viewer + in-game captures
node tests/audit.mjs 12 4    # multi-seed box-score / rotation audit (12-min quarters, 4 games)
node tests/browser/compare.mjs <projectRoot> <outDir>   # 10 visual checkpoints
```

Headless suites (`tests/*.test.js`): ball physics; full seeded 5v5 game
reaching a final with consistent box scores and five players per side;
**rotations** (substitutions, real bench minutes, no fouled-out returns, subs
only at stoppages), fatigue and bench recovery, fast-break points over a
sample, Blacktop 1v1/3v3/5v5 to target, buzzer-beater timing; **rules**
(seeded determinism, 2 vs 3 points, contest effect, out-of-bounds rulings,
shooting-foul free-throw counts, shot clock, travelling); user input
(Excellent release, early release, pump fake, crossover, stepback, pass,
switch, steal); **practice** (shot log/summary, spots and reset, stand-in vs
active defender, defender possessions returned).

Browser tests (`tests/browser/`, Playwright driving a real Chrome): the
journey boots to a visible 3D menu, checks settings persistence, remapping
with conflict swap, Play Now via the UI, real keyboard play, shoot/pass/
switch/camera/pause/resume/quit, resize, blur, WebGL context loss and
restore, two restarts with no canvas/GPU/JS-heap growth, every character
upright, Blacktop 3v3 to 11, Practice meter and shot log, typing in a text
field, and no page errors. It writes `tests/browser/out/journey.json`,
including the GPU string and whether rendering was hardware accelerated.

**Browser binaries (Mac):** the scripts use, in order, `$CHROME`, an installed
Google Chrome / Chrome Canary / Chromium / Edge in `/Applications`, then the
Playwright cache (`~/Library/Caches/ms-playwright`, filled by
`npx playwright install chromium`). On a Mac they use the real GPU;
SwiftShader is used only on GPU-less Linux machines (or with `SOFTWARE_GL=1`).
Set `HEADED=1` to watch the run.

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
  dev/ModelViewer.js      character viewer (?view=model): views, scrub, joints, GLB import/export
  dev/RigCheck.js         rig validation (bones, weights, symmetry, per-clip floor contact)
  render/Retarget.js      GLB loader, skeleton name mapping, world-space retargeting
  core/Platform.js        GPU / WebGL2 / software-renderer detection, auto quality
  ui/DebugHud.js          F3 developer HUD
  ui/PracticePanel.js     practice shot chart and analysis (sim/PracticeStats.js)
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
   sculpted bodies) and bring them in through `Retarget.js` (or skin them to
   the `BONES` rig), and add facial blendshapes.
2. **Animation:** record or license basketball mocap. Add
   motion matching for locomotion and motion warping for layups and dunks.
   Grow toward the "29 movement components" dribble system.
3. **Shooting feel:** Pro Stick aiming and tempo tick (rhythm shooting), and
   per-player jumpshot bases.
4. **AI tuning:** run stat-sampling to calibrate pace, three-point rate,
   turnovers and fouls to league averages per difficulty. Add more set plays,
   such as Spain pick-and-roll, floppy and hand-offs.
5. **Presentation:** bench players, broadcast intros and halftime
   show, and recorded commentary.
6. **Modes:** MyCAREER on top of the MyPLAYER builder, then MyNBA. Online play would
   need server-authoritative simulation; the headless deterministic simulation
   is designed to make this possible.
