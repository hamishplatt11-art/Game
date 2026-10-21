// Practice-mode capture: user-controlled jumper with the shot meter mid-rise,
// then the release feedback; plus a Blacktop overview.
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const server = await startServer(5196);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(server.url);
await page.waitForSelector('.main-nav', { timeout: 60000 });
await page.click('[data-go="practice"]');
await page.click('[data-opt], [data-def="1"]').catch(() => {});
await page.click('[data-def="1"]');
await page.click('[data-a="start"]');
await page.waitForSelector('.hud', { timeout: 240000 });
await page.waitForFunction(() => window.__app.game && window.__app.game.running && window.__app.game.sim.user.player, null, { timeout: 60000 });
const blank = `({ moveX: 0, moveZ: 0, sprint: false, stance: false, shootDown: false, shootPressed: false, pass: false, bounce: false, lob: false, icon: null, iconHeld: false, callScreen: false, steal: false, jump: false, handsUp: false, flick: null, rs: null, spin: false, sizeup: false, switchPlayer: false, takeCharge: false, timeout: false, post: false })`;
await page.evaluate((blank) => {
  const g = window.__app.game;
  g.paused = true;
  const B = new Function(`return ${blank}`);
  g.fastForward(0.5, null, () => B());
  // Start the jumper and hold until 80% of the set point.
  g.fastForward(3, (sim) => { const a = sim.user.player.action; return a && a.type === 'shot' && a.t > a.data.tIdeal * 0.8; }, (sim, i) => ({ ...B(), shootPressed: i === 0, shootDown: true }));
  g.renderFrame(0.016, 1); g.hud.update(0.016);
}, blank);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'p-meter.png') });
await page.evaluate((blank) => {
  const g = window.__app.game;
  const B = new Function(`return ${blank}`);
  g.fastForward(1.2, (sim) => sim.ball.state === 'air' && sim.ball.air.t > 0.5, (sim) => {
    const a = sim.user.player.action;
    return { ...B(), shootDown: !!(a && a.type === 'shot' && a.t + 1 / 60 < a.data.tIdeal) };
  });
  g.renderFrame(0.016, 1); g.hud.update(0.016);
}, blank);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'p-feedback.png') });
const fb = await page.evaluate(() => document.querySelector('.shot-feedback')?.innerText);
console.log('feedback:', JSON.stringify(fb));
console.log('errors', errs.slice(0, 10));
await browser.close();
await server.close();
