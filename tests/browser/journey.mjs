// End-to-end browser journey with machine-readable metrics.
//   boot -> visible menu -> settings persistence -> key remapping (conflict swap)
//   -> Play Now via the UI -> real keyboard play -> FPS / frame-time sample
//   -> resize -> blur releases keys -> WebGL context loss + restore
//   -> quit and restart twice (leak check) -> Blacktop 3v3 to the end
// Writes tests/browser/out/journey.json and screenshots j-*.png.
// Exit code 1 on any failed check or page error.
import { launchBrowser } from './launch.mjs';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const server = await startServer(5193);
const browser = await launchBrowser({ extraArgs: ['--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const shot = (n) => page.screenshot({ path: path.join(out, `j-${n}.png`), timeout: 180000 });
const T0 = Date.now();
const metrics = { browser: browser.__info, startedAt: new Date().toISOString() };

// ---------------------------------------------------------------- boot
await page.goto(server.url);
await page.evaluate(() => localStorage.clear());
await page.reload();
const tBoot = Date.now();
await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
metrics.menuReadyMs = Date.now() - tBoot;
metrics.gfx = await page.evaluate(() => window.__app.gfx);
metrics.hardwareAccelerated = !metrics.gfx.software;
const canvasVisible = await page.evaluate(() => {
  const c = document.querySelector('#stage canvas');
  return !!c && c.width > 0 && c.height > 0 && getComputedStyle(c).visibility !== 'hidden';
});
check('menu visible with a WebGL canvas', canvasVisible, `${metrics.menuReadyMs} ms, GPU ${metrics.gfx.renderer}`);
await shot('menu');

// ---------------------------------------------------------------- settings persistence
await page.click('[data-go="settings"]');
await page.click('[data-k="shotFeedback"][data-v="basic"]');
await page.click('[data-k="muted"][data-v="true"]');
await page.click('[data-k="quality"][data-v="low"]');
await page.locator('.main-nav, .settings-grid').first().waitFor({ timeout: 120000 });
await page.reload();
await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
const persisted = await page.evaluate(() => { const d = window.__app.settings.data; return { shotFeedback: d.shotFeedback, muted: d.muted, quality: d.quality }; });
check('settings persist across reload', persisted.shotFeedback === 'basic' && persisted.muted === true && persisted.quality === 'low', JSON.stringify(persisted));

// ---------------------------------------------------------------- remapping
await page.click('[data-go="controls"]');
await page.click('[data-rebind="pass"]');
await page.keyboard.press('KeyJ'); // already bound to shoot -> swap
const remap = await page.evaluate(() => { const i = window.__app.input; return { pass: i.bindings.pass, shoot: i.bindings.shoot, conflicts: i.conflicts() }; });
check('remap to a used key swaps instead of double-binding', remap.pass[0] === 'KeyJ' && remap.shoot[0] === 'KeyK' && remap.conflicts.length === 0, JSON.stringify(remap));
await page.click('[data-a="reset"]');
const reset = await page.evaluate(() => window.__app.input.bindings.shoot[0]);
check('reset restores default bindings', reset === 'KeyJ');
await page.click('[data-a="back"]');

// ---------------------------------------------------------------- play now via UI
const tLoad = Date.now();
await page.click('[data-go="playnow"]');
await page.click('[data-opt="quarterMin"][data-v="3"]');
await page.click('[data-a="start"]');
await page.locator('.pregame').first().waitFor({ timeout: 300000 });
metrics.gameLoadMs = Date.now() - tLoad;
await shot('pregame');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__app.game.running && window.__app.game.sim.match.phase !== 'pregame', null, { timeout: 60000 });
// Real keyboard input for a few seconds of play.
const t0 = await page.evaluate(() => window.__app.game.sim.t);
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyD');
const t1 = await page.evaluate(() => window.__app.game.sim.t);
check('simulation advances during real-time play', t1 > t0, `${(t1 - t0).toFixed(2)} sim s`);
// Frame-time sample.
await page.waitForTimeout(4000);
metrics.perf = await page.evaluate(() => {
  const g = window.__app.game, P = g.perf, s = [...P.samples].sort((a, b) => a - b);
  return { fps: +P.fps.toFixed(1), frameMedMs: +(s[Math.floor(s.length / 2)] || 0).toFixed(1), frameP95Ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(1), simMs: +P.simMs.toFixed(2), renderMs: +P.renderMs.toFixed(2), drawCalls: P.calls, triangles: P.tris, geometries: P.geos, textures: P.texs, heapMB: P.heap, quality: g.renderer.qualityName, pixelRatio: g.renderer.renderer.getPixelRatio() };
});
console.log('PERF', JSON.stringify(metrics.perf));
await shot('play');

// ---------------------------------------------------------------- resize
await page.setViewportSize({ width: 960, height: 600 });
await page.waitForTimeout(1500);
const rs = await page.evaluate(() => { const c = window.__app.game.renderer.renderer.domElement; return { w: c.clientWidth, h: c.clientHeight, aspect: +window.__app.game.renderer.camera.aspect.toFixed(3) }; });
check('canvas and camera follow a resize', rs.w === 960 && rs.h === 600 && Math.abs(rs.aspect - 1.6) < 0.01, JSON.stringify(rs));
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(800);

// ---------------------------------------------------------------- blur releases keys
await page.keyboard.down('KeyW');
await page.waitForTimeout(200);
const held = await page.evaluate(() => window.__app.input.keys.size);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
const afterBlur = await page.evaluate(() => window.__app.input.keys.size);
await page.keyboard.up('KeyW');
check('window blur releases held keys', held > 0 && afterBlur === 0, `held ${held} -> ${afterBlur}`);

// ---------------------------------------------------------------- context loss
await page.evaluate(() => { window.__ctx = window.__app.game.renderer.renderer.getContext().getExtension('WEBGL_lose_context'); window.__ctx.loseContext(); });
await page.waitForTimeout(1500);
const lost = await page.evaluate(() => ({ overlay: !!document.querySelector('.ctx-lost'), flag: window.__app.game.contextLost }));
await page.evaluate(() => window.__ctx.restoreContext());
await page.waitForTimeout(4000);
const restored = await page.evaluate(() => ({ overlay: !!document.querySelector('.ctx-lost'), flag: window.__app.game.contextLost, frames: window.__app.game.perf.samples.length }));
check('WebGL context loss shows an overlay and recovers', lost.overlay && lost.flag && !restored.overlay && !restored.flag, `${JSON.stringify(lost)} -> ${JSON.stringify(restored)}`);
await shot('after-restore');

// ---------------------------------------------------------------- restart twice (leaks)
const mem = async () => page.evaluate(async () => {
  if (window.gc) { window.gc(); await new Promise((r) => setTimeout(r, 300)); window.gc(); }
  const g = window.__app.game;
  // Upload everything once (no frustum culling) so counts don't depend on camera.
  const culled = [];
  g.scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  g.renderer.renderer.render(g.scene, g.renderer.camera);
  culled.forEach((o) => { o.frustumCulled = true; });
  const info = g.renderer.renderer.info.memory;
  return { canvases: document.querySelectorAll('canvas').length, geometries: info.geometries, textures: info.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
});
const loads = [await mem()];
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => window.__app.quitToMenu());
  await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
  await page.evaluate(() => { const t = window.__app.rosters.teams; window.__app.startGame({ mode: 'playnow', teams: [t[0], t[1]], uniforms: ['home', 'away'], userTeam: 0, difficulty: 'pro', quarterMin: 3, seed: 3 }); });
  await page.locator('.pregame').first().waitFor({ timeout: 300000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  loads.push(await mem());
}
metrics.loads = loads;
const sameGpu = loads.every((l) => l.canvases === 1) && loads[2].geometries === loads[1].geometries && loads[2].textures === loads[1].textures
  && (loads[2].heapMB === null || loads[2].heapMB - loads[1].heapMB < 8);
check('two consecutive restarts: one canvas, no GPU or JS heap growth', sameGpu, JSON.stringify(loads));

// ---------------------------------------------------------------- blacktop
await page.evaluate(() => window.__app.quitToMenu());
await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
await page.click('[data-go="blacktop"]');
await page.click('[data-opt="size"][data-v="3"]');
await page.click('[data-opt="target"][data-v="11"]');
await page.click('[data-opt="control"][data-v="cpu"]');
await page.click('[data-a="start"]');
// Blacktop goes straight to the check-up (no pregame card).
await page.waitForFunction(() => window.__app.game && window.__app.game.running && window.__app.game.sim.match.phase !== 'pregame', null, { timeout: 300000 });
const bt = await page.evaluate(() => {
  const g = window.__app.game;
  g.settings.replays = false;
  g.fastForward(1500, (sim) => sim.match.phase === 'final');
  const m = g.sim.match;
  return { phase: m.phase, score: m.score, onCourt: g.sim.teams.map((t) => t.onCourt.length) };
});
await page.waitForTimeout(3000);
await shot('blacktop-final');
check('Blacktop 3v3 plays to 11', bt.phase === 'final' && Math.max(...bt.score) >= 11 && bt.onCourt.every((n) => n === 3), JSON.stringify(bt));

// ---------------------------------------------------------------- report
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
metrics.totalMs = Date.now() - T0;
metrics.checks = checks;
metrics.errors = errors;
fs.writeFileSync(path.join(out, 'journey.json'), JSON.stringify(metrics, null, 2));
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed — metrics in tests/browser/out/journey.json`);
await browser.close();
await server.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
