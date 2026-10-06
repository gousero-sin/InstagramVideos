import * as THREE from 'three';
import { ease, invLerp, clamp, lerp } from './core/time.js';
import { hash } from './core/random.js';
import { canvasTexture, makeTextMaterial } from './gfx/text2d.js';

// ── Tipografia cinética: funções puras de (objeto, t) ──

// Entrada "slam": chega grande e borrado, trava no lugar com overshoot mínimo.
export function slam(obj, t, t0, o = {}) {
  const dur = o.dur ?? 0.24;
  const s0 = o.from ?? 2.2;
  if (t < t0) {
    obj.visible = false;
    return 0;
  }
  obj.visible = true;
  const p = invLerp(t0, t0 + dur, t);
  const e = ease.outExpo(p);
  const s = lerp(s0, 1, e) * (o.scale ?? 1);
  obj.scale.set(s, s, 1);
  obj.rotation.z = (o.rot ?? 0.06) * (1 - e);
  setOpacity(obj, clamp((t - t0) / 0.045) * (o.opacity ?? 1));
  setBlur(obj, (o.blur ?? 3.5) * (1 - ease.outCubic(p)));
  return p;
}

// Saída rápida: escala para cima + blur + fade
export function blast(obj, t, t0, o = {}) {
  if (t < t0) return 0;
  const dur = o.dur ?? 0.16;
  const p = invLerp(t0, t0 + dur, t);
  const e = ease.inCubic(p);
  const base = o.scale ?? 1;
  const s = base * lerp(1, o.to ?? 1.6, e);
  obj.scale.set(s, s, 1);
  setOpacity(obj, (1 - e) * (o.opacity ?? 1));
  setBlur(obj, 3 * e);
  if (p >= 1) obj.visible = false;
  return p;
}

// Glifos sobem de trás de uma máscara (linha de base), com stagger.
export function riseGlyphs(line, t, t0, o = {}) {
  const dur = o.dur ?? 0.5;
  const st = o.stagger ?? 0.022;
  const dist = (o.dist ?? 1.25) * line.cap;
  const n = line.glyphs.length;
  let any = false;
  line.glyphs.forEach((g, i) => {
    const k = o.reverse ? n - 1 - i : i;
    const ti = t0 + k * st;
    const p = invLerp(ti, ti + dur, t);
    const e = (o.ease || ease.outExpo)(p);
    g.position.y = lerp(-dist, 0, e) + (o.y ?? 0);
    g.rotation.z = (o.rot ?? 0) * (1 - e);
    g.opacity = t >= ti ? (o.opacity ?? 1) : 0;
    if (t >= ti) any = true;
  });
  line.visible = any;
}

// Glifos descem para trás da máscara (saída)
export function dropGlyphs(line, t, t0, o = {}) {
  if (t < t0) return;
  const dur = o.dur ?? 0.3;
  const st = o.stagger ?? 0.012;
  const dist = (o.dist ?? 1.25) * line.cap;
  line.glyphs.forEach((g, i) => {
    const ti = t0 + i * st;
    const p = invLerp(ti, ti + dur, t);
    const e = ease.inExpo(p);
    g.position.y += lerp(0, o.up ? dist : -dist, e);
    if (p >= 1) g.opacity = 0;
  });
}

// Digitação: glifo i aparece em t0 + i*cps. Retorna índice do próximo glifo (para o cursor).
export function typeGlyphs(line, t, t0, cps = 0.03) {
  let shown = 0;
  line.glyphs.forEach((g, i) => {
    const on = t >= t0 + i * cps;
    g.opacity = on ? 1 : 0;
    g.position.y = 0;
    if (on) shown = i + 1;
  });
  line.visible = t >= t0;
  return shown;
}

// Glifos com "pop" de escala (mola), stagger a partir do centro ou da esquerda
export function popGlyphs(line, t, t0, o = {}) {
  const st = o.stagger ?? 0.03;
  const n = line.glyphs.length;
  line.glyphs.forEach((g, i) => {
    const k = o.center ? Math.abs(i - (n - 1) / 2) : i;
    const ti = t0 + k * st;
    const lt = t - ti;
    if (lt < 0) {
      g.opacity = 0;
      return;
    }
    const w = 2 * Math.PI * (o.freq ?? 3.2);
    const z = o.damp ?? 0.42;
    const s = 1 - Math.exp(-z * w * lt) * Math.cos(w * Math.sqrt(1 - z * z) * lt);
    g.scale.set(s, s, 1);
    g.opacity = clamp(lt / 0.04);
  });
  line.visible = t >= t0;
}

export function setOpacity(obj, v) {
  if (obj.glyphs) obj.glyphs.forEach((g) => (g.opacity = v));
  else if (obj.material && obj.material.uniforms && obj.material.uniforms.uOpacity) {
    obj.material.uniforms.uOpacity.value = v;
  } else obj.traverse?.((c) => c !== obj && c.material?.uniforms?.uOpacity && (c.material.uniforms.uOpacity.value = v));
  obj.visible = v > 0.001;
}

export function setBlur(obj, v) {
  if (obj.glyphs) obj.glyphs.forEach((g) => (g.blur = v));
  else if (obj.material?.uniforms?.uBlur) obj.material.uniforms.uBlur.value = v;
}

// ── Texto dinâmico (contadores, terminal, "decode") ──
// Canvas de tamanho fixo, redesenhado só quando o conteúdo muda.
export class DynamicText extends THREE.Mesh {
  constructor({ width = 800, height = 120, ss = 2, draw }) {
    const c = document.createElement('canvas');
    c.width = width * ss;
    c.height = height * ss;
    const tex = canvasTexture(c);
    super(new THREE.PlaneGeometry(width, height), makeTextMaterial(tex));
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ss = ss;
    this.drawFn = draw;
    this.key = null;
    this.tex = tex;
    this.frustumCulled = false;
  }
  update(state) {
    const key = JSON.stringify(state);
    if (key === this.key) return;
    this.key = key;
    const { ctx, canvas, ss } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ss, 0, 0, ss, 0, 0);
    this.drawFn(ctx, state, canvas.width / ss, canvas.height / ss);
    this.tex.needsUpdate = true;
  }
  set opacity(v) {
    this.material.uniforms.uOpacity.value = v;
    this.visible = v > 0.001;
  }
  setClip(...a) {
    this.material.uniforms.uClip.value.set(...a);
    return this;
  }
}

// "Decode": troca caracteres aleatórios até assentar no texto final
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\';
export function scramble(text, t, t0, dur = 0.5, seed = 1) {
  if (t < t0) return '';
  const p = clamp((t - t0) / dur);
  const n = text.length;
  const step = Math.floor(t * 30);
  let out = '';
  for (let i = 0; i < n; i++) {
    const settle = (i / n) * 0.7 + 0.3;
    if (text[i] === ' ') out += ' ';
    else if (p >= settle) out += text[i];
    else if (p >= (i / n) * 0.5) out += GLYPHS[Math.floor(hash(i * 131 + step, seed) * GLYPHS.length)];
    else out += ' ';
  }
  return out;
}
