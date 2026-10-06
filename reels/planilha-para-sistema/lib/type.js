import * as THREE from 'three';
import { Text2D, TextGlyphs } from '../../../engine/gfx/text2d.js';
import { hash } from '../../../engine/core/random.js';
import { C, F } from '../config.js';

// Estilos tipográficos do reel (sistema único: Archivo + JetBrains Mono)
export const S = {
  hook: { family: F.heroC, weight: 900, size: 138, letterSpacing: 1 },
  pain: { family: F.heroC, weight: 900, size: 176, letterSpacing: 0 },
  giant: { family: F.hero, weight: 900, size: 300, letterSpacing: 2 },
  caption: { family: F.sans, weight: 900, size: 96, letterSpacing: -1 },
  captionC: { family: F.heroC, weight: 900, size: 130, letterSpacing: 1 },
  kicker: { family: F.mono, weight: 700, size: 34, letterSpacing: 3, color: C.green },
  mono: { family: F.mono, weight: 500, size: 40, letterSpacing: 0, color: C.green },
  tag: { family: F.mono, weight: 700, size: 40, letterSpacing: 1, color: '#ffffff', bg: { color: C.red, padX: 16, padY: 6, radius: 6 } },
  tagGreen: { family: F.mono, weight: 700, size: 34, letterSpacing: 1, color: '#04140a', bg: { color: C.green, padX: 14, padY: 6, radius: 6 } },
};

export const txt = (s, style, extra = {}) => new Text2D(s, { ...style, ...extra });
export const glyphs = (s, style, extra = {}) => new TextGlyphs(s, { ...style, ...extra });

// Texto com "fantasmas" RGB que tremem (glitch) — fantasmas desenhados atrás do texto.
export class GlitchText extends THREE.Group {
  constructor(s, style, { ghost1 = C.red, ghost2 = C.cyan, seed = 1 } = {}) {
    super();
    this.g1 = new Text2D(s, { ...style, color: ghost1 });
    this.g2 = new Text2D(s, { ...style, color: ghost2 });
    this.main = new Text2D(s, style);
    this.add(this.g1, this.g2, this.main);
    this.seed = seed;
    this.w = this.main.w;
    this.cap = this.main.ascent;
  }
  // amount 0..1: intensidade do glitch neste frame
  glitch(t, amount, opacity = 1) {
    const step = Math.floor(t * 30);
    const r = (k) => hash(step * 7 + k, this.seed) - 0.5;
    const a = amount;
    this.g1.position.set(r(1) * 46 * a + 7 * a, r(2) * 18 * a, -1);
    this.g2.position.set(r(3) * 46 * a - 7 * a, r(4) * 18 * a, -2);
    this.g1.opacity = Math.min(1, a * 1.5) * opacity * 0.9;
    this.g2.opacity = Math.min(1, a * 1.5) * opacity * 0.6;
    this.main.position.x = r(5) * 22 * a * (hash(step, this.seed + 9) < 0.35 ? 1 : 0);
    this.main.opacity = opacity;
    this.visible = opacity > 0.001;
  }
  setBlur(v) {
    this.main.blur = v;
    this.g1.blur = v;
    this.g2.blur = v;
  }
}
