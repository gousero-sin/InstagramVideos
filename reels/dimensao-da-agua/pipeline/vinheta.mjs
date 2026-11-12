// Renderiza a vinheta (@gouserodev, cena final do reel "planilha-para-sistema" sem o CTA) com motion blur de 3 sub-quadros.
//   node reels/dimensao-da-agua/pipeline/vinheta.mjs <dir-de-saida>   → PNGs 1080×1920 a 72 fps (26,02 s → 30,0 s)
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from '../../../tools/server.mjs';
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const server = await createServer({ root });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/reels/planilha-para-sistema/index.html?render=1&fps=72&vinheta=1`);
await page.waitForFunction(() => window.__reel?.ready || window.__reelError, null, { timeout: 180000 });
const T0 = 26.02, T1 = 30.0, FPS = 72; const n = Math.round((T1 - T0) * FPS);
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.__reel.renderAt(t), T0 + i / FPS);
  await page.locator('canvas').screenshot({ path: path.join(out, `v_${String(i).padStart(4, '0')}.png`) });
  if (i % 36 === 0) console.log(`${i}/${n}`);
}
await browser.close(); server.close();
