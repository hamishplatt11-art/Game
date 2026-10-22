// Visual verification at the eight checkpoints of the upgrade brief, captured
// identically from any checkout so "before" and "after" builds can be compared:
//   node tests/browser/compare.mjs [projectRoot] [outDir]
// 1 full court (10 players + scoreboard)  2/3 athlete close-up front + side
// 4 sprint + hard plant  5 dribble move  6 jump shot near release
// 7 layup/dunk at the rim  8 block/contest/rebound  9 main menu  10 MyPLAYER builder
import { launchBrowser } from './launch.mjs';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || 'tests/browser/out/after');
fs.mkdirSync(out, { recursive: true });
const server = await startServer(Number(process.env.PORT || 5187), root);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack || e)));
const shot = (n) => page.screenshot({ path: path.join(out, `${n}.png`), timeout: 240000 });
const found = {};

await page.goto(server.url);
await page.evaluate(() => localStorage.setItem('hw27.settings', JSON.stringify({ quality: 'medium', replays: false, perfOverlay: false })));
await page.reload();
await page.locator('.main-nav').waitFor({ timeout: 180000 });
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
await shot('09-menu');
await page.click('[data-go="builder"]');
await page.waitForTimeout(6000);
await shot('10-builder');

// Athlete close-ups in the model viewer.
for (const [n, yaw] of [['02-athlete-front', 0], ['03-athlete-side', 1.5708]]) {
  await page.goto(`${server.url}?view=model&q=medium&clip=idle&t=0.4&yaw=${yaw}&pitch=0.05&dist=1.5&fy=1.45&nopanel`);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot(n);
}

await page.goto(server.url);
await page.locator('.main-nav').waitFor({ timeout: 180000 });
await page.evaluate(() => {
  const t = window.__app.rosters.teams;
  window.__app.startGame({ mode: 'playnow', teams: [t[0], t[1]], uniforms: ['home', 'away'], userTeam: null, difficulty: 'allstar', quarterMin: 5, seed: 7 });
});
await page.locator('.pregame').waitFor({ timeout: 300000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__app.game.running && window.__app.game.sim.match.phase !== 'pregame', null, { timeout: 60000 });

// Full court: the default broadcast camera.
await page.evaluate(() => {
  const g = window.__app.game;
  g.paused = true;
  g.fastForward(60, (sim) => sim.match.phase === 'live' && sim.t > 20 && Math.abs(sim.ball.p.x) < 4);
  for (let i = 0; i < 90; i++) g.renderFrame(1 / 60, 1);
  g.hud.update(0.016);
});
await page.waitForTimeout(800);
await shot('01-full-court');

const snap = async (name, cond, target, cam, maxS = 240) => {
  const ok = await page.evaluate(({ cond, target, cam, maxS }) => {
    const g = window.__app.game;
    const C = new Function('sim', `return ${cond}`);
    const T = new Function('sim', `return ${target}`);
    g.fastForward(maxS, (sim) => { try { return !!C(sim); } catch { return false; } });
    let hit = false;
    try { hit = !!C(g.sim); } catch { hit = false; }
    const tg = T(g.sim) || g.sim.ball.p;
    g.camera.update = function () {
      const c = this.camera;
      const f = tg.facing ?? 0;
      // Camera placed relative to the subject's facing (front-three-quarter).
      const ox = Math.cos(f) * cam[0] - Math.sin(f) * cam[2], oz = Math.sin(f) * cam[0] + Math.cos(f) * cam[2];
      c.position.set(tg.x + ox, cam[1], tg.z + oz);
      c.lookAt(tg.x, cam[3], tg.z);
      c.fov = 38; c.updateProjectionMatrix();
    };
    g.renderFrame(0.016, 1); g.renderFrame(0.016, 1);
    g.hud.update(0.016);
    return hit;
  }, { cond, target, cam, maxS });
  found[name] = ok;
  await page.waitForTimeout(600);
  await shot(name);
};
await snap('04-sprint-plant', 'sim.players.some((p) => p.onCourt && p.plantTimer > 0 && p.speed > 3)', 'sim.players.find((p) => p.onCourt && p.plantTimer > 0 && p.speed > 3)', [3.6, 1.6, 1.2, 1.0]);
await snap('05-dribble-move', "(() => { const h = sim.holder(); return h && h.action && h.action.type === 'move' && h.action.t > h.action.dur * 0.35; })()", 'sim.holder()', [3.0, 1.5, 1.0, 0.9]);
await snap('06-jumpshot-release', "(() => { const h = sim.holder(); return h && h.action && h.action.type === 'shot' && h.action.data.shotType !== 'ft' && h.action.t > h.action.data.tIdeal * 0.85; })()", 'sim.holder()', [3.4, 2.0, 1.4, 1.9]);
await snap('07-layup-dunk', "(() => { const h = sim.players.find((p) => p.onCourt && p.action && (p.action.type === 'layup' || p.action.type === 'dunk') && p.airborne && p.y > 0.25); return !!h; })()", "sim.players.find((p) => p.onCourt && p.action && (p.action.type === 'layup' || p.action.type === 'dunk') && p.airborne)", [3.4, 2.2, 1.6, 2.0]);
await snap('08-block-rebound', "sim.players.some((p) => p.onCourt && p.action && ['block', 'rebound', 'contest'].includes(p.action.type) && p.airborne)", "sim.players.find((p) => p.onCourt && p.action && ['block', 'rebound', 'contest'].includes(p.action.type) && p.airborne)", [3.6, 2.2, 1.4, 1.9]);
fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ root, found, errors: errs }, null, 1));
console.log(JSON.stringify({ found, errors: errs.slice(0, 3) }));
await browser.close();
await server.close();
