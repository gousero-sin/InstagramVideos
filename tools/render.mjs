// Renderiza o reel quadro a quadro (determinístico) em Chromium headless e codifica com ffmpeg.
//
//   node tools/render.mjs reels/planilha-para-sistema [--fps 60] [--workers 2] [--chunk 90]
//                         [--from 0] [--to 30] [--force] [--no-final]
//
// Os quadros são renderizados em blocos (chunks) cacheados em render-cache/, então dá para
// re-renderizar só um trecho (--from/--to em segundos + --force) e montar o vídeo de novo.
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from './server.mjs';

const args = process.argv.slice(2);
const reelDir = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const FPS = +opt('fps', 60);
const WORKERS = +opt('workers', 2);
const CHUNK = +opt('chunk', 90);
const W = 1080, H = 1920;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const reelName = path.basename(reelDir);
const cacheDir = path.join(root, 'render-cache', reelName, `${FPS}fps`);
const outDir = path.join(root, reelDir, 'out');
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const DURATION = 30;
const TOTAL = Math.round(DURATION * FPS);
const f0 = Math.max(0, Math.floor(+opt('from', 0) * FPS));
const f1 = Math.min(TOTAL, Math.ceil(+opt('to', DURATION) * FPS));

// blocos fixos (alinhados) para o cache funcionar entre execuções
const chunks = [];
for (let s = 0; s < TOTAL; s += CHUNK) {
  const e = Math.min(TOTAL, s + CHUNK);
  const file = path.join(cacheDir, `chunk_${String(s).padStart(5, '0')}_${String(e).padStart(5, '0')}.mp4`);
  const inRange = e > f0 && s < f1;
  if (!inRange) continue;
  if (fs.existsSync(file) && !flag('force')) continue;
  chunks.push({ s, e, file });
}

function encoder(file) {
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-vf', 'vflip',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '7', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-g', String(FPS), file + '.part.mp4',
  ]);
  ff.stderr.on('data', (d) => process.stderr.write(d));
  return ff;
}

const server = await createServer({ root });
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'] });

let done = 0;
const totalFrames = chunks.reduce((a, c) => a + (c.e - c.s), 0);
const t0 = Date.now();
const queue = [...chunks];

async function worker(id) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on('listening', r));
  let sink = null;
  wss.on('connection', (sock) => {
    sock.on('message', (data) => {
      const ok = sink.stdin.write(Buffer.from(data));
      if (ok) sock.send('ok');
      else sink.stdin.once('drain', () => sock.send('ok'));
    });
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error(`[w${id}] pageerror`, e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('GL Driver') && m.type() === 'error') console.error(`[w${id}]`, t);
  });
  await page.goto(`http://127.0.0.1:${port}/${reelDir}/index.html?render=1&fps=${FPS}`);
  await page.waitForFunction(() => window.__reel?.ready || window.__reelError, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__reelError);
  if (err) throw new Error(err);
  await page.evaluate((p) => window.__reel.connect(p), wss.address().port);
  while (queue.length) {
    const c = queue.shift();
    sink = encoder(c.file);
    const closed = new Promise((res) => sink.on('close', res));
    for (let f = c.s; f < c.e; f++) {
      await page.evaluate((i) => window.__reel.renderFrame(i), f);
      done++;
      if (done % 30 === 0 || done === totalFrames) {
        const el = (Date.now() - t0) / 1000;
        const eta = (el / done) * (totalFrames - done);
        console.log(`[${done}/${totalFrames}] ${(el / done).toFixed(2)} s/quadro · ETA ${Math.round(eta / 60)} min`);
      }
    }
    sink.stdin.end();
    await closed;
    fs.renameSync(c.file + '.part.mp4', c.file);
  }
  await page.close();
  wss.close();
}

if (chunks.length) {
  console.log(`renderizando ${totalFrames} quadros em ${chunks.length} blocos com ${WORKERS} workers @ ${FPS} fps`);
  await Promise.all(Array.from({ length: Math.min(WORKERS, chunks.length) }, (_, i) => worker(i)));
} else console.log('nada a renderizar (cache completo)');
await browser.close();
server.close();

if (flag('no-final')) process.exit(0);

// ── montagem final ──
const all = [];
for (let s = 0; s < TOTAL; s += CHUNK) {
  const e = Math.min(TOTAL, s + CHUNK);
  const file = path.join(cacheDir, `chunk_${String(s).padStart(5, '0')}_${String(e).padStart(5, '0')}.mp4`);
  if (!fs.existsSync(file)) {
    console.log('faltando bloco', file, '— rode sem --from/--to para completar');
    process.exit(0);
  }
  all.push(file);
}
const list = path.join(cacheDir, 'list.txt');
fs.writeFileSync(list, all.map((f) => `file '${f}'`).join('\n'));
const audio = path.join(root, reelDir, 'audio', 'soundtrack.wav');
const run = (a) =>
  new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
  });
const master = path.join(cacheDir, 'master.mp4');
await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master]);
const common = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest'];
const out60 = path.join(outDir, `${reelName}-${FPS}fps.mp4`);
await run(['-i', master, '-i', audio, '-map', '0:v', '-map', '1:a', '-crf', '19.5', '-maxrate', '20M', '-bufsize', '40M', '-r', String(FPS), ...common, out60]);
console.log('ok →', out60);
if (FPS === 60) {
  // versão 30 fps com motion blur real (média de 2 sub-quadros = obturador de 180°)
  const out30 = path.join(outDir, `${reelName}-30fps.mp4`);
  await run(['-i', master, '-i', audio, '-map', '0:v', '-map', '1:a', '-vf', "tmix=frames=2:weights='1 1',framestep=2", '-r', '30', '-crf', '18.5', '-maxrate', '16M', '-bufsize', '32M', ...common, out30]);
  console.log('ok →', out30);
}
