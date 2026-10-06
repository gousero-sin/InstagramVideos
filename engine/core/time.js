// Tempo, easing e keyframes — tudo é função pura do tempo (determinístico),
// então qualquer frame pode ser renderizado isoladamente, em qualquer ordem.

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (a === b ? (x >= b ? 1 : 0) : clamp((x - a) / (b - a)));
export const remap = (x, a, b, c, d, e = (t) => t) => lerp(c, d, e(invLerp(a, b, x)));
export const smoothstep = (a, b, x) => {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
};
export const fract = (x) => x - Math.floor(x);
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// Janela 0→1→0: sobe em [a,b], segura, desce em [c,d].
export const window4 = (x, a, b, c, d, ein = (t) => t, eout = (t) => t) =>
  x < a || x > d ? 0 : x < b ? ein(invLerp(a, b, x)) : x <= c ? 1 : 1 - eout(invLerp(c, d, x));
// Pulso exponencial disparado em t0 (para impactos, flashes, shakes).
export const pulse = (t, t0, decay = 8) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay));
// Pulso com ataque curto (evita degrau instantâneo).
export const hit = (t, t0, attack = 0.012, decay = 8) =>
  t < t0 - attack ? 0 : t < t0 ? (t - (t0 - attack)) / attack : Math.exp(-(t - t0) * decay);

const PI = Math.PI;
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * PI) / 3;

export const ease = {
  linear: (t) => t,
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inQuint: (t) => t ** 5,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inCirc: (t) => 1 - Math.sqrt(1 - t * t),
  outCirc: (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  inOutCirc: (t) =>
    t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  inBack: (t) => c3 * t * t * t - c1 * t * t,
  outBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack: (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  outElastic: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
};

// cubic-bezier(x1,y1,x2,y2) igual ao CSS / After Effects.
export function bezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-6) break;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    // fallback por bisseção se Newton divergir
    if (u < 0 || u > 1 || Math.abs(sx(u) - x) > 1e-4) {
      let lo = 0, hi = 1;
      u = x;
      for (let i = 0; i < 30; i++) {
        const v = sx(u);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return sy(u);
  };
}

// Curvas "de motion designer"
ease.snap = bezier(0.75, 0, 0.1, 1); // aceleração forte, chegada macia
ease.whip = bezier(0.9, 0, 0.1, 1); // chicote: quase parado → muito rápido → trava
ease.glide = bezier(0.2, 0.7, 0.15, 1); // entrada rápida, desaceleração longa
ease.punch = bezier(0.1, 0.9, 0.2, 1);
ease.anticip = bezier(0.6, -0.35, 0.3, 1); // antecipação (volta um pouco antes de ir)

// Mola criticamente sub-amortecida (overshoot natural), forma fechada.
export function spring(t, freq = 2.2, damping = 0.38) {
  if (t <= 0) return 0;
  const w = 2 * PI * freq;
  const z = damping;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

// tween simples: valor de a→b entre t0 e t1 com easing
export const tw = (t, t0, t1, a, b, e = ease.linear) => lerp(a, b, e(invLerp(t0, t1, t)));

// Keyframes: kf(t, [[t0, v0], [t1, v1, ease], ...]) — o easing do par vale para o segmento que TERMINA nele.
// Valores podem ser números ou arrays.
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t <= k1[0]) {
      const k0 = keys[i - 1];
      const e = k1[2] || ease.inOutCubic;
      const u = e(invLerp(k0[0], k1[0], t));
      if (Array.isArray(k0[1])) return k0[1].map((v, j) => lerp(v, k1[1][j], u));
      return lerp(k0[1], k1[1], u);
    }
  }
  return last[1];
}

// Grade musical
export class Beat {
  constructor(bpm) {
    this.bpm = bpm;
    this.beat = 60 / bpm;
    this.bar = this.beat * 4;
  }
  s(beats) {
    return beats * this.beat;
  }
  b(seconds) {
    return seconds / this.beat;
  }
}
