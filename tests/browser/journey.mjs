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
// Every character (players + officials) upright, grounded or airborne within limits, no NaN.
const posture = await page.evaluate(() => {
  const g = window.__app.game;
  g.paused = true;
  g.fastForward(20);
  for (let i = 0; i < 120; i++) g.renderFrame(1 / 60, 1);
  g.paused = false;
  const views = [...g.views.values(), ...(g.refs ? g.refs.refs.map((r) => r.view) : [])];
  const bad = [];
  for (const v of views) {
    if (!v.root.visible) continue;
    const up = v.bones.hips.getWorldQuaternion(new v.root.quaternion.constructor()).toArray();
    const [x, y, z, w] = up;
    const upY = 1 - 2 * (x * x + z * z); // hips local +Y in world
    const hy = v.bones.head.matrixWorld.elements[13];
    if (!(upY > 0.6) || !Number.isFinite(hy) || hy < 0.8) bad.push({ name: v.p.name, upY: +upY.toFixed(2), headY: +hy.toFixed(2) });
  }
  return { checked: views.length, bad };
});
check('all players and officials upright after 20 s of play', posture.bad.length === 0, JSON.stringify(posture));
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

// ---------------------------------------------------------------- user controls in Play Now
await page.evaluate(() => {
  const g = window.__app.game;
  g.paused = false; g.hud.closeOverlay?.();
  window.__ev = [];
  const emit = g.sim.emit.bind(g.sim);
  g.sim.emit = (type, data) => { window.__ev.push(type === 'violationCalled' ? `violation:${data.label}` : type); return emit(type, data); };
});
const giveUser = () => page.evaluate(() => {
  const g = window.__app.game, sim = g.sim;
  // Wait for a live possession of the user's team, then control the handler.
  g.fastForward(90, (s) => s.match.phase === 'live' && s.holder() && s.holder().team === s.user.team && !s.holder().inbounding && !s.holder().action);
  const h = sim.holder();
  if (h && h.team === sim.user.team) sim.setUserPlayer(h);
  g.acc = 0;
  window.__ev = [];
});
const evs = () => page.evaluate(() => window.__ev);
await giveUser();
await page.keyboard.down('KeyJ');
await page.waitForTimeout(1500);
const meterShown = await page.evaluate(() => !document.querySelector('.shot-meter').classList.contains('hidden'));
await page.keyboard.up('KeyJ');
await page.waitForTimeout(2500);
let e = await evs();
check('J starts a jumper, shows the meter and releases the shot', e.includes('shotStart') && e.includes('shotRelease') && meterShown, `meter ${meterShown}, events ${[...new Set(e)].slice(0, 12).join(',')}`);
await giveUser();
await page.keyboard.press('KeyK');
await page.waitForTimeout(2500);
e = await evs();
check('K passes to a teammate', e.includes('passStart') && (e.includes('catch') || e.includes('interception')), [...new Set(e)].slice(0, 12).join(','));
const before = await page.evaluate(() => { const sim = window.__app.game.sim; const o = sim.teams[1 - sim.user.team].onCourt[0]; sim.match.possTeam = o.team; sim.giveBall(o, 'catch'); return sim.user.player.id; });
await page.keyboard.press('Tab');
await page.waitForTimeout(1500);
const after = await page.evaluate(() => window.__app.game.sim.user.player.id);
check('Tab switches the controlled defender', after !== before, `${before} -> ${after}`);
const cam0 = await page.evaluate(() => window.__app.game.camera.mode);
await page.keyboard.press('KeyM');
await page.waitForTimeout(1200);
const cam1 = await page.evaluate(() => window.__app.game.camera.mode);
check('M cycles the camera', cam0 !== cam1, `${cam0} -> ${cam1}`);
await page.evaluate(() => window.__app.game.camera.mode = window.__app.settings.data.cameraMode = 'broadcast');
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
const paused = await page.evaluate(() => ({ p: window.__app.game.paused, menu: !!document.querySelector('.overlay.pause') }));
await page.click('[data-a="resume"]');
await page.waitForTimeout(1200);
const resumed = await page.evaluate(() => !window.__app.game.paused);
check('Esc pauses with a menu and Resume continues', paused.p && paused.menu && resumed, JSON.stringify({ paused, resumed }));
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
await page.click('[data-a="quit"]');
await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
check('Quit to Main Menu returns to the menu', true);
await page.evaluate(() => { const t = window.__app.rosters.teams; window.__app.startGame({ mode: 'playnow', teams: [t[0], t[1]], uniforms: ['home', 'away'], userTeam: 0, difficulty: 'pro', quarterMin: 3, seed: 3 }); });
await page.locator('.pregame').first().waitFor({ timeout: 300000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(2000);

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

// ---------------------------------------------------------------- practice
await page.evaluate(() => window.__app.quitToMenu());
await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
await page.click('[data-go="practice"]');
await page.click('[data-def="0"]');
await page.click('[data-a="start"]');
await page.waitForFunction(() => window.__app.game && window.__app.game.running && window.__app.game.sim.user.player, null, { timeout: 300000 });
await page.waitForTimeout(1500);
const vis = await page.evaluate(() => {
  const g = window.__app.game, u = g.sim.user.player;
  return { player: g.views.get(u).root.visible, ball: g.ball.mesh ? g.ball.mesh.visible : true, owner: g.sim.ball.owner === u };
});
await page.keyboard.down('KeyJ');
await page.waitForTimeout(1500);
const pm = await page.evaluate(() => !document.querySelector('.shot-meter').classList.contains('hidden'));
await shot('practice-meter');
await page.keyboard.up('KeyJ');
await page.waitForTimeout(6000);
const plog = await page.evaluate(() => window.__app.game.sim.match.practiceLog.length);
check('Practice: player and ball visible, meter reacts, shot is logged', vis.player && vis.ball && vis.owner && pm && plog >= 1, JSON.stringify({ ...vis, meter: pm, logged: plog }));
await shot('practice-chart');

// ---------------------------------------------------------------- typing in a field never drives the game
await page.evaluate(() => window.__app.quitToMenu());
await page.locator('.main-nav').first().waitFor({ timeout: 120000 });
await page.click('[data-go="builder"]');
await page.click('[data-in="first"]', { clickCount: 3 });
await page.keyboard.type('Wasd');
const typing = await page.evaluate(() => ({ keys: window.__app.input.keys.size, value: document.querySelector('[data-in="first"]').value }));
check('typing in a text field does not register game keys', typing.keys === 0 && typing.value === 'Wasd', JSON.stringify(typing));
await page.click('[data-a="back"]');

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
