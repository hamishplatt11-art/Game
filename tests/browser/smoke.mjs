// Browser smoke test: serves the production build, drives the real game in
// Chromium (WebGL via SwiftShader when no GPU), records console errors and
// screenshots, and checks that a 5v5 match is playable from the menu.
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const exe = process.env.CHROME || findChrome();
function findChrome() {
  const base = '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('chromium not found');
}

const server = await startServer(5199);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const shot = (n) => page.screenshot({ path: path.join(out, `${n}.png`) });
const mode = process.argv[2] || 'playnow';
try {
  await page.goto(server.url + '', { waitUntil: 'load' });
  await page.waitForSelector('.main-nav', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('01-menu');
  if (mode === 'practice') {
    await page.click('[data-go="practice"]');
    await page.click('[data-a="start"]');
  } else if (mode === 'blacktop') {
    await page.click('[data-go="blacktop"]');
    await page.click('[data-a="start"]');
  } else {
    await page.click('[data-go="playnow"]');
    await page.waitForTimeout(300);
    await shot('02-setup');
    await page.click('[data-opt="quarterMin"][data-v="3"]');
    await page.click('[data-a="start"]');
  }
  await page.waitForSelector('.hud', { timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot('03-pregame');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  await shot('04-tip');
  // Play: hold W/D, sprint, shoot, pass.
  const k = page.keyboard;
  await k.down('KeyD'); await page.waitForTimeout(1200); await k.up('KeyD');
  await shot('05-move');
  await k.press('KeyK');
  await page.waitForTimeout(1500);
  await k.down('KeyJ'); await page.waitForTimeout(450); await shot('06-shooting'); await k.up('KeyJ');
  await page.waitForTimeout(1500);
  await shot('07-after-shot');
  for (let i = 0; i < 6; i++) {
    await k.down('KeyW'); await page.waitForTimeout(400); await k.up('KeyW');
    await k.press('ArrowLeft'); await page.waitForTimeout(500);
    await k.down('KeyS'); await page.waitForTimeout(300); await k.up('KeyS');
  }
  await shot('08-play');
  const state = await page.evaluate(() => {
    const g = window.__app.game;
    const m = g.sim.match;
    return { phase: m.phase, q: m.quarter, clock: m.clock, score: m.score, poss: m.possTeam, perf: window.__perf, user: g.sim.user.player && g.sim.user.player.name, t: g.sim.t };
  });
  console.log('STATE', JSON.stringify(state));
} catch (e) {
  console.log('FAILED', e);
  await shot('99-fail');
} finally {
  console.log('ERRORS', errors.length);
  for (const e of errors.slice(0, 20)) console.log(' -', e.slice(0, 400));
  await browser.close();
  await server.close();
}
