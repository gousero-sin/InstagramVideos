// Compositor do reel "video-cgi-teste": stills de revisão e render quadro a quadro.
//
//   node tools/vfx.mjs stills --work <dir> --out <dir> --t 6.5,12.7,22.8        (ou --frames 195,380)
//   node tools/vfx.mjs render --work <dir> [--from 0] [--to 37.5] [--workers 2] [--chunk 75] [--force] [--w 1080]
//
// <dir> (--work) tem footage/%05d.jpg (vídeo upscalado) e matte/%05d.png (máscara da pessoa) — gerados por
// reels/video-cgi-teste/prep. Os blocos renderizados ficam em render-cache/video-cgi-teste/ (ffmpeg, sem perdas visíveis).
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from './server.mjs';

const [mode, ...rest] = process.argv.slice(2);
const opt = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };
const flag = (name) => rest.includes(`--${name}`);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const reel = 'reels/video-cgi-teste';
const work = path.resolve(opt('work', ''));
const FPS = 30, TOTAL = 1125;
const Wd = +opt('w', 1080), Hd = Math.round((Wd * 16) / 9);
if (!work || !fs.existsSync(path.join(work, 'footage'))) { console.error('--work <dir> inválido (precisa de footage/ e matte/)'); process.exit(1); }

const server = await createServer({ root, mounts: { '/work': work } });
const port = server.address().port;
// usa o Chromium padrão do Playwright; se a versão não bater (ambientes com navegador pré-instalado), cai para o que existir em /opt/pw-browsers
const launchOpts = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'] };
if (!fs.existsSync(chromium.executablePath())) {
  const base = '/opt/pw-browsers';
  const cand = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).map((d) => path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')) : [];
  const found = process.env.CHROMIUM_PATH || cand.find((f) => fs.existsSync(f));
  if (found) launchOpts.executablePath = found;
}
const browser = await chromium.launch(launchOpts);

async function openPage(id, sink, br = browser) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on('listening', r));
  wss.on('connection', (sock) => sock.on('message', async (data) => { await sink(Buffer.from(data)); sock.send('ok'); }));
  const page = await br.newPage({ viewport: { width: Wd, height: Hd } });
  page.on('pageerror', (e) => console.error(`[w${id}] pageerror`, e.message));
  page.on('console', (m) => { const t = m.text(); if (!t.includes('GL Driver') && !t.includes('GPU stall')) console.log(`[w${id}]`, t); });
  await page.goto(`http://127.0.0.1:${port}/${reel}/index.html?render=1&w=${Wd}`);
  await page.waitForFunction(() => window.__vfx?.ready || window.__vfxError, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__vfxError);
  if (err) throw new Error(err);
  await page.evaluate((p) => window.__vfx.connect(p), wss.address().port);
  return { page, wss };
}

if (mode === 'stills') {
  const out = path.resolve(opt('out', 'stills'));
  fs.mkdirSync(out, { recursive: true });
  const frames = opt('frames', null) ? opt('frames').split(',').map(Number) : opt('t').split(',').map((s) => Math.round(parseFloat(s) * FPS));
  let cur = null;
  const { page, wss } = await openPage(0, async (buf) => { cur?.(buf); });
  for (const f of frames) {
    const got = new Promise((r) => (cur = r));
    const t0 = Date.now();
    await page.evaluate((i) => window.__vfx.renderFrame(i), f);
    const buf = await got;
    const file = path.join(out, `f_${String(f).padStart(4, '0')}.jpg`);
    await new Promise((res, rej) => {
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${Wd}x${Hd}`, '-i', '-', '-vf', 'vflip', '-q:v', '2', file]);
      ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
      ff.stdin.end(buf);
    });
    if (flag('probe')) for (const [w, x, y] of [['world', 540, 960], ['world', 100, 1700], ['world', 300, 300], ['comp', 540, 960], ['comp', 100, 1700]]) console.log('probe', w, x, y, JSON.stringify(await page.evaluate(([a, b, c]) => window.__vfx.probe(a, b, c), [w, x, y])));
    console.log(`frame ${f} (t=${(f / FPS).toFixed(2)}s) ${((Date.now() - t0) / 1000).toFixed(1)}s → ${file}`);
  }
  await browser.close(); server.close(); wss.close();
  process.exit(0);
}

if (mode === 'render') {
  const WORKERS = +opt('workers', 2), CHUNK = +opt('chunk', 75);
  const f0 = Math.max(0, Math.floor(+opt('from', 0) * FPS)), f1 = Math.min(TOTAL, Math.ceil(+opt('to', TOTAL / FPS) * FPS));
  const cacheDir = path.join(root, 'render-cache', 'video-cgi-teste', `w${Wd}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const chunkFile = (s, e) => path.join(cacheDir, `chunk_${String(s).padStart(5, '0')}_${String(e).padStart(5, '0')}.mp4`);
  const queue = [];
  for (let s = 0; s < TOTAL; s += CHUNK) {
    const e = Math.min(TOTAL, s + CHUNK);
    if (e <= f0 || s >= f1) continue;
    if (fs.existsSync(chunkFile(s, e)) && !flag('force')) continue;
    queue.push({ s, e, file: chunkFile(s, e) });
  }
  const totalFrames = queue.reduce((a, c) => a + (c.e - c.s), 0);
  let done = 0; const t0 = Date.now();
  async function worker(id) {
    // Cada bloco roda num navegador/página NOVOS: o canvas 2D acelerado do Chromium chegava a manter o conteúdo do último
    // quadro do bloco anterior (um orbe "fantasma" congelado). Sem histórico entre blocos, o render é determinístico.
    while (queue.length) {
      const c = queue.shift();
      let sink = null;
      const own = await chromium.launch(launchOpts);
      const { page, wss } = await openPage(id, async (buf) => { if (!sink.stdin.write(buf)) await new Promise((r) => sink.stdin.once('drain', r)); }, own);
      sink = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${Wd}x${Hd}`, '-r', String(FPS), '-i', '-', '-vf', 'vflip',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-g', '30', c.file + '.part.mp4']);
      sink.stderr.on('data', (d) => process.stderr.write(d));
      const closed = new Promise((res) => sink.on('close', res));
      for (let f = c.s; f < c.e; f++) {
        await page.evaluate((i) => window.__vfx.renderFrame(i), f);
        done++;
        if (done % 15 === 0 || done === totalFrames) { const el = (Date.now() - t0) / 1000; console.log(`[${done}/${totalFrames}] ${(el / done).toFixed(2)} s/quadro · ETA ${Math.round((el / done) * (totalFrames - done) / 60)} min`); }
      }
      sink.stdin.end(); await closed;
      fs.renameSync(c.file + '.part.mp4', c.file);
      await page.close(); wss.close(); await own.close();
    }
  }
  if (queue.length) { console.log(`renderizando ${totalFrames} quadros (${queue.length} blocos) com ${WORKERS} workers`); await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, (_, i) => worker(i))); }
  else console.log('nada a renderizar (cache completo)');
  await browser.close(); server.close();
  process.exit(0);
}
if (mode === 'final') {
  // junta os blocos renderizados e o áudio:  node tools/vfx.mjs final --work <dir> --audio mix.wav --out video.mp4 [--crf 17]
  const cacheDir = path.join(root, 'render-cache', 'video-cgi-teste', `w${Wd}`);
  const files = fs.readdirSync(cacheDir).filter((f) => /^chunk_\d+_\d+\.mp4$/.test(f)).sort();
  const covered = files.reduce((a, f) => { const m = f.match(/chunk_(\d+)_(\d+)/); return a + (+m[2] - +m[1]); }, 0);
  if (covered !== TOTAL) { console.error(`blocos incompletos: ${covered}/${TOTAL} quadros`); process.exit(1); }
  const list = path.join(cacheDir, 'list.txt');
  fs.writeFileSync(list, files.map((f) => `file '${path.join(cacheDir, f)}'`).join('\n'));
  const out = path.resolve(opt('out', 'out.mp4'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const audio = opt('audio', null);
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...(audio ? ['-i', audio] : []),
    '-map', '0:v', ...(audio ? ['-map', '1:a'] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', opt('crf', '18'), '-maxrate', opt('maxrate', '10M'), '-bufsize', opt('bufsize', '20M'), '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-r', String(FPS), '-movflags', '+faststart',
    ...(audio ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest'] : []), out];
  await new Promise((res, rej) => { const p = spawn('ffmpeg', args, { stdio: 'inherit' }); p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))); });
  console.log('ok →', out);
  await browser.close(); server.close();
  process.exit(0);
}
console.error('modo: stills | render | final');
process.exit(1);
