// node reels/dimensao-da-agua/studio/render.mjs <out.png>  → plate 2160×3840
import { chromium } from 'playwright';
import path from 'node:path';
import { createServer } from '../../../tools/server.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const server = await createServer({ root });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
page.on('console', (m) => { const t = m.text(); if (!t.includes('GL Driver')) console.log('[page]', t); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/reels/dimensao-da-agua/studio/index.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
await page.locator('canvas').screenshot({ path: process.argv[2] });
await browser.close(); server.close();
