// Front-end menus: main menu, mode setup screens, settings (graphics, audio,
// gameplay, camera, key remapping) and a live controller test.
import { DIFFICULTY } from '../sim/Shooting.js';
import { buildPlayerDef, BADGES, BADGE_TIERS } from '../sim/Attributes.js';
import { ACTIONS, PAD } from '../input/InputManager.js';
import { CAMERA_MODES, CAMERA_LABELS } from '../render/CameraSystem.js';
import { fmtHeight } from './HUD.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Menus {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.className = 'menus';
    app.ui.appendChild(this.root);
    this.teams = app.rosters.teams;
  }

  clear() { this.root.innerHTML = ''; this.stopPadTest(); }
  hide() { this.clear(); this.root.style.display = 'none'; }
  show() { this.root.style.display = ''; }

  screen(html, cls = '') {
    this.clear();
    this.show();
    const d = document.createElement('div');
    d.className = `screen ${cls}`;
    d.innerHTML = html;
    this.root.appendChild(d);
    return d;
  }

  // -------------------------------------------------------------------------
  main() {
    const results = (() => { try { return JSON.parse(localStorage.getItem('hw27.results') || '[]'); } catch { return []; } })();
    const last = results[0];
    const s = this.screen(`
      <div class="brand"><div class="logo">HARDWOOD<span>27</span></div><div class="tag">Basketball simulation · HTML5 / WebGL</div></div>
      <nav class="main-nav">
        <button data-go="playnow" class="big"><b>PLAY NOW</b><span>Full 5-on-5 game · pick teams, uniforms, difficulty</span></button>
        <button data-go="blacktop" class="big"><b>BLACKTOP</b><span>1v1 – 5v5 streetball, game to 11/15/21</span></button>
        <button data-go="practice" class="big"><b>PRACTICE</b><span>Shot timing, dribble combos, finishing</span></button>
        <button class="big locked" disabled><b>MyCAREER</b><span>In development — not playable yet</span></button>
        <button class="big locked" disabled><b>FRANCHISE</b><span>In development — not playable yet</span></button>
        <button class="big locked" disabled><b>ONLINE</b><span>Not implemented (no networking yet)</span></button>
        <div class="row">
          <button data-go="settings">Settings</button>
          <button data-go="controls">Controls &amp; Controller Test</button>
          <button data-go="about">About &amp; Assets</button>
        </div>
      </nav>
      ${last ? `<div class="last-result">Last game: ${esc(last.away)} ${last.score[1]} – ${last.score[0]} ${esc(last.home)} (${esc(last.mode)})</div>` : ''}`, 'main');
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !b.dataset.go) return;
      this.app.audio.ensure();
      this.app.audio.startMusic('menu');
      const go = b.dataset.go;
      if (go === 'playnow') this.playNowSetup();
      if (go === 'blacktop') this.blacktopSetup();
      if (go === 'practice') this.practiceSetup();
      if (go === 'settings') this.settingsScreen();
      if (go === 'controls') this.controlsScreen();
      if (go === 'about') this.about();
    });
  }

  teamCard(t, idx, uniform, side) {
    const defs = t.players.map((p) => buildPlayerDef(p, t.id));
    const roster = defs.map((d) => `<li><b>${d.num}</b><span>${esc(d.name)}</span><em>${d.pos}</em><em>${fmtHeight(d.heightM)}</em><strong>${d.ovr}</strong></li>`).join('');
    const ovr = Math.round(defs.slice(0, 5).reduce((a, d) => a + d.ovr, 0) / 5);
    const chip = (u) => `<button class="uni ${uniform === u ? 'on' : ''}" data-uni="${u}" data-side="${side}" style="--a:${t.colors[u][0]};--b:${t.colors[u][1]}">${u}</button>`;
    return `<div class="team-card" style="--tc:${t.colors.home[1]};--tc2:${t.colors.home[2]}">
      <div class="tc-head"><button class="arrow" data-cyc="-1" data-side="${side}">‹</button><div><h3>${esc(t.city)}</h3><h2>${esc(t.name)}</h2><small>${esc(t.style)} · Team OVR ${ovr}</small></div><button class="arrow" data-cyc="1" data-side="${side}">›</button></div>
      <div class="unis">${chip('home')}${chip('away')}${chip('alt')}</div>
      <ul class="roster">${roster}</ul></div>`;
  }

  playNowSetup() {
    const st = this.app.settings.data;
    const cfg = this.pnCfg || (this.pnCfg = { home: 0, away: 1, uniHome: 'home', uniAway: 'away', control: 'home', difficulty: st.difficulty, quarterMin: st.quarterMin });
    const render = () => {
      const opts = (name, list, cur) => list.map(([v, l]) => `<button class="opt ${String(cur) === String(v) ? 'on' : ''}" data-opt="${name}" data-v="${v}">${l}</button>`).join('');
      const s = this.screen(`
        <h1 class="screen-title">PLAY NOW</h1>
        <div class="matchup">
          ${this.teamCard(this.teams[cfg.away], cfg.away, cfg.uniAway, 'away')}
          <div class="vs">@</div>
          ${this.teamCard(this.teams[cfg.home], cfg.home, cfg.uniHome, 'home')}
        </div>
        <div class="options">
          <div><label>You control</label>${opts('control', [['away', this.teams[cfg.away].abbr + ' (Away)'], ['home', this.teams[cfg.home].abbr + ' (Home)'], ['cpu', 'CPU vs CPU']], cfg.control)}</div>
          <div><label>Difficulty</label>${opts('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), cfg.difficulty)}</div>
          <div><label>Quarter length</label>${opts('quarterMin', [3, 5, 6, 8, 10, 12].map((m) => [m, `${m} min`]), cfg.quarterMin)}</div>
        </div>
        <div class="row end"><button data-a="back">Back</button><button data-a="start" class="primary">Start Game</button></div>`, 'setup');
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.cyc) {
          const k = b.dataset.side;
          let v = (cfg[k] + Number(b.dataset.cyc) + this.teams.length) % this.teams.length;
          if (v === cfg[k === 'home' ? 'away' : 'home']) v = (v + Number(b.dataset.cyc) + this.teams.length) % this.teams.length;
          cfg[k] = v;
          render();
        } else if (b.dataset.uni) {
          if (b.dataset.side === 'home') cfg.uniHome = b.dataset.uni; else cfg.uniAway = b.dataset.uni;
          render();
        } else if (b.dataset.opt) {
          cfg[b.dataset.opt] = b.dataset.opt === 'quarterMin' ? Number(b.dataset.v) : b.dataset.v;
          render();
        } else if (b.dataset.a === 'back') this.main();
        else if (b.dataset.a === 'start') {
          st.difficulty = cfg.difficulty; st.quarterMin = cfg.quarterMin; this.app.settings.save();
          if (cfg.uniHome === cfg.uniAway && cfg.uniHome !== 'alt') cfg.uniAway = cfg.uniHome === 'home' ? 'away' : 'home';
          this.app.startGame({
            mode: 'playnow', teams: [this.teams[cfg.home], this.teams[cfg.away]], uniforms: [cfg.uniHome, cfg.uniAway],
            userTeam: cfg.control === 'home' ? 0 : cfg.control === 'away' ? 1 : null, difficulty: cfg.difficulty, quarterMin: cfg.quarterMin,
          });
        }
      });
    };
    render();
  }

  blacktopSetup() {
    const cfg = this.btCfg || (this.btCfg = { home: 2, away: 5, size: 3, target: 21, ones: false, makeItTakeIt: false, control: 'home', difficulty: this.app.settings.data.difficulty });
    const render = () => {
      const opts = (name, list, cur) => list.map(([v, l]) => `<button class="opt ${String(cur) === String(v) ? 'on' : ''}" data-opt="${name}" data-v="${v}">${l}</button>`).join('');
      const s = this.screen(`
        <h1 class="screen-title">BLACKTOP</h1>
        <div class="matchup">${this.teamCard(this.teams[cfg.away], cfg.away, 'away', 'away')}<div class="vs">vs</div>${this.teamCard(this.teams[cfg.home], cfg.home, 'home', 'home')}</div>
        <p class="muted center">Each side fields its best ${cfg.size} by overall. Half court, check ball at the top, clear the arc after a defensive rebound or steal. No free throws: fouls are checked up.</p>
        <div class="options">
          <div><label>Team size</label>${opts('size', [[1, '1v1'], [2, '2v2'], [3, '3v3'], [5, '5v5']], cfg.size)}</div>
          <div><label>Game to</label>${opts('target', [[11, '11'], [15, '15'], [21, '21']], cfg.target)}</div>
          <div><label>Scoring</label>${opts('ones', [['true', "1s & 2s"], ['false', "2s & 3s"]], String(cfg.ones))}</div>
          <div><label>Make it, take it</label>${opts('makeItTakeIt', [['true', 'On'], ['false', 'Off']], String(cfg.makeItTakeIt))}</div>
          <div><label>You control</label>${opts('control', [['away', this.teams[cfg.away].abbr], ['home', this.teams[cfg.home].abbr], ['cpu', 'CPU vs CPU']], cfg.control)}</div>
          <div><label>Difficulty</label>${opts('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), cfg.difficulty)}</div>
        </div>
        <div class="row end"><button data-a="back">Back</button><button data-a="start" class="primary">Start</button></div>`, 'setup');
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.cyc) {
          const k = b.dataset.side;
          let v = (cfg[k] + Number(b.dataset.cyc) + this.teams.length) % this.teams.length;
          if (v === cfg[k === 'home' ? 'away' : 'home']) v = (v + Number(b.dataset.cyc) + this.teams.length) % this.teams.length;
          cfg[k] = v; render();
        } else if (b.dataset.opt) {
          const v = b.dataset.v;
          cfg[b.dataset.opt] = v === 'true' ? true : v === 'false' ? false : isNaN(Number(v)) ? v : Number(v);
          render();
        } else if (b.dataset.a === 'back') this.main();
        else if (b.dataset.a === 'start') {
          this.app.startGame({
            mode: 'blacktop', teams: [this.teams[cfg.home], this.teams[cfg.away]], uniforms: ['home', 'away'], playersPerSide: cfg.size,
            userTeam: cfg.control === 'home' ? 0 : cfg.control === 'away' ? 1 : null, difficulty: cfg.difficulty, quarterMin: 12,
            targetScore: cfg.target, ones: cfg.ones, makeItTakeIt: cfg.makeItTakeIt, winBy2: true,
          });
        }
      });
    };
    render();
  }

  practiceSetup() {
    const cfg = this.prCfg || (this.prCfg = { team: 0, player: 0, defender: false });
    const render = () => {
      const t = this.teams[cfg.team];
      const defs = t.players.map((p) => buildPlayerDef(p, t.id));
      const d = defs[cfg.player];
      const badges = Object.entries(d.badges).map(([b, tier]) => `<span class="badge t${tier}">${esc(BADGES[b].name)} · ${BADGE_TIERS[tier]}</span>`).join('');
      const R = d.ratings;
      const bars = [['3PT', R.threeShot], ['Mid', R.midShot], ['Layup', R.layup], ['Dunk', R.drivingDunk], ['Handle', R.ballHandle], ['Speed', R.speed], ['Vertical', R.vertical], ['Strength', R.strength]]
        .map(([l, v]) => `<div class="rbar"><span>${l}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`).join('');
      const s = this.screen(`
        <h1 class="screen-title">PRACTICE</h1>
        <div class="practice">
          <div class="team-card" style="--tc:${t.colors.home[1]}">
            <div class="tc-head"><button class="arrow" data-cyc="-1">‹</button><div><h3>${esc(t.city)}</h3><h2>${esc(t.name)}</h2></div><button class="arrow" data-cyc="1">›</button></div>
            <ul class="roster pick">${defs.map((q, i) => `<li class="${i === cfg.player ? 'on' : ''}" data-p="${i}"><b>${q.num}</b><span>${esc(q.name)}</span><em>${q.pos}</em><strong>${q.ovr}</strong></li>`).join('')}</ul>
          </div>
          <div class="player-sheet">
            <h2>${esc(d.name)} <small>${d.pos} · ${fmtHeight(d.heightM)} · ${Math.round(d.weightKg * 2.2046)} lb · wingspan ${fmtHeight(d.wingM)}</small></h2>
            <div class="ratings">${bars}</div>
            <div class="badges">${badges || '<span class="muted">No badges</span>'}</div>
            <div class="options"><div><label>Defender</label><button class="opt ${!cfg.defender ? 'on' : ''}" data-def="0">None</button><button class="opt ${cfg.defender ? 'on' : ''}" data-def="1">CPU defender</button></div></div>
            <p class="muted">Ball is returned after every shot. Shot feedback shows release timing in milliseconds, contest and the make chance.</p>
          </div>
        </div>
        <div class="row end"><button data-a="back">Back</button><button data-a="start" class="primary">Start Practice</button></div>`, 'setup');
      s.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-p]');
        if (li) { cfg.player = Number(li.dataset.p); render(); return; }
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.cyc) { cfg.team = (cfg.team + Number(b.dataset.cyc) + this.teams.length) % this.teams.length; cfg.player = 0; render(); }
        else if (b.dataset.def) { cfg.defender = b.dataset.def === '1'; render(); }
        else if (b.dataset.a === 'back') this.main();
        else if (b.dataset.a === 'start') {
          const team = { ...t, players: [t.players[cfg.player], ...t.players.filter((_, i) => i !== cfg.player)] };
          const opp = this.teams[(cfg.team + 1) % this.teams.length];
          this.app.startGame({ mode: 'practice', teams: [team, opp], uniforms: ['home', 'away'], userTeam: 0, difficulty: 'pro', quarterMin: 12, playersPerSide: 1, defender: cfg.defender });
        }
      });
    };
    render();
  }

  // -------------------------------------------------------------------------
  settingsScreen() {
    const st = this.app.settings.data;
    const render = () => {
      const opt = (key, list) => list.map(([v, l]) => `<button class="opt ${String(st[key]) === String(v) ? 'on' : ''}" data-k="${key}" data-v="${v}">${l}</button>`).join('');
      const slider = (key, label) => `<div class="slider"><label>${label}</label><input type="range" min="0" max="1" step="0.05" value="${st[key]}" data-s="${key}"><em>${Math.round(st[key] * 100)}</em></div>`;
      const s = this.screen(`
        <h1 class="screen-title">SETTINGS</h1>
        <div class="settings-grid">
          <section><h3>Graphics</h3>
            <div><label>Quality</label>${opt('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']])}</div>
            <p class="muted">Ultra adds a mirrored floor reflection pass and 4K shadows. Applies to the next game.</p>
            <div><label>Performance overlay</label>${opt('perfOverlay', [['true', 'On'], ['false', 'Off']])}</div>
          </section>
          <section><h3>Audio</h3>${slider('master', 'Master')}${slider('music', 'Music')}${slider('crowd', 'Crowd')}${slider('sfx', 'Gameplay SFX')}${slider('commentary', 'Commentary')}
            <div><label>Spoken commentary (browser TTS)</label>${opt('voice', [['true', 'On'], ['false', 'Off']])}</div></section>
          <section><h3>Gameplay</h3>
            <div><label>Shot meter</label>${opt('shotMeter', [['true', 'On'], ['false', 'Off']])}</div>
            <div><label>Shot feedback</label>${opt('shotFeedback', [['full', 'Full'], ['basic', 'Basic'], ['all', 'All players'], ['off', 'Off']])}</div>
            <div><label>Layup timing meter</label>${opt('layupTiming', [['true', 'On'], ['false', 'Off']])}</div>
            <div><label>Auto-switch to ball handler</label>${opt('autoSwitch', [['true', 'On'], ['false', 'Off']])}</div>
            <div><label>Instant replays</label>${opt('replays', [['true', 'On'], ['false', 'Off']])}</div>
            <div><label>On-screen hints</label>${opt('showHints', [['true', 'On'], ['false', 'Off']])}</div>
          </section>
          <section><h3>Camera</h3>
            <div><label>Mode</label>${opt('cameraMode', CAMERA_MODES.map((m) => [m, CAMERA_LABELS[m]]))}</div>
            ${slider('camHeight', 'Height')}${slider('camZoom', 'Zoom')}${slider('camTracking', 'Tracking')}
            <div><label>Free-throw camera</label>${opt('ftCamera', [['true', 'On'], ['false', 'Off']])}</div>
          </section>
        </div>
        <div class="row end"><button data-a="back" class="primary">Done</button></div>`, 'setup');
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.k) {
          const v = b.dataset.v;
          st[b.dataset.k] = v === 'true' ? true : v === 'false' ? false : v;
          this.app.settings.save();
          render();
        } else if (b.dataset.a === 'back') this.main();
      });
      s.addEventListener('input', (e) => {
        const k = e.target.dataset.s;
        if (!k) return;
        // Camera sliders map 0..1 onto 0.6..1.4.
        let v = Number(e.target.value);
        st[k] = v;
        if (k.startsWith('cam')) st[k] = 0.6 + v * 0.8;
        e.target.nextElementSibling.textContent = Math.round(v * 100);
        this.app.settings.save();
        this.app.audio.applyVolumes();
      });
      // Show camera sliders in their 0..1 form.
      for (const k of ['camHeight', 'camZoom', 'camTracking']) {
        const inp = s.querySelector(`[data-s="${k}"]`);
        if (inp) { const v = (st[k] - 0.6) / 0.8; inp.value = v; inp.nextElementSibling.textContent = Math.round(v * 100); }
      }
    };
    render();
  }

  controlsScreen() {
    const inp = this.app.input;
    const render = () => {
      const rows = Object.entries(ACTIONS).map(([a, label]) => `<tr><td>${esc(label)}</td><td>${(inp.bindings[a] || []).map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</td><td><button data-rebind="${a}">Change</button></td></tr>`).join('');
      const s = this.screen(`
        <h1 class="screen-title">CONTROLS</h1>
        <div class="controls-grid">
          <section><h3>Keyboard (click Change, then press a key)</h3><table class="kv">${rows}</table><button data-a="reset">Reset to defaults</button></section>
          <section><h3>Gamepad (Xbox / PlayStation, standard mapping)</h3>
            <table class="kv">
              <tr><td>Left stick</td><td>Move</td></tr><tr><td>RT / R2</td><td>Sprint</td></tr>
              <tr><td>X / Square</td><td>Shoot (hold, release) · Steal on D</td></tr>
              <tr><td>A / Cross</td><td>Pass · Switch player on D</td></tr>
              <tr><td>B / Circle</td><td>Bounce pass · Take charge on D</td></tr>
              <tr><td>Y / Triangle</td><td>Lob / alley-oop · Block / rebound on D</td></tr>
              <tr><td>RB / R1 + face button</td><td>Icon pass</td></tr><tr><td>LB / L1</td><td>Call for screen</td></tr>
              <tr><td>LT / L2</td><td>Post up · Defensive stance (intense D)</td></tr>
              <tr><td>Right stick flick</td><td>Dribble moves (toward off hand = crossover, back-off-hand = between legs, back-ball-hand = behind back, forward = hesitation, back = stepback)</td></tr>
              <tr><td>Right stick rotate</td><td>Spin</td></tr><tr><td>Right stick hold down</td><td>Pro Stick jumper (release to shoot)</td></tr>
              <tr><td>Right stick up (D)</td><td>Hands up</td></tr><tr><td>View / Share</td><td>Timeout</td></tr><tr><td>Menu / Options</td><td>Pause</td></tr><tr><td>D-pad up</td><td>Cycle camera</td></tr>
            </table>
            <p class="muted">Layout follows long-standing NBA 2K conventions; it has not been verified frame-by-frame against NBA 2K27.</p>
            <h3>Controller test</h3><div class="padtest">Connect a controller and press any button…</div>
          </section>
        </div>
        <div class="row end"><button data-a="back" class="primary">Done</button></div>`, 'setup');
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.rebind) {
          b.textContent = 'Press a key…';
          inp.rebind(b.dataset.rebind, () => render());
        } else if (b.dataset.a === 'reset') { inp.resetBindings(); render(); }
        else if (b.dataset.a === 'back') this.main();
      });
      this.startPadTest(s.querySelector('.padtest'));
    };
    render();
  }

  startPadTest(box) {
    this.stopPadTest();
    const inp = this.app.input;
    const names = Object.fromEntries(Object.entries(PAD).map(([k, v]) => [v, k]));
    const log = [];
    const loop = (now) => {
      this.padRaf = requestAnimationFrame(loop);
      inp.pollPad(now);
      const P = inp.pad;
      if (inp.flickQueue.length) { const f = inp.flickQueue.shift(); log.unshift(`Flick (${f.x.toFixed(2)}, ${f.y.toFixed(2)})`); }
      if (inp.pendingPresses.has('rsSpin')) log.unshift('Right-stick rotation (spin)');
      if (inp.pendingPresses.has('rsHoldRelease')) log.unshift('Right-stick hold released (Pro Stick shot)');
      for (const k of inp.pendingPresses) if (k.startsWith('pad')) log.unshift(`Pressed ${names[Number(k.slice(3))] || k}`);
      inp.endStep();
      log.length = Math.min(log.length, 6);
      if (!P.connected) { box.textContent = 'No controller detected. Connect one and press a button (browsers expose pads after the first input).'; return; }
      const ax = P.axes.map((v, i) => `<div class="axis"><span>${['LX', 'LY', 'RX', 'RY'][i]}</span><i><b style="left:${50 + v * 50}%"></b></i><em>${v.toFixed(2)}</em></div>`).join('');
      const bt = P.buttons.map((v, i) => `<span class="pb ${v > 0.5 ? 'on' : ''}">${names[i] || i}${v > 0.05 && v < 0.95 ? ` ${v.toFixed(2)}` : ''}</span>`).join('');
      box.innerHTML = `<div class="padname">${esc(P.id)}</div>${ax}<div class="pbs">${bt}</div><div class="padlog">${log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
    };
    this.padRaf = requestAnimationFrame(loop);
  }

  stopPadTest() {
    if (this.padRaf) cancelAnimationFrame(this.padRaf);
    this.padRaf = null;
  }

  about() {
    const s = this.screen(`
      <h1 class="screen-title">ABOUT &amp; ASSETS</h1>
      <div class="about">
        <p><b>Hardwood 27</b> is an independent HTML5 basketball simulation inspired by modern NBA 2K gameplay. It contains no NBA 2K code, assets, animations or likenesses, and uses an original fictional league.</p>
        <p><b>Characters</b> are generated procedurally at runtime (original rigged meshes with a 24-bone skeleton, sculpted heads, uniforms). They are engineering stand-ins, not photoreal scans; the loader is ready for licensed GLB characters using the same bone names. See <code>docs/ASSETS.md</code>.</p>
        <p><b>Animations</b> are an original hand-keyed library (not motion capture), blended with stride-synced locomotion and IK.</p>
        <p><b>Audio</b> is synthesised with the Web Audio API. Commentary is generated text (optionally read by your browser's speech engine).</p>
        <p>Not yet implemented: MyCAREER, Franchise, online multiplayer, licensed rosters/likenesses, motion-captured animation.</p>
      </div>
      <div class="row end"><button data-a="back" class="primary">Back</button></div>`, 'setup');
    s.addEventListener('click', (e) => { if (e.target.dataset.a === 'back') this.main(); });
  }

  loading(text = 'Loading') {
    const s = this.screen(`<div class="loading"><div class="logo">HARDWOOD<span>27</span></div><div class="lbar"><b></b></div><div class="ltext">${esc(text)}</div></div>`, 'loading-screen');
    return {
      set: (f, label) => {
        s.querySelector('.lbar b').style.width = `${Math.round(f * 100)}%`;
        s.querySelector('.ltext').textContent = `${label} · ${Math.round(f * 100)}%`;
      },
    };
  }
}
