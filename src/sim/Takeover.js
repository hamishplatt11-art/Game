// Takeover: five disciplines whose meters rise and fall with in-game
// performance (six tiers each). A full meter activates that discipline's
// boost for a stretch of game time; its effects are read by the gameplay
// systems through Player.takeoverOn(kind).
export const TAKEOVER_KINDS = ['shooting', 'finishing', 'playmaking', 'defense', 'rebounding'];
export const TAKEOVER_TIERS = 6;
const ACTIVE_SECONDS = 40;

export class Takeover {
  constructor(sim) {
    this.sim = sim;
  }

  add(p, kind, amt) {
    if (!p || !p.takeover) return;
    if (p.takeoverActive) return;
    p.takeover[kind] = Math.max(0, Math.min(100, p.takeover[kind] + amt));
    if (p.takeover[kind] >= 100) {
      p.takeoverActive = kind;
      p.takeoverT = ACTIVE_SECONDS;
      this.sim.emit('takeover', { player: p, kind });
    }
  }

  tier(p, kind) {
    return Math.min(TAKEOVER_TIERS, Math.floor(p.takeover[kind] / (100 / TAKEOVER_TIERS)));
  }

  onShot(p, shot) {
    if (shot.kind === 'jumper') this.add(p, 'shooting', shot.grade === 'Excellent' ? 5 : shot.grade && shot.grade.startsWith('Very') ? -8 : -2);
    else if (shot.kind === 'layup' || shot.kind === 'dunk') this.add(p, 'finishing', 1);
  }

  update(dt) {
    for (const team of this.sim.teams) {
      for (const p of team.onCourt) {
        if (p.takeoverActive) {
          p.takeoverT -= dt;
          p.takeover[p.takeoverActive] = Math.max(0, (p.takeoverT / ACTIVE_SECONDS) * 100);
          if (p.takeoverT <= 0) {
            p.takeover[p.takeoverActive] = 25;
            p.takeoverActive = null;
          }
        } else {
          for (const k in p.takeover) p.takeover[k] = Math.max(0, p.takeover[k] - dt * 0.12);
        }
      }
    }
  }
}
