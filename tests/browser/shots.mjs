// Screenshot helper: node tests/browser/shots.mjs "<query>" name [waitMs]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const server = await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const shots = process.argv.slice(2);
for (const spec of shots) {
  const [q, name] = spec.split('@');
  await page.goto(`http://127.0.0.1:5198/?view=model&${q}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
console.log('errors', errs);
await browser.close();
await server.close();
