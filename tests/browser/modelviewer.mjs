// Model viewer checks: front/side/back screenshots, rig validation report,
// and a GLB round trip (export the built-in character, re-import it as an
// "external" model and retarget a clip onto it).
import { launchBrowser } from './launch.mjs';
import { startServer } from './server.mjs';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('tests/browser/out');
fs.mkdirSync(out, { recursive: true });
const server = await startServer(5195);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${server.url}?view=model&q=medium&clip=idle&t=0.4&dist=3.2`);
await page.waitForFunction(() => window.__viewer && window.__viewer.view, null, { timeout: 120000 });
for (const v of ['front', 'side', 'back']) {
  await page.evaluate((v) => window.__viewer.setView(v), v);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, `mv-${v}.png`) });
}
const report = await page.evaluate(() => {
  const r = window.__viewer.validate();
  return { pass: r.pass, checks: r.checks, bad: r.clips.filter((c) => !c.ok) };
});
console.log('RIG', JSON.stringify(report, null, 1));
const rt = await page.evaluate(async () => {
  const buf = await window.__viewer.exportGLB();
  const res = await window.__viewer.importGLB(new Blob([buf]));
  window.__viewer.setClip('jumpShot', 0.55);
  window.__viewer.setView('three');
  return { bytes: buf.byteLength, ...res };
});
console.log('GLB', JSON.stringify(rt));
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(out, 'mv-retarget.png') });
console.log('errors', errs.slice(0, 5));
fs.writeFileSync(path.join(out, 'modelviewer.json'), JSON.stringify({ rig: report, glb: rt, errors: errs }, null, 1));
await browser.close();
await server.close();
process.exit(errs.length ? 1 : 0);
