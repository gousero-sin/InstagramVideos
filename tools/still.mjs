// Renderiza frames isolados (para revisão): node tools/still.mjs <reel-dir> <out-dir> t1 t2 ...
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from './server.mjs';

const [reelDir, outDir, ...times] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ root });
const wss = new WebSocketServer({ port: 0 });
await new Promise((r) => wss.on('listening', r));
let pending = null;
wss.on('connection', (s) => s.on('message', (d) => { pending?.(d); s.send('ok'); }));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('console', (m) => { const t = m.text(); if (!t.includes('GL Driver')) console.log('[page]', t); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const url = `http://127.0.0.1:${server.address().port}/${reelDir}/index.html?render=1&fps=60`;
await page.goto(url);
await page.waitForFunction(() => window.__reel?.ready || window.__reelError, null, { timeout: 120000 });
const err = await page.evaluate(() => window.__reelError);
if (err) { console.error(err); process.exit(1); }
await page.evaluate((p) => window.__reel.connect(p), wss.address().port);
for (const ts of times) {
  const t = parseFloat(ts);
  const frame = Math.round(t * 60);
  const got = new Promise((r) => (pending = r));
  const st = await page.evaluate((f) => window.__reel.renderFrame(f), frame);
  const buf = await got;
  const out = path.join(outDir, `f_${String(frame).padStart(4, '0')}.png`);
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1080x1920', '-i', '-', '-vf', 'vflip', out]);
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
    ff.stdin.end(Buffer.from(buf));
  });
  console.log(`t=${t.toFixed(3)} frame=${frame} render=${st.render.toFixed(0)}ms -> ${out}`);
}
await browser.close();
server.close();
wss.close();
