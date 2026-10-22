// Portable browser launcher for the Playwright scripts (macOS, Linux, Windows).
// Order: $CHROME, installed Google Chrome / Chromium / Edge, then the
// Playwright browser cache. Uses the real GPU unless the machine has none
// (or SOFTWARE_GL=1), in which case WebGL runs through SwiftShader.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = os.homedir();
  const fixed = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  }[process.platform] || [];
  for (const p of fixed) if (fs.existsSync(p)) return p;
  // Playwright caches (npx playwright install chromium).
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(home, 'Library/Caches/ms-playwright'), path.join(home, '.cache/ms-playwright'), path.join(home, 'AppData/Local/ms-playwright')].filter(Boolean);
  const rels = ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-win/chrome.exe'];
  for (const base of caches) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base).filter((n) => n.startsWith('chromium')).sort().reverse()) {
      for (const rel of rels) {
        const p = path.join(base, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('No Chrome/Chromium found. Install Google Chrome, or run `npx playwright install chromium`, or set CHROME=/path/to/chrome');
}

/** True when this machine almost certainly has no GPU (CI containers). */
export function needsSoftwareGL() {
  if (process.env.SOFTWARE_GL) return process.env.SOFTWARE_GL !== '0';
  if (process.platform === 'darwin' || process.platform === 'win32') return false;
  return !fs.existsSync('/dev/dri');
}

export async function launchBrowser({ extraArgs = [], ...extra } = {}) {
  const executablePath = findChrome();
  const sw = needsSoftwareGL();
  const args = sw
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const headless = process.env.HEADED ? false : true;
  // Headless Chrome on macOS still uses the Metal GPU through ANGLE.
  const browser = await chromium.launch({ executablePath, headless, args: [...args, ...extraArgs], ...extra });
  browser.__info = { executablePath, softwareGL: sw };
  return browser;
}
