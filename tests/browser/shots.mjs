// Screenshot helper: node tests/browser/shots.mjs "<query>" name [waitMs]
import { launchBrowser } from './launch.mjs';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const server = await startServer(5198);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const shots = process.argv.slice(2);
for (const spec of shots) {
  const [q, name] = spec.split('@');
  await page.goto(`${server.url}?view=model&${q}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
console.log('errors', errs);
await browser.close();
await server.close();
