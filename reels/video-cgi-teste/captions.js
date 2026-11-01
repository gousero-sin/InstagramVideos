import * as THREE from 'three';
import { T, clamp, easeOutBack, sstep } from './timeline.js';

// Legenda cinética "atrás da cabeça": desenhada em canvas 2D (premultiplicado) e composta ENTRE o fundo
// e a pessoa — a máscara (matte) cobre as letras, dando a profundidade.

export function snapshotTexture() {
  const t = new THREE.Texture();
  t.flipY = false; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace;
  return t;
}
export async function commitSnapshot(tex, canvas) {
  const bmp = await createImageBitmap(canvas, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
  tex.image?.close?.();
  tex.image = bmp;
  tex.needsUpdate = true;
}

const GREEN = '#39ff14';
const WHITE = '#f4f7f5';

export class Captions {
  constructor(W, H, words) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }); // canvas em CPU: sem recursos de GPU reaproveitados entre quadros
    this.tex = snapshotTexture();
    this.chunks = this.build(words);
  }

  // Agrupa as palavras faladas (5.7–10.1 s) em blocos curtos de 1–2 linhas, na cadência da fala.
  build(words) {
    const win = words.filter((w) => w.s >= 5.6 && w.s < 10.2);
    const up = (s) => s.toUpperCase();
    const find = (s, n = 0) => win.filter((w) => up(w.w.replace(/[.,]/g, '')) === up(s))[n];
    const mk = (lines) => lines.map((ln) => ln.map(([txt, nth]) => { const w = find(txt, nth || 0); return { txt: up(w.w), s: w.s, e: w.e }; }));
    const defs = [
      mk([[['Aqui'], ['atrás', 0]]]),
      mk([[['tem'], ['uma']], [['legenda']]]),
      mk([[['com'], ['tudo'], ['que']]]),
      mk([[['eu'], ['tô']], [['falando']]]),
      mk([[['atrás', 1], ['da']]]),
      mk([[['minha']], [['cabeça']]]),
    ];
    return defs.map((lines, i) => {
      const first = lines[0][0].s;
      const next = defs[i + 1] ? defs[i + 1][0][0].s : null;
      return { lines, s: first, e: next !== null ? next : T.capOut };
    });
  }

  draw(t, head) {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    if (t < T.capIn || t > T.capOut + 0.1) return false;
    let ch = null;
    for (const c of this.chunks) if (t >= c.s && t < c.e) ch = c;
    if (!ch && t >= this.chunks[this.chunks.length - 1].s) ch = this.chunks[this.chunks.length - 1];
    if (!ch) return false;

    const outA = 1 - sstep(T.capOut - 0.35, T.capOut + 0.05, t);
    const fontFam = '"Archivo C"';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // tamanho: o maior que cabe na largura útil (mesma altura para as linhas do bloco)
    const measure = (txt, size) => { ctx.font = `900 ${size}px ${fontFam}`; return ctx.measureText(txt).width; };
    let size = 300;
    for (const ln of ch.lines) {
      const txt = ln.map((w) => w.txt).join(' ');
      size = Math.min(size, (size * W * 0.88) / measure(txt, size));
    }
    size = Math.min(size, ch.lines.length === 1 ? 330 : 300);
    const lineH = size * 0.80; // altura útil das maiúsculas (cap height ~0.72em)
    const gap = size * 0.10;

    // posição: ancorada no topo da cabeça (com parallax leve) — a linha de baixo "afunda" atrás do cabelo
    const headX = head.top[0] * W;
    const headTopY = (1 - head.top[1]) * H;
    const cx = W / 2 + (headX - W / 2) * 0.12;
    const nL = ch.lines.length;
    const dip = 0.34; // fração da altura da última linha que fica atrás da cabeça
    const lastBase = headTopY + lineH * dip; // linha de base da última linha
    for (let li = 0; li < nL; li++) {
      const base = lastBase - (nL - 1 - li) * (lineH + gap);
      const ln = ch.lines[li];
      const txt = ln.map((w) => w.txt).join(' ');
      const total = measure(txt, size);
      let x = cx - total / 2;
      const sp = measure(' ', size);
      for (const w of ln) {
        const ww = measure(w.txt, size);
        const age = t - w.s;
        if (age >= 0) {
          const p = clamp(age / 0.24);
          const sc = 0.62 + 0.38 * easeOutBack(p, 2.2);
          const al = clamp(age / 0.07) * outA;
          const active = t < w.e + 0.05 && t >= w.s;
          this.word(w.txt, x + ww / 2, base - lineH * 0.5, size, sc, al, active, age);
        }
        x += ww + sp;
      }
    }
    return true;
  }

  // sobe um INSTANTÂNEO do canvas (bitmap premultiplicado). CanvasTexture reaproveitava textura antiga do Chromium
  // quando o canvas ficava vazio, e conteúdo de quadros anteriores "vazava" nos seguintes.
  async commit() { await commitSnapshot(this.tex, this.canvas); }

  // desenha a palavra num canvas temporário e compõe com UMA opacidade (a extrusão não "acumula" no fade)
  word(txt, cx, cy, size, sc, al, active, age) {
    const { ctx } = this;
    const tmp = this.tmp || (this.tmp = document.createElement('canvas'));
    const tc = tmp.getContext('2d', { willReadFrequently: true });
    tc.font = `900 ${size}px "Archivo C"`;
    const w0 = Math.ceil(tc.measureText(txt).width + size * 0.7), h0 = Math.ceil(size * 1.6);
    if (tmp.width !== w0 || tmp.height !== h0) { tmp.width = w0; tmp.height = h0; }
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, w0, h0);
    tc.translate(w0 / 2, h0 / 2);
    tc.font = `900 ${size}px "Archivo C"`;
    tc.textAlign = 'center';
    const by = size * 0.36; // centraliza as maiúsculas verticalmente
    // extrusão (profundidade 3D)
    const depth = Math.round(size * 0.075);
    for (let i = depth; i >= 1; i--) {
      const k = i / depth;
      tc.fillStyle = `rgb(${Math.round(6 + 10 * (1 - k))},${Math.round(34 + 70 * (1 - k))},${Math.round(8 + 18 * (1 - k))})`;
      tc.fillText(txt, i * 0.55, by + i * 1.0);
    }
    if (active) { tc.shadowColor = 'rgba(57,255,20,0.9)'; tc.shadowBlur = size * 0.22; }
    tc.fillStyle = active ? GREEN : WHITE;
    tc.fillText(txt, 0, by);
    tc.shadowBlur = 0;
    // faixa de luz no topo das letras
    const g = tc.createLinearGradient(0, -size * 0.4, 0, size * 0.4);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    tc.fillStyle = g;
    tc.fillText(txt, 0, by);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.globalAlpha = al;
    ctx.drawImage(tmp, -w0 / 2, -h0 / 2);
    ctx.restore();
  }
}
