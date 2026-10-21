// Game session: owns the simulation, renderer, views, input, audio and HUD
// for one match/practice/blacktop session. Fixed 60 Hz simulation stepping
// with interpolated rendering; replay recording; presentation flow.
import * as THREE from 'three';
import { Simulation } from '../sim/Simulation.js';
import { SIM_DT, hoopSign, HALF_L } from '../sim/constants.js';
import { Player } from '../sim/Player.js';
import { Renderer } from '../render/Renderer.js';
import { Arena } from '../render/Arena.js';
import { PlayerView } from '../render/PlayerView.js';
import { BallView } from '../render/BallView.js';
import { Referees } from '../render/Referees.js';
import { CameraSystem, CAMERA_MODES, CAMERA_LABELS } from '../render/CameraSystem.js';
import { HUD } from '../ui/HUD.js';
import { commentaryFor } from '../ui/Commentary.js';

const REPLAY_SECONDS = 9;

export class Game {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.settings = app.settings.data;
    this.input = app.input;
    this.audio = app.audio;
    this.views = new Map();
    this.running = false;
    this.acc = 0;
    this.time = 0;
    this.excite = 0.15;
    this.replayBuf = [];
    this.replay = null;
    this.pendingReplay = null;
    this.lastSqueak = 0;
    this.lastSwish = 0;
    this.paused = false;
    this.perf = { frames: 0, ms: 0, simMs: 0, renderMs: 0, fps: 0, lastT: performance.now(), samples: [] };
  }

  async load(onProgress) {
    const cfg = this.cfg;
    const steps = [];
    const container = this.app.stage;
    const quality = this.settings.quality;
    const total = 4 + cfg.teams[0].players.length + cfg.teams[1].players.length;
    let done = 0;
    const tick = async (label) => {
      done++;
      onProgress(done / total, label);
      await new Promise((r) => requestAnimationFrame(() => r()));
    };
    this.sim = new Simulation({
      teams: cfg.teams,
      seed: cfg.seed ?? (Date.now() & 0xffffff),
      settings: {
        quarterMin: cfg.quarterMin, difficulty: cfg.difficulty, userTeam: cfg.userTeam, autoSwitch: this.settings.autoSwitch,
        layupTiming: this.settings.layupTiming, mode: cfg.mode, playersPerSide: cfg.playersPerSide || 5, targetScore: cfg.targetScore || 21,
        ones: cfg.ones, makeItTakeIt: cfg.makeItTakeIt, winBy2: cfg.winBy2, uniforms: cfg.uniforms, userFreeThrows: true,
      },
    });
    if (cfg.mode === 'practice') {
      // Practice: one player plus an optional defender.
      for (const t of this.sim.teams) { t.onCourt = t.onCourt.slice(0, 1); t.roster.forEach((p) => { p.onCourt = t.onCourt.includes(p); }); }
      if (!cfg.defender) { this.sim.teams[1].onCourt = []; this.sim.teams[1].roster.forEach((p) => { p.onCourt = false; }); }
    }
    await tick('Simulation');
    this.renderer = new Renderer(container, quality);
    this.scene = this.renderer.scene;
    await tick('Renderer');
    this.arena = new Arena(this.scene, {
      outdoor: cfg.mode === 'blacktop', quality: this.renderer.q.mesh, shadows: this.renderer.q.shadows, shadowSize: this.renderer.q.shadowSize,
      reflect: this.renderer.q.reflect && cfg.mode !== 'blacktop', renderer: this.renderer.renderer,
      home: cfg.teams[0], away: cfg.teams[1],
    });
    this.renderer.addFloorReflection();
    if (cfg.mode === 'blacktop') this.scene.background = new THREE.Color('#0b1830');
    await tick('Arena');
    for (const team of this.sim.teams) {
      const raw = team.raw;
      const uni = raw.colors[team.uniform] || raw.colors.home;
      for (const p of team.roster) {
        const view = new PlayerView(p, { colors: uni, socks: uni[0] === '#f4f4f4' || uni[0].startsWith('#f') ? '#f2f2f2' : uni[0], shoe: uni[1], shoeAccent: uni[2] }, { quality: this.renderer.q.mesh, teamName: raw.name });
        this.scene.add(view.root);
        view.root.visible = p.onCourt;
        this.views.set(p, view);
        await tick(`Player: ${p.name}`);
      }
    }
    this.ball = new BallView(this.scene, this.renderer.q.mesh);
    if (cfg.mode === 'playnow') this.refs = new Referees(this.scene, this.renderer.q.mesh);
    this.camera = new CameraSystem(this.renderer.camera);
    this.camera.mode = this.settings.cameraMode;
    this.camera.settings = { height: this.settings.camHeight, zoom: this.settings.camZoom, tracking: this.settings.camTracking };
    // Selection ring under the controlled player.
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#29e0ff', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.ring.position.y = 0.01;
    this.scene.add(this.ring);
    this.hud = new HUD(this.app.ui, this);
    // Warm up shader programs so the first frames don't hitch.
    this.renderer.renderer.compile(this.scene, this.renderer.camera);
    await tick('Shaders');
  }

  start() {
    this.running = true;
    this.audio.stopMusic();
    if (this.cfg.mode !== 'blacktop') this.audio.startCrowd();
    const m = this.sim.match;
    if (this.cfg.mode === 'playnow') {
      this.camera.startCinematic('establish');
      this.hud.showPregame(() => this.beginPlay());
    } else this.beginPlay();
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  beginPlay() {
    this.camera.stopCinematic();
    this.sim.match.beginGame();
    if (this.sim.user.team !== null && !this.sim.user.player) {
      const team = this.sim.teams[this.sim.user.team];
      this.sim.setUserPlayer(team.onCourt[0]);
    }
    this.hud.hidePregame();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.audio.stopCrowd();
    if (this.hud) this.hud.dispose();
    if (this.renderer) this.renderer.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
  }

  /** Debug/testing: advance the simulation without rendering (used by automated browser tests). */
  fastForward(seconds, until = null, inputFn = null) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      this.sim.step(inputFn ? inputFn(this.sim, i) : null);
      this.recordReplay();
      this.handleEvents(this.sim.drainEvents());
      if (until && until(this.sim)) break;
    }
    this.acc = 0;
  }

  setPaused(p) {
    this.paused = p;
    if (p) this.hud.showPause(); else this.hud.hidePause();
    this.audio.ensure();
  }

  cycleCamera() {
    const i = CAMERA_MODES.indexOf(this.camera.mode);
    this.camera.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.settings.cameraMode = this.camera.mode;
    this.app.settings.save();
    this.hud.toast(`Camera: ${CAMERA_LABELS[this.camera.mode]}`);
  }

  // -------------------------------------------------------------------------
  frame(now) {
    const t0 = performance.now();
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.input.pollPad(now);
    const ui = this.input.ui();
    if (ui.pause && this.sim.match.phase !== 'pregame' && !this.replay) {
      const ov = this.hud.overlay;
      if (!ov) this.setPaused(true);
      else if (this.paused) { this.hud.closeOverlay(); this.setPaused(false); }
    }
    if (ui.camera) this.cycleCamera();
    const sim = this.sim;
    let simMs = 0;
    if (this.replay) {
      this.updateReplay(dt, ui);
      this.input.endStep();
    } else if (!this.paused && !this.hud.blocking()) {
      this.acc += dt;
      let steps = 0;
      const ts = performance.now();
      while (this.acc >= SIM_DT && steps < 5) {
        const u = sim.user.player;
        const hasBall = u && sim.ball.owner === u;
        const offense = u && sim.match.possTeam === u.team;
        const loose = sim.ball.state === 'air' && sim.ball.air && sim.ball.air.kind !== 'pass';
        const basis = this.camera.groundBasis();
        const inp = this.input.sample(basis, { hasBall, offense, loose, freeThrow: sim.match.phase === 'freethrow' });
        if (this.hud.iconMode !== inp.iconHeld) this.hud.setIconMode(inp.iconHeld);
        sim.step(u ? inp : null);
        this.input.endStep();
        this.recordReplay();
        this.handleEvents(sim.drainEvents());
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      simMs = performance.now() - ts;
      this.checkPendingReplay();
    } else {
      this.input.endStep();
    }
    const alpha = this.replay ? this.replay.alpha : this.acc / SIM_DT;
    const tr = performance.now();
    this.renderFrame(dt, alpha);
    const renderMs = performance.now() - tr;
    this.hud.update(dt);
    this.updatePerf(now, performance.now() - t0, simMs, renderMs);
  }

  renderFrame(dt, alpha) {
    const sim = this.replay ? this.replay.frameSim : this.sim;
    this.time += dt;
    const ballPos = this.ball.update(sim.ball, alpha, this.replay ? dt * this.replay.speed : dt);
    for (const [p, view] of this.views) {
      if (!p.onCourt && !this.replay) { view.root.visible = false; continue; }
      view.update(sim, alpha, this.replay ? dt * this.replay.speed : dt, ballPos);
    }
    if (this.refs && !this.replay) this.refs.update(this.sim, dt, ballPos);
    // Selection indicator.
    const u = this.sim.user.player;
    if (u && !this.replay && u.onCourt) {
      const pp = u.lerpPos(alpha);
      this.ring.visible = true;
      this.ring.position.set(pp.x, 0.012, pp.z);
      const pulse = 1 + Math.sin(this.time * 6) * 0.04;
      this.ring.scale.set(pulse, 1, pulse);
      this.ring.material.color.set(sim.ball.owner === u ? '#2df5a0' : '#29e0ff');
    } else this.ring.visible = false;
    // Camera.
    const m = this.sim.match;
    const poss = m.possTeam;
    const attackDir = poss !== null && poss !== undefined ? hoopSign(m.attackHoop(poss)) : 0;
    if (!this.camera.cinematic && m.phase === 'freethrow' && m.ft && this.settings.ftCamera) {
      this.camera.startCinematic('freethrow', { hoop: m.ft.hoop });
    }
    if (this.camera.cinematic && this.camera.cinematic.kind === 'freethrow' && m.phase !== 'freethrow') this.camera.stopCinematic();
    this.camera.update(dt, { ball: ballPos, attackDir, user: u ? u.lerpPos(alpha) : null });
    // Arena state (clocks, crowd).
    this.excite = Math.max(0.12, this.excite - dt * 0.18);
    const close = m.quarter >= 4 && m.clock < 120 && Math.abs(m.score[0] - m.score[1]) <= 5 ? 0.35 : 0;
    const state = {
      excite: Math.min(1, this.excite + close),
      shotClockText: m.shotClockOn || m.phase === 'live' ? String(Math.ceil(Math.max(0, m.shotClock))) : '',
      shotClockLow: m.shotClock <= 5,
      gameClockText: fmtClock(m.clock),
      score: `${m.score[0]}-${m.score[1]}`, scoreHome: m.score[0], scoreAway: m.score[1], clockText: fmtClock(m.clock), quarterText: quarterLabel(m),
    };
    this.arena.update(dt, this.time, state, ballPos);
    this.audio.setCrowdLevel(state.excite);
    this.renderer.render();
  }

  updatePerf(now, frameMs, simMs, renderMs) {
    const P = this.perf;
    P.frames++;
    P.samples.push(frameMs);
    if (P.samples.length > 240) P.samples.shift();
    P.simMs = P.simMs * 0.95 + simMs * 0.05;
    P.renderMs = P.renderMs * 0.95 + renderMs * 0.05;
    if (now - P.lastT > 500) {
      P.fps = (P.frames * 1000) / (now - P.lastT);
      P.frames = 0;
      P.lastT = now;
      const info = this.renderer.renderer.info;
      P.calls = info.render.calls;
      P.tris = info.render.triangles;
      P.geos = info.memory.geometries;
      P.texs = info.memory.textures;
      P.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      window.__perf = { ...P, samples: undefined };
    }
  }

  // -------------------------------------------------------------------------
  // Events -> audio / HUD / crowd
  // -------------------------------------------------------------------------
  handleEvents(events) {
    const sim = this.sim;
    const camPos = this.renderer.camera.position;
    const distVol = (x, z) => Math.max(0.2, 1 - Math.hypot(x - camPos.x, z - camPos.z) / 40);
    for (const e of events) {
      switch (e.type) {
        case 'dribbleBounce': this.audio.play('bounce', { vol: 0.8 * distVol(e.x, e.z) }); break;
        case 'ballBounce': this.audio.play('bounce', { vol: Math.min(1, e.strength / 4) * distVol(e.x, e.z) }); break;
        case 'plant':
          if (this.time - this.lastSqueak > 0.18 && e.speed > 3.5) { this.lastSqueak = this.time; this.audio.play('squeak', { vol: 0.8 }); }
          break;
        case 'rim': this.audio.play('rim', { vol: Math.min(1, 0.3 + e.strength / 5) }); break;
        case 'backboard': this.audio.play('board', { vol: Math.min(1, 0.3 + e.strength / 5) }); break;
        case 'net':
          if (this.time - this.lastSwish > 0.8) { this.lastSwish = this.time; this.audio.play('swish'); }
          break;
        case 'catch': this.audio.play('catch', { vol: 0.6 }); break;
        case 'whistle': this.audio.play('whistle', { long: e.kind === 'foul' }); break;
        case 'buzzer': this.audio.play('buzzer'); break;
        case 'score': {
          const home = e.team === 0;
          const big = e.three || e.kind === 'dunk';
          this.excite = Math.min(1, this.excite + (big ? 0.7 : 0.4) * (home ? 1 : 0.45));
          this.audio.play(home ? 'cheer' : 'groan', { vol: big ? 1 : 0.6, dur: big ? 3 : 2 });
          this.hud.onScore(e);
          break;
        }
        case 'shotRelease': this.hud.onShot(e.shot); break;
        case 'block':
          this.excite = Math.min(1, this.excite + 0.6);
          this.audio.play('ooh', { vol: 1 });
          this.hud.banner('BLOCKED', `${e.player.name}`, 'accent');
          break;
        case 'steal': this.hud.banner('STEAL', e.player.name, 'accent'); break;
        case 'ankleBreaker':
          this.excite = 1;
          this.audio.play('ooh', { vol: 1, dur: 2.5 });
          this.hud.banner('ANKLE BREAKER', `${e.player.name} · ${e.move}`, 'gold');
          break;
        case 'poster': this.excite = 1; this.hud.banner('POSTERIZED', `${e.player.name} over ${e.defender.last}`, 'gold'); break;
        case 'takeover': this.hud.banner('TAKEOVER', `${e.player.name} · ${e.kind.toUpperCase()}`, 'gold'); break;
        case 'foulCalled': this.hud.banner(e.label.toUpperCase(), `${e.player.name}${e.player.fouls ? ` · ${e.player.fouls} PF` : ''}`, 'ref'); break;
        case 'violationCalled': this.hud.banner(e.label.toUpperCase(), e.player ? e.player.name : '', 'ref'); break;
        case 'andOne': this.hud.banner('AND ONE!', e.player.name, 'gold'); this.excite = 1; break;
        case 'timeout': this.hud.onTimeout(e.team); break;
        case 'substitution': this.hud.ticker(`SUB ${sim.teams[e.team].raw.abbr}: ${e.in.name} for ${e.out.name}`); break;
        case 'foulOut': this.hud.ticker(`${e.player.name} has fouled out`); break;
        case 'periodEnd': this.hud.onPeriodEnd(e.quarter); break;
        case 'final': this.hud.onFinal(e); this.saveResult(e); break;
        case 'freeThrows': this.hud.ticker(`${e.shooter.name}: ${e.total} free throw${e.total > 1 ? 's' : ''}`); break;
        case 'controlSwitch': break;
        case 'pumpFake': break;
        case 'dribbleMove': if (sim.isUser(e.player)) this.hud.moveLabel(e.label, e.combo); break;
        default: break;
      }
      const line = commentaryFor(e, sim);
      if (line) { this.hud.caption(line); this.audio.say(line); }
    }
  }

  saveResult(e) {
    try {
      const key = 'hw27.results';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      const m = this.sim.match;
      list.unshift({ date: new Date().toISOString(), mode: this.cfg.mode, home: this.cfg.teams[0].abbr, away: this.cfg.teams[1].abbr, score: [...m.score], quarters: m.quarter });
      localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
    } catch { /* storage unavailable */ }
  }

  // -------------------------------------------------------------------------
  // Replays: record a compact snapshot of every sim step; play highlights back
  // with a cinematic camera at the next dead ball.
  // -------------------------------------------------------------------------
  recordReplay() {
    const sim = this.sim;
    const players = sim.players.map((p) => ({
      ref: p, x: p.x, z: p.z, prevX: p.prevX, prevZ: p.prevZ, y: p.y, facing: p.facing, vx: p.vx, vz: p.vz, speed: p.speed,
      airborne: p.airborne, posting: p.posting, stance: p.intent.stance, handsUp: p.intent.handsUp,
      action: p.action ? { type: p.action.type, t: p.action.t, dur: p.action.dur, data: { ...p.action.data } } : null,
    }));
    const b = sim.ball;
    this.replayBuf.push({
      t: sim.t, players,
      ball: { p: { ...b.p }, prevP: { ...b.prevP }, w: { ...b.w }, state: b.state, owner: b.owner, dribble: { side: b.dribble.side }, air: b.air ? { kind: b.air.kind, target: b.air.target } : null },
    });
    while (this.replayBuf.length > REPLAY_SECONDS * 60) this.replayBuf.shift();
    if (sim.replayHighlight && this.settings.replays) {
      this.pendingReplay = sim.replayHighlight;
      sim.replayHighlight = null;
    }
  }

  checkPendingReplay() {
    const sim = this.sim;
    const r = this.pendingReplay;
    if (!r || sim.match.phase !== 'deadball' || sim.t - r.t < 1.0) return;
    if (sim.t - r.t > 6) { this.pendingReplay = null; return; }
    this.pendingReplay = null;
    const start = this.replayBuf.findIndex((f) => f.t >= r.t - 2.6);
    const end = this.replayBuf.findIndex((f) => f.t >= r.t + 1.0);
    if (start < 0) return;
    const frames = this.replayBuf.slice(start, end < 0 ? undefined : end);
    if (frames.length < 30) return;
    const ghosts = new Map();
    for (const p of this.views.keys()) {
      const g = Object.create(Player.prototype);
      g.def = p.def; g.heightM = p.heightM; g.onCourt = false; g.intent = { stance: false, handsUp: false };
      ghosts.set(p, g);
    }
    const frameSim = { ball: { p: {}, prevP: {}, w: {}, dribble: {} }, match: { phase: 'replay' } };
    this.replay = { frames, i: 0, f: 0, speed: 0.55, ghosts, frameSim, alpha: 0, kind: r.kind, player: r.player };
    for (const [p, v] of this.views) v.p = ghosts.get(p);
    const tgt = ghosts.get(r.player);
    const shooterHoop = sim.match.attackHoop(r.player.team);
    this.camera.startCinematic('replay', { target: () => ({ x: tgt.x, z: tgt.z }), hoop: r.kind === 'Block' ? sim.match.defendHoop(r.player.team) : shooterHoop, angle0: Math.random() * Math.PI * 2 });
    this.hud.showReplay(r.kind);
    this.applyReplayFrame(0);
  }

  applyReplayFrame(i) {
    const R = this.replay;
    const f = R.frames[Math.min(i, R.frames.length - 1)];
    for (const g of R.ghosts.values()) g.onCourt = false;
    for (const s of f.players) {
      const g = R.ghosts.get(s.ref);
      Object.assign(g, { x: s.x, z: s.z, prevX: s.prevX, prevZ: s.prevZ, y: s.y, facing: s.facing, vx: s.vx, vz: s.vz, speed: s.speed, airborne: s.airborne, posting: s.posting, action: s.action, onCourt: true });
      g.intent = { stance: s.stance, handsUp: s.handsUp };
    }
    const b = R.frameSim.ball;
    b.p = f.ball.p; b.prevP = f.ball.prevP; b.w = f.ball.w; b.state = f.ball.state; b.dribble = f.ball.dribble;
    b.owner = f.ball.owner ? R.ghosts.get(f.ball.owner) : null;
    b.air = f.ball.air ? { kind: f.ball.air.kind, target: f.ball.air.target ? R.ghosts.get(f.ball.air.target) : null } : null;
  }

  updateReplay(dt, ui) {
    const R = this.replay;
    R.f += dt * R.speed * 60;
    const i = Math.floor(R.f);
    R.alpha = R.f - i;
    if (i !== R.i) { R.i = i; this.applyReplayFrame(i); }
    if (i >= R.frames.length - 1 || ui.skip) this.endReplay();
  }

  endReplay() {
    for (const [p, v] of this.views) v.p = p;
    this.replay = null;
    this.camera.stopCinematic();
    this.hud.hideReplay();
  }
}

export function fmtClock(s) {
  s = Math.max(0, s);
  if (s < 60) return `${Math.floor(s)}.${Math.floor((s * 10) % 10)}`;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function quarterLabel(m) {
  if (m.halfCourt) return 'BLACKTOP';
  if (m.practice) return 'PRACTICE';
  if (m.quarter <= 4) return `Q${m.quarter}`;
  return m.quarter === 5 ? 'OT' : `${m.quarter - 4}OT`;
}

export { HALF_L };
