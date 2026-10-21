// Application shell: boots the menu scene, routes between menus and game
// sessions, and owns long-lived services (settings, input, audio).
import './styles.css';
import rosters from './data/rosters.json';
import { Settings } from './core/Settings.js';
import { InputManager } from './input/InputManager.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { Menus } from './ui/Menus.js';
import { Game } from './core/Game.js';
import { Renderer } from './render/Renderer.js';
import { Arena } from './render/Arena.js';
import { CameraSystem } from './render/CameraSystem.js';

class App {
  constructor() {
    this.stage = document.getElementById('stage');
    this.ui = document.getElementById('ui');
    this.rosters = rosters;
    this.settings = new Settings();
    this.input = new InputManager();
    this.audio = new AudioSystem(this.settings.data);
    this.menus = new Menus(this);
    this.game = null;
    const unlock = () => { this.audio.ensure(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.__app = this;
  }

  async boot() {
    const ld = this.menus.loading('Building arena');
    await this.buildMenuScene((f, l) => ld.set(f, l));
    this.menus.main();
  }

  async buildMenuScene(progress) {
    progress(0.1, 'Renderer');
    await frame();
    const q = this.settings.data.quality === 'ultra' ? 'high' : this.settings.data.quality;
    this.menuRenderer = new Renderer(this.stage, q);
    progress(0.4, 'Arena');
    await frame();
    const t = rosters.teams;
    this.menuArena = new Arena(this.menuRenderer.scene, { outdoor: false, quality: this.menuRenderer.q.mesh, shadows: this.menuRenderer.q.shadows, shadowSize: this.menuRenderer.q.shadowSize, reflect: false, renderer: this.menuRenderer.renderer, home: t[0], away: t[1] });
    progress(0.9, 'Lighting');
    await frame();
    this.menuCam = new CameraSystem(this.menuRenderer.camera);
    this.menuCam.startCinematic('menu');
    progress(1, 'Ready');
    let last = performance.now();
    const loop = (now) => {
      if (!this.menuRenderer) return;
      this.menuRaf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.menuCam.update(dt, {});
      if (this.preview) this.preview.view.update({ ball: { owner: null, state: 'dead', dribble: { side: 1 }, air: null }, match: { phase: 'menu' } }, 1, dt, { x: 0, y: 1, z: 3 });
      this.menuArena.update(dt, now / 1000, { excite: 0.25, shotClockText: '24', gameClockText: '12:00', score: '0-0', scoreHome: 0, scoreAway: 0, clockText: '12:00', quarterText: 'Q1' }, null);
      this.menuRenderer.render();
    };
    this.menuRaf = requestAnimationFrame(loop);
  }

  /** Show a generated player at centre court in the menu scene (MyPLAYER builder). */
  async showMenuPreview(def, colors) {
    if (!this.menuRenderer) return;
    const { PlayerView } = await import('./render/PlayerView.js');
    const { Player } = await import('./sim/Player.js');
    this.hideMenuPreview();
    const p = new Player(def, 0, true);
    p.onCourt = true;
    p.setPos(0, 0, Math.PI / 2);
    const view = new PlayerView(p, { colors }, { quality: this.menuRenderer.q.mesh, teamName: 'MyPLAYER' });
    this.menuRenderer.scene.add(view.root);
    this.preview = { p, view };
    if (!this.menuCam.cinematic || this.menuCam.cinematic.kind !== 'preview') this.menuCam.startCinematic('preview', { height: def.heightM });
    else this.menuCam.cinematic.height = def.heightM;
  }

  hideMenuPreview() {
    if (!this.preview) return;
    this.menuRenderer?.scene.remove(this.preview.view.root);
    this.preview.view.dispose();
    this.preview = null;
    if (this.menuCam) this.menuCam.startCinematic('menu');
  }

  disposeMenuScene() {
    this.preview = null;
    cancelAnimationFrame(this.menuRaf);
    if (this.menuRenderer) this.menuRenderer.dispose();
    this.menuRenderer = null;
  }

  async startGame(cfg) {
    this.lastCfg = cfg;
    this.audio.ensure();
    this.disposeMenuScene();
    const ld = this.menus.loading('Loading game');
    const game = new Game(this, cfg);
    this.game = game;
    try {
      await game.load((f, label) => ld.set(f, label));
    } catch (err) {
      console.error(err);
      this.menus.screen(`<div class="error"><h1>Failed to load the game</h1><pre>${String(err && err.stack || err)}</pre><button onclick="location.reload()">Reload</button></div>`);
      return;
    }
    this.menus.hide();
    game.start();
  }

  quitToMenu() {
    if (this.game) this.game.stop();
    this.game = null;
    this.boot();
  }

  restart() {
    const cfg = this.lastCfg;
    if (this.game) this.game.stop();
    this.game = null;
    this.startGame(cfg);
  }
}

function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

if (new URLSearchParams(location.search).get('view') === 'model') {
  import('./dev/ModelViewer.js').then((m) => m.startModelViewer(document.getElementById('stage'), document.getElementById('ui')));
} else {
const app = new App();
app.boot().catch((e) => {
  console.error(e);
  document.getElementById('ui').innerHTML = `<div class="error"><h1>Startup error</h1><pre>${String(e && e.stack || e)}</pre></div>`;
});
}
