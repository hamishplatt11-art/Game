// In-game HUD and overlays (DOM). Reads the simulation each frame and only
// touches the DOM when values change.
import * as THREE from 'three';
import { fmtClock, quarterLabel } from '../core/Game.js';
import { TAKEOVER_KINDS } from '../sim/Takeover.js';
import { BADGES, BADGE_TIERS } from '../sim/Attributes.js';
import { CAMERA_MODES, CAMERA_LABELS } from '../render/CameraSystem.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HUD {
  constructor(parent, game) {
    this.game = game;
    this.sim = game.sim;
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    this.cache = {};
    this.overlay = null;
    this.iconMode = false;
    const sim = this.sim;
    const [H, A] = sim.teams;
    const hc = H.raw.colors[H.uniform][1] === '#ffffff' ? H.raw.colors[H.uniform][0] : H.raw.colors.home[1];
    const ac = A.raw.colors.home[1];
    // Score bug (bottom centre, broadcast style).
    this.bug = el('div', 'scorebug', `
      <div class="sb-team" style="--tc:${ac}"><span class="sb-abbr">${esc(A.raw.abbr)}</span><span class="sb-to" data-k="toA"></span><span class="sb-score" data-k="sA">0</span></div>
      <div class="sb-team" style="--tc:${hc}"><span class="sb-abbr">${esc(H.raw.abbr)}</span><span class="sb-to" data-k="toH"></span><span class="sb-score" data-k="sH">0</span></div>
      <div class="sb-clock"><span data-k="q">Q1</span><span data-k="clock">5:00</span></div>
      <div class="sb-shot" data-k="shot">24</div>
      <div class="sb-fouls"><span data-k="fA"></span><span data-k="fH"></span></div>`);
    this.root.appendChild(this.bug);
    this.panel = el('div', 'player-panel');
    this.root.appendChild(this.panel);
    this.meter = el('div', 'shot-meter hidden', '<div class="sm-window"></div><div class="sm-fill"></div><div class="sm-tick"></div>');
    this.root.appendChild(this.meter);
    this.feedback = el('div', 'shot-feedback hidden');
    this.root.appendChild(this.feedback);
    this.banners = el('div', 'banners');
    this.root.appendChild(this.banners);
    this.tickerEl = el('div', 'ticker');
    this.root.appendChild(this.tickerEl);
    this.captions = el('div', 'captions');
    this.root.appendChild(this.captions);
    this.moveEl = el('div', 'move-label hidden');
    this.root.appendChild(this.moveEl);
    this.icons = [0, 1, 2, 3].map((i) => { const d = el('div', 'icon-badge hidden', String(i + 1)); this.root.appendChild(d); return d; });
    this.hints = el('div', 'hints');
    this.root.appendChild(this.hints);
    this.perfEl = el('div', 'perf hidden');
    this.root.appendChild(this.perfEl);
    this.replayBug = el('div', 'replay-bug hidden', '<span>REPLAY</span><em></em>');
    this.root.appendChild(this.replayBug);
    this.toastEl = el('div', 'toast hidden');
    this.root.appendChild(this.toastEl);
    this.lastFeedbackT = -9;
    this.v = new THREE.Vector3();
    this.updateHints();
  }

  dispose() { this.root.remove(); }

  set(key, val) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    const n = this.root.querySelector(`[data-k="${key}"]`);
    if (n) n.textContent = val;
  }

  blocking() { return !!(this.overlay && this.overlay.blocks); }
  modalOpen() { return !!this.overlay; }

  project(x, y, z) {
    const cam = this.game.renderer.camera;
    this.v.set(x, y, z).project(cam);
    const r = this.game.app.stage.getBoundingClientRect();
    return { x: (this.v.x * 0.5 + 0.5) * r.width, y: (-this.v.y * 0.5 + 0.5) * r.height, behind: this.v.z > 1 };
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const sim = this.sim;
    const m = sim.match;
    this.set('sH', String(m.score[0]));
    this.set('sA', String(m.score[1]));
    this.set('q', quarterLabel(m));
    this.set('clock', m.halfCourt ? `TO ${sim.settings.targetScore}` : m.practice ? '—' : fmtClock(m.clock));
    const showShot = m.phase === 'live' || m.phase === 'inbound';
    this.set('shot', showShot && !m.practice ? String(Math.ceil(Math.max(0, m.shotClock))) : '');
    this.bug.querySelector('.sb-shot').classList.toggle('low', m.shotClock <= 5 && showShot);
    this.set('toH', '•'.repeat(Math.max(0, sim.teams[0].timeouts)));
    this.set('toA', '•'.repeat(Math.max(0, sim.teams[1].timeouts)));
    const bonus = (t) => (sim.teams[t].fouls >= 5 ? 'BONUS' : `FOULS ${sim.teams[t].fouls}`);
    this.set('fH', m.halfCourt || m.practice ? '' : bonus(0));
    this.set('fA', m.halfCourt || m.practice ? '' : bonus(1));
    // Possession arrow.
    this.bug.dataset.poss = m.possTeam === 0 ? 'H' : m.possTeam === 1 ? 'A' : '';
    this.updatePanel();
    this.updateMeter();
    this.updateIcons();
    if (this.feedbackT > 0) {
      this.feedbackT -= dt;
      if (this.feedbackT <= 0) this.feedback.classList.add('hidden');
    }
    if (this.moveT > 0) {
      this.moveT -= dt;
      const u = sim.user.player;
      if (u) {
        const s = this.project(u.x, u.heightM + 0.6, u.z);
        this.moveEl.style.transform = `translate(${s.x - 60}px, ${s.y - 40}px)`;
      }
      if (this.moveT <= 0) this.moveEl.classList.add('hidden');
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.add('hidden'); }
    const P = this.game.perf;
    if (this.game.settings.perfOverlay) {
      this.perfEl.classList.remove('hidden');
      if (window.__perf) this.perfEl.textContent = `${P.fps.toFixed(0)} FPS · sim ${P.simMs.toFixed(2)}ms · render ${P.renderMs.toFixed(2)}ms · ${P.calls} calls · ${(P.tris / 1000).toFixed(0)}k tris${P.heap ? ` · ${P.heap}MB` : ''}`;
    } else this.perfEl.classList.add('hidden');
    if (m.phase === 'halftime' && !this.overlay) this.showHalftime();
  }

  updatePanel() {
    const u = this.sim.user.player;
    if (!u) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = '';
    const s = u.stats;
    const best = TAKEOVER_KINDS.reduce((a, k) => (u.takeover[k] > u.takeover[a] ? k : a), TAKEOVER_KINDS[0]);
    const tval = u.takeoverActive ? u.takeover[u.takeoverActive] : u.takeover[best];
    const tier = Math.floor(tval / (100 / 6));
    const key = `${u.id}|${s.pts}|${s.oreb + s.dreb}|${s.ast}|${Math.round(u.stamina * 50)}|${Math.round(tval)}|${u.takeoverActive}|${u.fouls}`;
    if (this.cache.panel === key) return;
    this.cache.panel = key;
    const pips = Array.from({ length: 6 }, (_, i) => `<i class="${i < tier ? 'on' : ''}"></i>`).join('');
    this.panel.innerHTML = `
      <div class="pp-num">${u.num}</div>
      <div class="pp-main">
        <div class="pp-name">${esc(u.name)} <span>${u.pos} · ${u.def.ovr} OVR</span></div>
        <div class="pp-stats">${s.pts} PTS · ${s.oreb + s.dreb} REB · ${s.ast} AST${u.fouls ? ` · ${u.fouls} PF` : ''}</div>
        <div class="pp-bar stamina"><b style="width:${Math.round(u.stamina * 100)}%"></b></div>
        <div class="pp-takeover ${u.takeoverActive ? 'active' : ''}"><span>${(u.takeoverActive || best).toUpperCase()}</span><div class="pips">${pips}</div></div>
      </div>`;
  }

  updateMeter() {
    const sim = this.sim;
    const u = sim.user.player;
    const a = u && u.action;
    const show = this.game.settings.shotMeter && a && a.data && a.data.user && (a.type === 'shot' || (a.type === 'dunk' && a.t < a.data.takeoffT + 0.05) || (a.type === 'layup' && a.data.meter && a.t < a.data.takeoffT + 0.2));
    if (!show) {
      if (!this.meterHoldT || this.meterHoldT <= 0) this.meter.classList.add('hidden');
      else this.meterHoldT -= 1 / 60;
      return;
    }
    this.meter.classList.remove('hidden');
    let fill, wLo, wHi;
    const d = a.data;
    if (a.type === 'shot') {
      const end = d.tIdeal + 0.3;
      fill = Math.min(1, (d.releaseT ?? a.t) / d.tIdeal);
      const w = d.window || 0.03;
      wLo = (d.tIdeal - w) / d.tIdeal; wHi = Math.min(1.08, (d.tIdeal + w) / d.tIdeal);
      if (d.released && d.grade) this.meter.dataset.grade = gradeClass(d.grade);
      else this.meter.dataset.grade = '';
      void end;
    } else if (a.type === 'dunk') {
      const span = d.takeoffT;
      fill = Math.min(1, (d.releaseUserT ?? a.t) / span);
      wLo = (d.meterCenter - d.meterWindow) / span; wHi = (d.meterCenter + d.meterWindow) / span;
      this.meter.dataset.grade = d.grade ? gradeClass(d.grade) : '';
    } else {
      const span = d.timingCenter + 0.15;
      fill = Math.min(1, (d.releaseUserT ?? a.t) / span);
      wLo = (d.timingCenter - d.timingWindow) / span; wHi = (d.timingCenter + d.timingWindow) / span;
      this.meter.dataset.grade = '';
    }
    const s = this.project(u.x + 0.6 * Math.cos(u.facing + Math.PI / 2), u.y + u.heightM * 0.75, u.z + 0.6 * Math.sin(u.facing + Math.PI / 2));
    this.meter.style.transform = `translate(${s.x + 24}px, ${s.y - 60}px)`;
    this.meter.querySelector('.sm-fill').style.height = `${Math.round(fill * 100)}%`;
    const win = this.meter.querySelector('.sm-window');
    win.style.bottom = `${Math.round(wLo * 100)}%`;
    win.style.height = `${Math.max(2, Math.round((wHi - wLo) * 100))}%`;
    this.meterHoldT = 0.8;
  }

  updateIcons() {
    const sim = this.sim;
    const u = sim.user.player;
    const show = this.iconMode && u && sim.ball.owner === u;
    const mates = u ? sim.teammates(u) : [];
    this.icons.forEach((d, i) => {
      const q = mates[i];
      if (!show || !q) { d.classList.add('hidden'); return; }
      const s = this.project(q.x, q.heightM + 0.45, q.z);
      d.classList.remove('hidden');
      d.style.transform = `translate(${s.x - 14}px, ${s.y - 14}px)`;
    });
  }

  setIconMode(v) { this.iconMode = v; }

  // -------------------------------------------------------------------------
  onShot(shot) {
    const fb = this.game.settings.shotFeedback;
    if (fb === 'off') return;
    const user = shot.user;
    if (!user && fb !== 'all') return;
    // Also store timing info for the meter colour.
    const u = shot.shooter;
    if (u.action && u.action.data) { u.action.data.grade = shot.grade; u.action.data.window = shot.window; }
    const g = shot.grade || '';
    const ms = shot.err !== undefined ? `${shot.err > 0 ? '+' : ''}${Math.round(shot.err * 1000)}ms` : '';
    const contest = shot.contest ? `${shot.contest.label}${shot.contest.dir ? ` (${shot.contest.dir})` : ''}` : '';
    const type = shot.kind === 'dunk' ? 'Dunk' : shot.kind === 'layup' ? `Layup · ${shot.type}` : shot.kind === 'ft' ? 'Free Throw' : `${shot.three ? '3PT' : '2PT'} · ${shot.type}`;
    this.feedback.innerHTML = `<b class="${gradeClass(g)}">${esc(g.toUpperCase())}</b><span>${esc(contest)}</span><span>${esc(type)}${ms ? ` · ${ms}` : ''}</span>${shot.prob !== undefined && fb === 'full' ? `<span>Make chance ${Math.round(shot.prob * 100)}%</span>` : ''}`;
    this.feedback.className = 'shot-feedback';
    this.feedback.dataset.contest = shot.contest ? shot.contest.label : '';
    const s = this.project(u.x, u.heightM + 0.9, u.z);
    this.feedback.style.transform = `translate(${s.x - 90}px, ${s.y - 90}px)`;
    this.feedbackT = 2.4;
  }

  onScore(e) {
    if (e.kind === 'ft') return;
    const name = e.scorer ? e.scorer.name : '';
    if (e.three) this.banner('THREE!', name + (e.assist ? ` · AST ${e.assist.last}` : ''), 'score');
    else if (e.kind === 'dunk') this.banner('SLAM!', name, 'score');
  }

  showContextLost() {
    if (this.ctxLostEl) return;
    this.ctxLostEl = el('div', 'ctx-lost');
    this.ctxLostEl.textContent = 'Graphics device reset — restoring… (the game is paused)';
    this.root.appendChild(this.ctxLostEl);
  }

  hideContextLost() {
    this.ctxLostEl?.remove();
    this.ctxLostEl = null;
  }

  banner(title, sub, kind = '') {
    const b = el('div', `banner ${kind}`, `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`);
    this.banners.appendChild(b);
    while (this.banners.children.length > 2) this.banners.firstChild.remove();
    setTimeout(() => b.classList.add('out'), 1900);
    setTimeout(() => b.remove(), 2400);
  }

  ticker(text) {
    const t = el('div', 'tick', esc(text));
    this.tickerEl.appendChild(t);
    while (this.tickerEl.children.length > 3) this.tickerEl.firstChild.remove();
    setTimeout(() => t.remove(), 4000);
  }

  caption(text) {
    const c = el('div', 'cap', esc(text));
    this.captions.appendChild(c);
    while (this.captions.children.length > 2) this.captions.firstChild.remove();
    setTimeout(() => c.remove(), 4500);
  }

  moveLabel(label, combo) {
    if (!this.game.settings.showHints) return;
    this.moveEl.textContent = combo > 0 ? `${label} ×${combo + 1}` : label;
    this.moveEl.classList.remove('hidden');
    this.moveT = 0.9;
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastT = 1.6;
  }

  updateHints() {
    if (!this.game.settings.showHints) { this.hints.style.display = 'none'; return; }
    const k = (a) => (this.game.input.bindings[a] || ['?'])[0].replace('Key', '').replace('Shift', 'Shift ').replace('Left', '').replace('Arrow', '↑↓←→'.includes(a) ? '' : '');
    this.hints.innerHTML = `
      <span><kbd>WASD</kbd> move</span><span><kbd>${k('sprint')}</kbd> sprint</span><span><kbd>${k('shoot')}</kbd> shoot</span>
      <span><kbd>${k('pass')}</kbd>/<kbd>${k('bounce')}</kbd>/<kbd>${k('lob')}</kbd> pass</span><span><kbd>Arrows</kbd> dribble moves</span>
      <span><kbd>${k('steal')}</kbd> steal</span><span><kbd>Space</kbd> block</span><span><kbd>${k('stance')}</kbd> D stance/post</span>
      <span><kbd>Tab</kbd> switch</span><span><kbd>Esc</kbd> pause</span>`;
  }

  showReplay(kind) {
    this.replayBug.classList.remove('hidden');
    this.replayBug.querySelector('em').textContent = kind;
  }
  hideReplay() { this.replayBug.classList.add('hidden'); }

  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------
  openOverlay(cls, html, blocks = true) {
    this.closeOverlay();
    const o = el('div', `overlay ${cls}`, html);
    this.root.appendChild(o);
    this.overlay = { el: o, blocks };
    return o;
  }

  closeOverlay() {
    if (this.overlay) this.overlay.el.remove();
    this.overlay = null;
  }

  showPregame(onStart) {
    const sim = this.sim;
    const [H, A] = sim.teams;
    const lineup = (t) => t.onCourt.map((p) => `<li><b>${p.num}</b><span>${esc(p.name)}</span><em>${p.pos} · ${fmtHeight(p.heightM)} · ${p.def.ovr}</em></li>`).join('');
    const o = this.openOverlay('pregame', `
      <div class="pg-card">
        <div class="pg-team" style="--tc:${A.raw.colors.home[1]}"><h2>${esc(A.raw.city)}</h2><h1>${esc(A.raw.name)}</h1><ul>${lineup(A)}</ul></div>
        <div class="pg-vs"><span>VS</span><small>${sim.diff.name} · ${sim.settings.quarterMin} MIN QUARTERS</small></div>
        <div class="pg-team" style="--tc:${H.raw.colors.home[1]}"><h2>${esc(H.raw.city)}</h2><h1>${esc(H.raw.name)}</h1><ul>${lineup(H)}</ul></div>
      </div>
      <div class="pg-cta">Press <kbd>Enter</kbd> / <kbd>A</kbd> to tip off</div>`, true);
    const go = () => { window.removeEventListener('keydown', key); onStart(); };
    const key = (e) => { if (e.code === 'Enter' || e.code === 'Space') go(); };
    window.addEventListener('keydown', key);
    o.addEventListener('click', go);
    this.pregamePoll = setInterval(() => {
      const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) : null;
      if (gp && gp.buttons[0] && gp.buttons[0].pressed) go();
    }, 100);
  }

  hidePregame() {
    clearInterval(this.pregamePoll);
    if (this.overlay && this.overlay.el.classList.contains('pregame')) this.closeOverlay();
  }

  showPause() {
    const sim = this.sim;
    const userTeam = sim.user.team;
    const canTO = userTeam !== null && sim.match.canCallTimeout(userTeam);
    const o = this.openOverlay('pause', `
      <div class="menu-panel">
        <h1>PAUSED</h1>
        <button data-a="resume" class="primary">Resume</button>
        <button data-a="box">Box Score</button>
        ${userTeam !== null && !sim.match.halfCourt && !sim.match.practice ? '<button data-a="subs">Substitutions</button>' : ''}
        ${userTeam !== null ? `<button data-a="timeout" ${canTO ? '' : 'disabled'}>Call Timeout (${sim.teams[userTeam].timeouts} left)</button>` : ''}
        <button data-a="camera">Camera: ${CAMERA_LABELS[this.game.camera.mode]}</button>
        <button data-a="meter">Shot Meter: ${this.game.settings.shotMeter ? 'On' : 'Off'}</button>
        <button data-a="controls">Controls</button>
        <button data-a="quit" class="danger">Quit to Main Menu</button>
      </div>`);
    o.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'resume') this.game.setPaused(false);
      if (a === 'box') this.showBoxScore(() => this.showPause());
      if (a === 'subs') this.showSubs(() => this.showPause());
      if (a === 'timeout') {
        this.closeOverlay();
        this.game.paused = false;
        sim.match.requestTimeout(userTeam);
        this.game.handleEvents(sim.drainEvents());
      }
      if (a === 'camera') { this.game.cycleCamera(); this.showPause(); }
      if (a === 'meter') { this.game.settings.shotMeter = !this.game.settings.shotMeter; this.game.app.settings.save(); this.showPause(); }
      if (a === 'controls') this.showControls(() => this.showPause());
      if (a === 'quit') this.game.app.quitToMenu();
    });
  }

  hidePause() {
    if (this.overlay && (this.overlay.el.classList.contains('pause') || this.overlay.el.classList.contains('box') || this.overlay.el.classList.contains('subs') || this.overlay.el.classList.contains('controls'))) this.closeOverlay();
  }

  showControls(back) {
    const rows = Object.entries(this.game.input.bindings).map(([a, keys]) => `<tr><td>${esc(a)}</td><td>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</td></tr>`).join('');
    const o = this.openOverlay('controls', `<div class="menu-panel wide"><h1>CONTROLS</h1><p class="muted">Remap keys from the main menu → Settings → Controls. Gamepad follows the classic 2K layout (X shoot, A pass, B bounce, Y lob, RT sprint, RS dribble moves / Pro Stick).</p><table class="kv">${rows}</table><button data-a="back" class="primary">Back</button></div>`);
    o.addEventListener('click', (e) => { if (e.target.dataset.a === 'back') back(); });
  }

  boxScoreHTML() {
    const sim = this.sim;
    const m = sim.match;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    const table = (t) => {
      const tot = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 };
      const rows = t.roster.map((p) => {
        const s = p.stats;
        for (const k of ['pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'ast', 'stl', 'blk', 'tov', 'pf']) tot[k] += s[k];
        tot.reb += s.oreb + s.dreb;
        return `<tr class="${p.onCourt ? 'on' : ''}"><td>${p.num}</td><td class="nm">${esc(p.name)}${p.starter ? '' : ''}</td><td>${p.pos}</td><td>${Math.floor(s.min / 60)}</td><td><b>${s.pts}</b></td><td>${s.fgm}-${s.fga}</td><td>${s.tpm}-${s.tpa}</td><td>${s.ftm}-${s.fta}</td><td>${s.oreb + s.dreb}</td><td>${s.ast}</td><td>${s.stl}</td><td>${s.blk}</td><td>${s.tov}</td><td>${s.pf}</td><td>${s.pm > 0 ? '+' : ''}${s.pm}</td></tr>`;
      }).join('');
      const ts = m.teamStats[t.idx];
      return `<div class="box-team"><h3 style="--tc:${t.raw.colors.home[1]}">${esc(t.raw.city)} ${esc(t.raw.name)} <b>${m.score[t.idx]}</b></h3>
        <table class="box"><thead><tr><th>#</th><th class="nm">Player</th><th>Pos</th><th>MIN</th><th>PTS</th><th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>+/-</th></tr></thead>
        <tbody>${rows}<tr class="tot"><td></td><td class="nm">TOTALS</td><td></td><td></td><td><b>${tot.pts}</b></td><td>${tot.fgm}-${tot.fga}</td><td>${tot.tpm}-${tot.tpa}</td><td>${tot.ftm}-${tot.fta}</td><td>${tot.reb}</td><td>${tot.ast}</td><td>${tot.stl}</td><td>${tot.blk}</td><td>${tot.tov}</td><td>${tot.pf}</td><td></td></tr></tbody></table>
        <div class="team-stats"><span>FG ${pct(tot.fgm, tot.fga)}</span><span>3PT ${pct(tot.tpm, tot.tpa)}</span><span>FT ${pct(tot.ftm, tot.fta)}</span><span>Paint ${ts.paint}</span><span>Fast break ${ts.fastBreak}</span><span>2nd chance ${ts.secondChance}</span><span>Bench ${ts.bench}</span><span>Turnovers ${ts.turnovers}</span><span>Biggest lead ${ts.biggestLead}</span></div></div>`;
    };
    const qs = (i) => m.periodScores[i].map((s) => `<td>${s}</td>`).join('');
    const qh = m.periodScores[0].map((_, i) => `<th>${i < 4 ? `Q${i + 1}` : 'OT'}</th>`).join('');
    const line = m.halfCourt || m.practice ? '' : `<table class="linescore"><tr><th></th>${qh}<th>T</th></tr><tr><td>${esc(sim.teams[1].raw.abbr)}</td>${qs(1)}<td><b>${m.score[1]}</b></td></tr><tr><td>${esc(sim.teams[0].raw.abbr)}</td>${qs(0)}<td><b>${m.score[0]}</b></td></tr></table>`;
    return `${line}${table(sim.teams[1])}${table(sim.teams[0])}`;
  }

  showBoxScore(back) {
    const o = this.openOverlay('box', `<div class="menu-panel wide"><h1>BOX SCORE</h1>${this.boxScoreHTML()}<button data-a="back" class="primary">Back</button></div>`);
    o.addEventListener('click', (e) => { if (e.target.dataset.a === 'back') back(); });
  }

  showSubs(back) {
    const sim = this.sim;
    const t = sim.teams[sim.user.team];
    let sel = null;
    const render = () => {
      const pending = sim.match.subQueue[t.idx].map((q) => `${q.inP.last} for ${q.outP.last}`).join(', ');
      const row = (p, on) => `<button class="sub-row ${sel === p ? 'sel' : ''} ${p.fouls >= 6 ? 'out' : ''}" data-id="${p.id}" ${p.fouls >= 6 ? 'disabled' : ''}>
        <b>${p.num}</b><span>${esc(p.name)}</span><em>${p.pos} · ${p.def.ovr}</em><i class="st"><u style="width:${Math.round(p.stamina * 100)}%"></u></i><small>${p.stats.pts} PTS · ${p.fouls} PF</small></button>`;
      o.querySelector('.subs-body').innerHTML = `<div><h3>On Court</h3>${t.onCourt.map((p) => row(p, true)).join('')}</div><div><h3>Bench</h3>${t.roster.filter((p) => !p.onCourt).map((p) => row(p, false)).join('')}</div>`;
      o.querySelector('.pending').textContent = pending ? `Pending (next dead ball): ${pending}` : 'Select a player on court, then a bench player.';
    };
    const o = this.openOverlay('subs', `<div class="menu-panel wide"><h1>SUBSTITUTIONS</h1><div class="subs-body"></div><p class="pending muted"></p><button data-a="back" class="primary">Done</button></div>`);
    o.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.a === 'back') { back(); return; }
      const p = t.roster.find((q) => q.id === b.dataset.id);
      if (!p) return;
      if (p.onCourt) sel = p;
      else if (sel) { sim.match.requestSub(t.idx, sel, p); sel = null; }
      render();
    });
    render();
  }

  onTimeout(team) {
    const sim = this.sim;
    const userTeam = sim.user.team;
    if (team !== userTeam) {
      this.banner('TIMEOUT', `${sim.teams[team].raw.city} ${sim.teams[team].raw.name}`, 'ref');
      return;
    }
    const o = this.openOverlay('timeout', `<div class="menu-panel"><h1>TIMEOUT</h1><p class="muted">${sim.teams[team].timeouts} timeouts remaining</p>
      <button data-a="subs">Substitutions</button><button data-a="box">Box Score</button><button data-a="resume" class="primary">Resume Play</button></div>`);
    o.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'resume') { this.closeOverlay(); sim.match.resumeFromTimeout(); }
      if (a === 'subs') this.showSubs(() => this.onTimeout(team));
      if (a === 'box') this.showBoxScore(() => this.onTimeout(team));
    });
  }

  onPeriodEnd(q) {
    if (q === 2) return; // halftime overlay handles it
    this.banner(`END OF ${q <= 4 ? `Q${q}` : 'OT'}`, `${this.sim.match.score[1]} - ${this.sim.match.score[0]}`, 'ref');
  }

  showHalftime() {
    const o = this.openOverlay('halftime', `<div class="menu-panel wide"><h1>HALFTIME</h1>${this.boxScoreHTML()}<button data-a="go" class="primary">Start Second Half</button></div>`);
    o.addEventListener('click', (e) => {
      if (e.target.dataset.a === 'go') { this.closeOverlay(); this.sim.match.startNextPeriod(); }
    });
  }

  onFinal(e) {
    const sim = this.sim;
    const w = sim.teams[e.winner];
    setTimeout(() => {
      const o = this.openOverlay('final', `<div class="menu-panel wide"><h1>FINAL</h1><h2 class="final-score">${esc(sim.teams[1].raw.abbr)} ${e.score[1]} — ${e.score[0]} ${esc(sim.teams[0].raw.abbr)}</h2><p class="muted">${esc(w.raw.city)} ${esc(w.raw.name)} win${sim.match.quarter > 4 ? ' in overtime' : ''}.</p>${this.boxScoreHTML()}
        <div class="row"><button data-a="menu" class="primary">Main Menu</button><button data-a="again">Rematch</button></div></div>`);
      o.addEventListener('click', (ev) => {
        const a = ev.target.dataset.a;
        if (a === 'menu') this.game.app.quitToMenu();
        if (a === 'again') this.game.app.restart();
      });
    }, 2200);
  }
}

function gradeClass(g) {
  if (!g) return '';
  if (g === 'Excellent') return 'green';
  if (g.startsWith('Slightly')) return 'yellow';
  return 'red';
}

export function fmtHeight(m) {
  const inches = Math.round(m / 0.0254);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

export { BADGES, BADGE_TIERS, CAMERA_MODES };
