// In-game visual checks: start a CPU-vs-CPU game, fast-forward the simulation
// to interesting states (dribbling, shooting, rebounding, free throws) and
// capture close camera screenshots.
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const server = await startServer(5197);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(server.url + '');
await page.waitForSelector('.main-nav', { timeout: 60000 });
await page.evaluate(() => {
  const app = window.__app;
  const t = app.rosters.teams;
  app.settings.data.replays = false;
  app.startGame({ mode: 'playnow', teams: [t[0], t[1]], uniforms: ['home', 'away'], userTeam: null, difficulty: 'allstar', quarterMin: 5, seed: 7 });
}).catch((e) => console.log('EVAL ERR', e));
await page.waitForSelector('.pregame', { timeout: 240000 }).catch((e) => { console.log('ERRS', errs); throw e; });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__app.game && window.__app.game.running && window.__app.game.sim.match.phase !== 'pregame', null, { timeout: 60000 });
const snap = async (name, cond, cam) => {
  await page.evaluate(({ cond, cam }) => {
    const g = window.__app.game;
    g.paused = true;
    g.fastForward(30, new Function('sim', `return ${cond}`));
    window.__camOverride = cam;
  }, { cond, cam });
  // Place a close camera on the ball handler / ball.
  await page.evaluate((cam) => {
    const g = window.__app.game;
    const sim = g.sim;
    const target = sim.holder() || sim.ball.p;
    g.camera.update = function () {
      const c = this.camera;
      const tx = target.x, tz = target.z;
      c.position.set(tx + cam[0], cam[1], tz + cam[2]);
      c.lookAt(tx, cam[3], tz);
      c.fov = 40; c.updateProjectionMatrix();
    };
    g.renderFrame(0.016, 1);
    g.renderFrame(0.016, 1);
  }, cam);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
};
await snap('g-dribble', "sim.ball.state === 'dribble' && sim.holder().speed > 2.5 && sim.match.phase === 'live'", [0, 2.2, 4.2, 1.0]);
await snap('g-shot', "(() => { const h = sim.holder(); return h && h.action && h.action.type === 'shot' && h.action.t > h.action.data.tIdeal * 0.8; })()", [2.5, 2.6, 4.5, 1.8]);
await snap('g-layup', "(() => { const h = sim.holder(); return h && h.action && (h.action.type === 'layup' || h.action.type === 'dunk') && h.airborne; })()", [3, 2.4, 5, 2]);
await snap('g-defense', "(() => { const h = sim.holder(); return h && h.team === 0 && sim.match.phase === 'live' && Math.abs(h.x) > 7; })()", [0, 6, 9, 0.8]);
await snap('g-ft', "sim.match.phase === 'freethrow' && sim.match.ft && sim.holder()", [0, 3, 6, 1.5]);
const state = await page.evaluate(() => { const m = window.__app.game.sim.match; return { q: m.quarter, clock: m.clock, score: m.score, phase: m.phase }; });
console.log(JSON.stringify(state));
console.log('errors', errs.slice(0, 10));
await browser.close();
await server.close();
