// Developer debug HUD (F3 or Settings): GPU / WebGL info, frame timing
// (median and 95th percentile), draw calls, triangles, memory, camera, sim
// phase, controlled player, ball and current input state.
export class DebugHud {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'debug-hud';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        app.settings.data.debugHud = !app.settings.data.debugHud;
        app.settings.save();
      }
    });
    const tick = () => { requestAnimationFrame(tick); this.update(); };
    this.frame = 0;
    requestAnimationFrame(tick);
  }

  update() {
    const on = this.app.settings.data.debugHud;
    this.el.style.display = on ? '' : 'none';
    if (!on || (this.frame++ % 15)) return;
    const g = this.app.gfx;
    const game = this.app.game;
    const lines = [
      `GPU      ${g.renderer}`,
      `Vendor   ${g.vendor}  WebGL2 ${g.webgl2 ? 'yes' : 'NO'}  hw-accel ${g.software ? 'NO (software)' : 'yes'}  DPR ${window.devicePixelRatio}`,
      `Quality  ${this.app.settings.data.quality} -> ${this.app.resolveQuality()}`,
    ];
    if (game && game.renderer) {
      const P = game.perf;
      const s = [...P.samples].sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)] || 0, p95 = s[Math.floor(s.length * 0.95)] || 0;
      const r = game.renderer;
      lines.push(`FPS      ${P.fps.toFixed(1)}  frame med ${med.toFixed(1)}ms p95 ${p95.toFixed(1)}ms  sim ${P.simMs.toFixed(2)}ms render ${P.renderMs.toFixed(2)}ms`);
      lines.push(`GPU work ${P.calls} draw calls  ${(P.tris / 1000).toFixed(0)}k tris  ${P.geos} geos  ${P.texs} textures  shader errors ${r.shaderErrors || 0}${P.heap ? `  heap ${P.heap}MB` : ''}`);
      const c = r.camera.position;
      lines.push(`Camera   ${game.camera.mode} (${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}) fov ${r.camera.fov.toFixed(0)}`);
      const sim = game.sim, m = sim.match, b = sim.ball, u = sim.user.player;
      lines.push(`Sim      t=${sim.t.toFixed(1)} phase=${m.phase} Q${m.quarter} clock=${m.clock.toFixed(1)} shot=${m.shotClock.toFixed(1)} poss=${m.possTeam}`);
      lines.push(`Ball     ${b.state}${b.air ? `/${b.air.kind}` : ''} (${b.p.x.toFixed(2)}, ${b.p.y.toFixed(2)}, ${b.p.z.toFixed(2)}) owner=${b.owner ? b.owner.last : '-'}`);
      if (u) lines.push(`User     ${u.name} (${u.x.toFixed(1)}, ${u.z.toFixed(1)}) v=${u.speed.toFixed(1)} stamina=${u.stamina.toFixed(2)} action=${u.action ? u.action.type : '-'}`);
      const inp = this.app.input;
      lines.push(`Input    keys[${[...inp.keys].join(' ')}] pad=${inp.pad.connected ? inp.pad.id.slice(0, 30) : 'none'}`);
    }
    this.el.textContent = lines.join('\n');
  }
}
