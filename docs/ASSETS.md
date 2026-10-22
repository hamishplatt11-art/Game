# Asset manifest and licensing

The game uses no third-party art, models, animations, audio or fonts. Every
visual and audio asset is generated at runtime by original code in this
repository. No NBA, NBA 2K, team or player trademarks, likenesses or uniforms
are included. The league, teams and players are fictional.

| Asset | Source | Licence | Location | Skeleton compatibility | Animation compatibility | Quality status | Intended usage |
|---|---|---|---|---|---|---|---|
| Athlete body mesh (torso, limbs, hands, muscle relief) | Procedural generator, original code | Project code | `src/render/HumanModel.js` | 24-bone rig (`BONES`) | All clips in `AnimationLibrary` | **Development stand-in.** Clearly human with correct proportions, but not photoreal. Shoulder joins and hands are simplified. | All players |
| Head, face, eyes, eyelids, ears | Procedural sculpt plus a painted face texture | Project code | `HumanModel.js`, `Textures.js` | `head` bone | Look-at | **Development stand-in.** Not likeness-grade, and no facial animation. | All players |
| Hair and beards | Shells grown from the sculpted head plus a noise texture | Project code | `HumanModel.js` | `head` bone | — | Basic styles only (buzz, short, fade, afro, twists, braids, long). | All players |
| Uniforms (jersey, shorts, socks, shoes, sleeves, headband) | Procedural geometry plus canvas textures (names, numbers, trims) | Project code | `HumanModel.js`, `Textures.js` | Skinned to the same rig | Bone-driven deformation only, no cloth simulation | Functional | All players |
| Animation clips (~50: locomotion, shots, layups, dunks, passes, dribble moves, defence, falls) | Hand-keyed in code | Project code | `src/render/AnimationLibrary.js` | 24-bone rig | Blended by `PlayerView` | **Development quality.** Original keyframes, not motion capture. | All players |
| Court floor, lines, logos | Canvas-painted hardwood with markings to NBA Rule 1 dimensions | Project code | `src/render/Arena.js` | — | — | Good | Arena |
| Hoops, nets, stanchions, shot clocks, arena bowl, crowd, LED boards, jumbotron | Procedural geometry and canvas textures | Project code | `Arena.js`, `NetView.js` | — | Crowd uses an instanced shader animation | Good for crowds at gameplay distance | Arena |
| Basketball | Sphere with a pebbled leather canvas map | Project code | `BallView.js`, `Textures.js` | — | — | Good | Ball |
| Sound effects, crowd, music | Web Audio synthesis | Project code | `src/audio/AudioSystem.js` | — | — | Functional, not studio quality | Audio |
| Commentary | Generated text, optionally voiced by the browser's speech engine | Project code | `src/ui/Commentary.js` | — | — | Basic | Presentation |

## Replacing characters with licensed assets

To reach scanned or sculpted character quality you need licensed GLB/glTF
humans and motion-captured clips. Options to evaluate (check each licence
before use):

- Commissioned scans or sculpts exported as GLB, rigged to the bone names in
  `src/render/HumanModel.js` (`BONES`) or retargeted to them.
- Commercially licensed realistic character packs that allow redistribution
  in a web game.
- Motion capture recorded by the project, or licensed basketball mocap libraries.

**Do not** use assets extracted from NBA 2K or other games, or Mixamo assets
in ways that break Adobe's terms. Real NBA player likenesses, names, logos and
uniforms need licences from the NBA, NBPA and teams.

Integration points:

- `buildHuman(def, uniform, opts)` returns `{ group, skeleton, bones, J, H }`.
  A GLB-based builder that returns the same shape, with bones named as in
  `BONES`, works with `PlayerView` (IK, look-at, clip mapping) without other
  changes.
- `AnimationLibrary` clips address bones by name (`upperArm_R.quaternion`, …).
  Licensed clips need retargeting to these names, or `PlayerView`'s clip table
  updated.

## Upgrade 0.2 asset changes

No external assets were added in this upgrade. All new content is original
code: neck re-proportioning and head/hair/beard level-of-detail
(`HumanModel.js`), a lighter Low-quality crowd (`Arena.js`), the practice shot
chart (DOM/SVG, `PracticePanel.js`), and procedural animation layers
(`PlayerView.js`).

**GLB pipeline (no models shipped).** `src/render/Retarget.js` loads a
glTF 2.0 / GLB character (+Y up, metres, with an armature), maps bone names
(Mixamo `mixamorig:*`, Unreal mannequin `*_l/_r`, Blender `*.L/*.R`, or this
rig's names), and retargets this game's animation onto it in world space, so
a T-pose rig follows our A-pose clips. Try it in `?view=model` → Import GLB.
It was verified by round-tripping the built-in character (Export GLB →
Import GLB: 23/23 bones mapped, pose follows). No third-party rig was tested
because none with a suitable licence was available in the sandbox; test any
licensed model you add, and keep its licence file next to it.
