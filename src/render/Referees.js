// Three on-court officials (lead, trail, slot) who follow the play. They are
// presentation only: every call is made by the rules engine from simulated
// events, not by these figures.
import { Player } from '../sim/Player.js';
import { buildPlayerDef } from '../sim/Attributes.js';
import { PlayerView } from './PlayerView.js';
import { HALF_L, HALF_W, hoopSign } from '../sim/constants.js';

const REFS = [
  { first: 'Lead', last: 'Official', num: 14, pos: 'SF', h: 188, w: 88, ws: 190, arch: 'twoWay', ovr: 60, skin: 1, hair: 'short', beard: 'none' },
  { first: 'Trail', last: 'Official', num: 33, pos: 'SF', h: 183, w: 86, ws: 185, arch: 'twoWay', ovr: 60, skin: 4, hair: 'buzz', beard: 'short' },
  { first: 'Slot', last: 'Official', num: 52, pos: 'SF', h: 191, w: 95, ws: 193, arch: 'twoWay', ovr: 60, skin: 2, hair: 'buzz', beard: 'none' },
];

export class Referees {
  constructor(scene, quality) {
    this.refs = REFS.map((raw, i) => {
      const def = buildPlayerDef(raw, 'REF');
      const p = new Player(def, -1, false);
      p.onCourt = true;
      p.setPos(i === 0 ? 4 : i === 1 ? -4 : 0, i === 2 ? -HALF_W - 0.6 : HALF_W + 0.6, 0);
      const view = new PlayerView(p, { colors: ['#9ea3ab', '#16171b', '#16171b'], official: true }, { quality });
      scene.add(view.root);
      return { p, view };
    });
  }

  update(sim, dt, ballPos) {
    const m = sim.match;
    const poss = m.possTeam ?? 0;
    const s = m.practice ? 1 : hoopSign(m.attackHoop(poss));
    const bx = ballPos.x;
    // Lead on the baseline ahead of the play, trail behind the ball on the near
    // sideline, slot on the far sideline level with the ball.
    const targets = [
      { x: s * (HALF_L + 0.7), z: ballPos.z > 0 ? -2.5 : 2.5 },
      { x: bx - s * 3.5, z: HALF_W + 0.7 },
      { x: bx + s * 1.0, z: -HALF_W - 0.7 },
    ];
    this.refs.forEach(({ p, view }, i) => {
      const t = targets[i];
      t.x = Math.max(-HALF_L - 1, Math.min(HALF_L + 1, t.x));
      const dx = t.x - p.x, dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      const vmax = d > 6 ? 6.5 : d > 2 ? 4 : 2;
      const k = Math.min(1, d / 1.5);
      p.intent.mx = d > 0.3 ? (dx / d) * k : 0;
      p.intent.mz = d > 0.3 ? (dz / d) * k : 0;
      p.intent.sprint = vmax > 5;
      p.intent.faceX = ballPos.x; p.intent.faceZ = ballPos.z;
      p.updateMovement(dt, false, false);
      view.update(sim, 1, dt, ballPos);
    });
  }
}
