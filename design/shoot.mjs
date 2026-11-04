// Design review screenshots. Not part of the factory install.
//   node design/shoot.mjs <output folder> [chrome path]
// Needs `playwright-core` (npm i playwright-core somewhere on the path) and any Chrome or Edge.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const chrome = process.argv[3] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = await import(process.env.PW || 'playwright-core');

const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = p.startsWith('/design/') ? join(root, p) : join(root, 'public', p === '/' ? 'index.html' : p);
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': T[extname(file)] || 'text/plain' }); res.end(b); }
  catch { res.writeHead(404); res.end('no'); }
}).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch({ executablePath: chrome, headless: true });
async function shot(name, url, w, h, { full = true, scale = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', name, e.message));
  await page.goto(base + url);
  await page.waitForSelector('body[data-ready]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, name), fullPage: full });
  await ctx.close();
  console.log('wrote', name);
}

for (const th of ['dark', 'light']) {
  await shot(`dashboard-1920-${th}.png`, `/design/dashboard.html?theme=${th}`, 1920, 1080);
  await shot(`dashboard-390-${th}.png`, `/design/dashboard.html?theme=${th}`, 390, 844, { scale: 2 });
}
await shot('qr-390-1-machine-down-dark.png', '/design/log-demo.html?state=down&theme=dark', 390, 844, { scale: 2 });
await shot('qr-390-2-machine-running-dark.png', '/design/log-demo.html?state=running&theme=dark', 390, 844, { scale: 2 });
await shot('qr-390-3-log-downtime-dark.png', '/design/log-demo.html?state=down&theme=dark&go=downtime', 390, 844, { scale: 2 });
await shot('qr-390-4-log-defects-dark.png', '/design/log-demo.html?state=running&theme=dark&go=defects', 390, 844, { scale: 2 });
await shot('qr-390-1-machine-down-light.png', '/design/log-demo.html?state=down&theme=light', 390, 844, { scale: 2 });
await shot('qr-390-2-machine-running-light.png', '/design/log-demo.html?state=running&theme=light', 390, 844, { scale: 2 });
await shot('qr-1920-machine-down-dark.png', '/design/log-demo.html?state=down&theme=dark', 1920, 1080, { full: false });
await browser.close(); srv.close();
