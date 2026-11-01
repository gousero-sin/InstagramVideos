import * as THREE from 'three';
import { snapshotTexture, commitSnapshot } from './captions.js';
import { T, clamp, sstep, mix, easeOutCubic, easeInCubic, easeOutBack, easeInOut, easeOutExpo } from './timeline.js';

// Camada de efeitos de MÁGICA (aditiva, na frente da pessoa), desenhada em canvas 2D.
// Fases:  A) 12.2–16.0 faísca/orbe na ponta do dedo + círculo rúnico   B) 16.0–17.7 "puxa" a energia (rastro)
//         C) 17.7–22.4 concentra (partículas convergem, relâmpagos, orbe cresce)   D) 22.4–22.8 lança na tela
const fr = (x) => x - Math.floor(x);
const rnd = (n) => fr(Math.sin(n * 127.1 + 311.7) * 43758.5453);

const COL = {
  cyan: [90, 200, 255], violet: [150, 90, 255], magenta: [255, 80, 220], white: [255, 255, 255], ice: [190, 235, 255],
};
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1)})`;
const mixc = (a, b, k) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];

export class FgLayer {
  constructor(W, H, track) {
    this.W = W; this.H = H; this.track = track;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tex = snapshotTexture();
    this.last = null;
  }

  // posição suavizada (janela) de um campo da mão, em px (y para baixo)
  handAt(t, win = 0.12) {
    const n = 5; const acc = { tip: [0, 0], cen: [0, 0], palm: [0, 0], size: 0, v: 0, dir: [0, 0], open: 0 };
    for (let s = 0; s < n; s++) {
      const h = this.track.at(t + (s / (n - 1) - 0.5) * win).hand;
      for (const k of ['tip', 'cen', 'palm', 'dir']) { acc[k][0] += h[k][0] / n; acc[k][1] += h[k][1] / n; }
      acc.size += h.size / n; acc.v += h.v / n; acc.open += h.open / n;
    }
    return acc;
  }

  // parâmetros do orbe mágico no tempo t  → { x, y (px, y p/ baixo), R, I, col, phase, k... }
  orbAt(t) {
    const { W, H } = this;
    const h = this.handAt(t);
    const px = (p) => [p[0] * W, (1 - p[1]) * H];
    const tip = px(h.tip), cen = px(h.cen), palm = px(h.palm);
    const d = [h.tip[0] - h.palm[0], h.tip[1] - h.palm[1]]; const dl = Math.hypot(d[0], d[1]) || 1;
    const up = [d[0] / dl * W, -d[1] / dl * H];
    // âncora: ponta do dedo (A) → centro da mão (B/C)
    const aA = [tip[0] + up[0] * 0.07, tip[1] + up[1] * 0.07];
    const aC = [palm[0] + (cen[0] - palm[0]) * 1.2, palm[1] + (cen[1] - palm[1]) * 1.2];
    const kA = 1 - sstep(15.8, 16.35, t);
    let x = mix(aC[0], aA[0], kA), y = mix(aC[1], aA[1], kA);

    let R = 0, I = 0, col = COL.cyan, phase = 'none';
    const clampIn = (m) => { x = clamp(x, m, this.W - m); y = clamp(y, m, this.H - m); };
    if (t >= T.m1In && t < T.m1Out) {
      phase = 'A';
      const g = (t - T.m1In) / 0.55;
      R = 84 * easeOutBack(g, 2.4) * (1 + 0.06 * Math.sin(t * 11)) * (1 - sstep(15.75, 16.15, t) * 0.35);
      I = 1.0 * clamp(g * 3);
      col = mixc(COL.cyan, COL.violet, sstep(13.5, 15.8, t) * 0.5);
    }
    if (t >= T.m1Out - 0.35 && t < T.chargeIn) {
      phase = 'B';
      const a = sstep(T.m1Out - 0.35, T.m1Out + 0.2, t);
      R = mix(R > 0 ? R : 50, 52 + 5 * Math.sin(t * 9), a);
      I = 0.85;
      col = mixc(COL.violet, COL.cyan, 0.25);
      const aB = [palm[0] + (cen[0] - palm[0]) * 0.3, palm[1] + (cen[1] - palm[1]) * 0.3];
      const kb = sstep(15.8, 16.3, t);
      x = mix(x, aB[0], kb); y = mix(y, aB[1], kb);
      clampIn(R * 1.25);
    }
    if (t >= T.chargeIn - 0.05 && t < T.throwT) {
      phase = 'C';
      const c = clamp((t - T.chargeIn) / (21.2 - T.chargeIn));
      R = 70 + 108 * easeInOut(Math.pow(c, 0.7));
      R += sstep(21.2, T.throwT, t) * 30;
      R *= 1 + 0.045 * Math.sin(t * 17) * (0.3 + c);
      I = mix(0.95, 2.1, c);
      clampIn(R * 1.0);
      col = mixc(mixc(COL.cyan, COL.violet, clamp(c * 1.4)), COL.magenta, sstep(0.55, 1.0, c) * 0.55);
    }
    let throwK = 0;
    if (t >= T.throwT && t < T.impactT + 0.03) {
      phase = 'D';
      throwK = clamp((t - T.throwT) / (T.impactT - T.throwT));
      const e = easeInCubic(throwK);
      x = mix(x, this.W * 0.5, e); y = mix(y, this.H * 0.52, e);
      R = mix(210, 2600, Math.pow(throwK, 3.4));
      I = 2.4;
      col = mixc(COL.violet, COL.white, e * 0.5);
    }
    return { x, y, R, I, col, phase, throwK, hand: h };
  }

  glow(x, y, r, c, a) {
    const g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a)); g.addColorStop(0.35, rgba(c, a * 0.38)); g.addColorStop(1, rgba(c, 0));
    this.ctx.fillStyle = g; this.ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  dot(x, y, r, c, a) {
    const g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(COL.white, a)); g.addColorStop(0.25, rgba(c, a * 0.8)); g.addColorStop(1, rgba(c, 0));
    this.ctx.fillStyle = g; this.ctx.beginPath(); this.ctx.arc(x, y, r, 0, 6.2832); this.ctx.fill();
  }

  // ───────── desenho do orbe de plasma ─────────
  orb(o, t) {
    const { ctx } = this;
    const { x, y, R, I, col } = o;
    if (R < 2) return;
    const Ie = Math.min(I, 1.6);
    this.glow(x, y, R * 3.0, col, 0.15 * Ie);
    this.glow(x, y, R * 1.65, col, 0.30 * Ie);
    // corpo: disco de plasma (mais denso perto da borda) + filamentos girando
    const body = ctx.createRadialGradient(x, y, R * 0.15, x, y, R);
    body.addColorStop(0, rgba(col, 0.10 * Ie)); body.addColorStop(0.7, rgba(col, 0.34 * Ie)); body.addColorStop(0.94, rgba(mixc(col, COL.ice, 0.35), 0.62 * Ie)); body.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.2832); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round';
    const nF = 30;
    for (let k = 0; k < nF; k++) {
      const s = rnd(k + 3.1);
      const sp = (0.9 + s * 2.4) * (k % 2 ? 1 : -1);
      const a0 = k * 6.2832 / nF + t * sp;
      const rr = R * (0.30 + 0.66 * rnd(k * 1.7 + 9));
      const len = 0.6 + 1.2 * rnd(k * 2.3 + 5);
      ctx.lineWidth = Math.max(1.2, R * (0.014 + 0.034 * rnd(k + 20)));
      ctx.strokeStyle = rgba(mixc(col, COL.ice, rnd(k + 40) * 0.7), (0.32 + 0.4 * rnd(k + 8)) * Math.min(1.3, Ie));
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * (0.55 + 0.4 * rnd(k + 60)), a0 * 0.35, a0, a0 + len); ctx.stroke();
    }
    // borda luminosa da esfera
    ctx.lineWidth = Math.max(1.5, R * 0.035); ctx.strokeStyle = rgba(mixc(col, COL.white, 0.45), 0.55 * Ie);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.93, 0, 6.2832); ctx.stroke();
    ctx.restore();
    this.glow(x, y, R * 0.72, mixc(col, COL.white, 0.25), 0.55 * Ie);
    this.glow(x, y, R * 0.36, COL.white, 0.95);
    // brilho em cruz (fino) — só para dar "estrela"
    ctx.save(); ctx.translate(x, y);
    for (const [ang, kk] of [[0, 1.0], [Math.PI / 2, 0.72]]) {
      ctx.save(); ctx.rotate(ang + 0.2 * Math.sin(t * 0.9));
      const L = R * 2.1 * kk * Math.min(1.3, 0.6 + Ie * 0.4);
      const g = ctx.createLinearGradient(-L, 0, L, 0);
      g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(COL.white, 0.5 * Math.min(1, Ie))); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(-L, -R * 0.018, L * 2, R * 0.036);
      ctx.restore();
    }
    ctx.restore();
  }

  // círculo mágico (rúnico) inclinado em 3D
  runes(x, y, r, tilt, t, col, a) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.28); ctx.scale(1, tilt);
    ctx.lineCap = 'round';
    const ring = (rr, w, al, dash) => { ctx.lineWidth = w; ctx.strokeStyle = rgba(col, al * a); ctx.setLineDash(dash || []); ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); };
    ring(r, 3.2, 0.95); ring(r * 0.93, 1.4, 0.7); ring(r * 0.66, 2, 0.8, [r * 0.12, r * 0.07]);
    // marcas
    ctx.save(); ctx.rotate(t * 0.55);
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(COL.white, 0.85 * a);
    for (let k = 0; k < 48; k++) { const an = k * 6.2832 / 48; const l = k % 4 === 0 ? 0.11 : 0.05; ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * 0.93, Math.sin(an) * r * 0.93); ctx.lineTo(Math.cos(an) * r * (0.93 - l), Math.sin(an) * r * (0.93 - l)); ctx.stroke(); }
    ctx.restore();
    // hexagrama contra-rotativo
    ctx.save(); ctx.rotate(-t * 0.9); ctx.lineWidth = 2.2; ctx.strokeStyle = rgba(col, 0.9 * a);
    for (let s = 0; s < 2; s++) { ctx.beginPath(); for (let k = 0; k < 3; k++) { const an = s * Math.PI / 3 + k * 2.0944; ctx.lineTo(Math.cos(an) * r * 0.66, Math.sin(an) * r * 0.66); } ctx.closePath(); ctx.stroke(); }
    for (let k = 0; k < 6; k++) { const an = k * 1.0472; this.dot(Math.cos(an) * r * 0.66, Math.sin(an) * r * 0.66, 9, col, 0.9 * a); }
    ctx.restore();
    ctx.restore();
  }

  // faíscas orbitando
  orbitSparks(o, t, n, spread) {
    const { ctx } = this;
    for (let k = 0; k < n; k++) {
      const s = rnd(k * 3.7 + 1), s2 = rnd(k * 7.1 + 2);
      const rad = o.R * (1.25 + spread * s);
      const om = (1.6 + 2.8 * s2) * (k % 2 ? 1 : -1);
      const tilt = 0.35 + 0.5 * rnd(k + 90), rot = rnd(k + 11) * 6.28;
      const pos = (tt) => { const an = tt * om + s * 40; const px = Math.cos(an) * rad, py = Math.sin(an) * rad * tilt; return [o.x + px * Math.cos(rot) - py * Math.sin(rot), o.y + px * Math.sin(rot) + py * Math.cos(rot)]; };
      const fl = 0.55 + 0.45 * Math.sin(t * (8 + 9 * s) + k);
      for (let j = 7; j >= 0; j--) {
        const p = pos(t - j * 0.011); const aa = (1 - j / 8) * fl;
        this.dot(p[0], p[1], (2.6 + 3.2 * s) * (1 - j * 0.09), o.col, 0.9 * aa * Math.min(1.2, o.I));
      }
    }
  }

  // partículas que convergem (puxa/concentra)
  inflow(o, t, n, k0, reach) {
    const { ctx } = this;
    for (let k = 0; k < n; k++) {
      const life = 0.85 + 0.9 * rnd(k * 1.3 + 4);
      const ph = fr(t / life + rnd(k * 9.1));
      const cyc = Math.floor(t / life + rnd(k * 9.1));
      const a0 = rnd(k * 5.3 + cyc * 17.7) * 6.2832;
      const r0 = (reach * 0.35 + reach * 0.65 * rnd(k * 2.9 + cyc * 3.3));
      const pos = (p) => { const e = Math.pow(p, 1.9); const rr = mix(r0, o.R * 0.5, e); const an = a0 + 2.6 * e; return [o.x + Math.cos(an) * rr, o.y + Math.sin(an) * rr * 0.82]; };
      const p = pos(ph);
      const br = Math.sin(clamp(ph) * 3.1416) * 0.9 + 0.1;
      for (let j = 0; j < 6; j++) {
        const q = pos(Math.max(0, ph - j * 0.018));
        this.dot(q[0], q[1], (3.4 - j * 0.4) * (0.7 + 0.8 * rnd(k)), o.col, 0.85 * br * (1 - j / 7) * k0);
      }
    }
  }

  // relâmpago entre pontos
  bolt(x0, y0, x1, y1, seed, w, col, a) {
    const { ctx } = this;
    const n = 9; const dx = x1 - x0, dy = y1 - y0; const L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L;
    const pts = [[x0, y0]];
    for (let i = 1; i < n; i++) { const f = i / n; const j = (rnd(seed * 13.3 + i) - 0.5) * L * 0.22 * Math.sin(f * 3.1416 + 0.2); pts.push([x0 + dx * f + nx * j, y0 + dy * f + ny * j]); }
    pts.push([x1, y1]);
    for (const [lw, al, c] of [[w * 4, a * 0.25, col], [w * 1.6, a * 0.7, mixc(col, COL.white, 0.5)], [w * 0.7, a, COL.white]]) {
      ctx.lineWidth = lw; ctx.strokeStyle = rgba(c, al); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    }
  }

  draw(t, S) {
    const { ctx, W, H } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    S.lightA = [0.5, 0.5, 200, 0];
    const o = this.orbAt(t);
    this.last = o;
    S.orb = o;
    if (o.phase !== 'none' && o.R > 1) {
      const u = [o.x / W, 1 - o.y / H];
      if (o.phase === 'A') {
        // círculo rúnico flutuando acima do dedo + faíscas
        const a = sstep(12.35, 12.9, t) * (1 - sstep(15.55, 16.0, t));
        if (a > 0.01) this.runes(o.x, o.y + 6, 138 * (0.8 + 0.2 * a), 0.36, t, o.col, a * 0.9);
        this.orbitSparks(o, t, 16, 1.4);
        // faísca de ignição
        const ig = 1 - sstep(12.18, 12.55, t);
        if (ig > 0.01) for (let k = 0; k < 14; k++) { const an = rnd(k) * 6.28; const d = (t - 12.18 + 0.02) * (400 + 600 * rnd(k + 2)); this.dot(o.x + Math.cos(an) * d, o.y + Math.sin(an) * d, 4, o.col, ig); }
      }
      if (o.phase === 'B') {
        // rastro de energia sendo "puxada" pela varrida da mão
        const prev = (dt) => this.orbAt(t - dt);
        for (let j = 1; j <= 14; j++) {
          const p = prev(j * 0.022);
          const f = 1 - j / 15;
          this.dot(p.x, p.y, o.R * (0.45 + f * 0.55), o.col, 0.30 * f);
          for (let q = 0; q < 3; q++) this.dot(p.x + (rnd(j * 3 + q) - 0.5) * 70, p.y + (rnd(j * 5 + q) - 0.5) * 70, 3 + 3 * rnd(j + q), COL.ice, 0.8 * f);
        }
        this.inflow(o, t, 26, sstep(T.pullIn + 0.2, T.chargeIn, t), 520);
      }
      if (o.phase === 'C') {
        const c = clamp((t - T.chargeIn) / (T.throwT - T.chargeIn));
        this.inflow(o, t, 90, clamp(c * 4) * 1.1, 760);
        // anéis que contraem (concentrando)
        for (let k = 0; k < 3; k++) {
          const ph = fr(t * 1.35 + k / 3);
          const rr = o.R * mix(4.6, 1.0, easeOutCubic(ph));
          ctx.lineWidth = 2.5 + 4 * ph; ctx.strokeStyle = rgba(o.col, 0.7 * Math.sin(ph * 3.1416) * Math.min(1, c * 3));
          ctx.beginPath(); ctx.ellipse(o.x, o.y, rr, rr * 0.9, 0, 0, 6.2832); ctx.stroke();
        }
        // relâmpagos do orbe até os dedos / ao redor
        const nb = Math.floor(2 + c * 7);
        const tk = Math.floor(t * 22);
        for (let k = 0; k < nb; k++) {
          const sd = tk * 31 + k * 7;
          const an = rnd(sd) * 6.2832; const dist = o.R * (1.5 + 1.8 * rnd(sd + 1));
          if (rnd(sd + 5) > 0.25 + c * 0.5) continue;
          this.bolt(o.x + Math.cos(an) * o.R * 0.5, o.y + Math.sin(an) * o.R * 0.5, o.x + Math.cos(an) * dist, o.y + Math.sin(an) * dist * 0.9, sd, 2.2, o.col, 0.9);
        }
        this.orbitSparks(o, t, 26, 0.9 + c * 0.6);
        if (c > 0.15) this.runes(o.x, o.y, o.R * 2.35, 0.34, t * 1.3, o.col, 0.55 * clamp(c * 2) * (1 - sstep(0.93, 1.0, c)));
      }
      if (o.phase === 'D') {
        const k = o.throwK;
        // linhas de velocidade saindo do orbe
        const n = 70;
        for (let i = 0; i < n; i++) {
          const an = rnd(i * 2.1) * 6.2832, r0 = o.R * (0.6 + 0.8 * rnd(i + 3)), len = (300 + 900 * rnd(i + 9)) * k;
          const g = ctx.createLinearGradient(o.x + Math.cos(an) * r0, o.y + Math.sin(an) * r0, o.x + Math.cos(an) * (r0 + len), o.y + Math.sin(an) * (r0 + len));
          g.addColorStop(0, rgba(COL.white, 0.0)); g.addColorStop(0.2, rgba(o.col, 0.55 * k)); g.addColorStop(1, rgba(COL.white, 0));
          ctx.strokeStyle = g; ctx.lineWidth = 1.5 + 3 * rnd(i + 21);
          ctx.beginPath(); ctx.moveTo(o.x + Math.cos(an) * r0, o.y + Math.sin(an) * r0); ctx.lineTo(o.x + Math.cos(an) * (r0 + len), o.y + Math.sin(an) * (r0 + len)); ctx.stroke();
        }
        this.orbitSparks(o, t, 14, 0.5);
      }
      this.orb(o, t);
      // luz do orbe sobre o ambiente (usada no comp)
      S.lightA = [u[0], u[1], Math.max(140, o.R * 2.3), Math.min(0.85, o.I * 0.26) * (o.phase === 'D' ? 1 + 1.6 * o.throwK : 1)];
      S.tintA = [o.col[0] / 255, o.col[1] / 255, o.col[2] / 255];
    }
    // onda de choque (anéis) no impacto, logo depois da tela
    const ti = t - T.impactT;
    if (ti > 0 && ti < 1.3) {
      const cx = W * 0.5, cy = H * 0.52;
      for (let k = 0; k < 3; k++) {
        const tt = ti - k * 0.07; if (tt <= 0) continue;
        const rr = easeOutExpo(tt / 1.0) * 1500;
        ctx.lineWidth = Math.max(1, 38 * (1 - tt / 1.2)); ctx.strokeStyle = rgba(k ? COL.violet : COL.white, 0.9 * (1 - tt / 1.2));
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.stroke();
      }
    }
  }

  async commit() { await commitSnapshot(this.tex, this.canvas); }
}
