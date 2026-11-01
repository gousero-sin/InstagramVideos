import { T, clamp, sstep, mix, easeOutCubic, easeOutExpo, easeInOut } from './timeline.js';

const fr = (x) => x - Math.floor(x);
const hr = (n) => fr(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// posições (uv, y para cima) dos elementos do cenário
export const POS = {
  portal: [0.5, 0.52],
  planet: [0.19, 0.835, 0.07],
  bh: [0.5, 0.79],
  sn: [0.73, 0.725],
};

// Converte o tempo em todos os parâmetros dos efeitos (um objeto por quadro).
export function computeState(t, tr, frame = Math.round(t * 30)) {
  const cur = tr.at(t);
  const S = {
    t, cur, frame,
    exposure: 1,
    capHead: tr.avg(t, 0.5),
    lightA: [0.5, 0.5, 200, 0], lightB: [0.5, 0.5, 200, 0],
    tintA: [0.4, 0.8, 1.0], tintB: [0.8, 0.4, 1.0],
    relight: 0, rimCol: [0.5, 0.65, 1.0], rimDir: [-0.5, 0.85], rimAmt: 0,
    fgGain: 1.5,
    bloom: 0.62, threshold: 1.0, knee: 0.5, scatter: 0.86,
    chroma: 0.0006, shake: [0, 0], ripple: [0.5, 0.5, 0, 0], zoom: [0.5, 0.5, 0, 1],
    flash: 0, flashCol: [1, 1, 1], vignette: 0.12, grain: 0.02, sat: 1.04, contrast: 1.05, lift: [0.004, 0.006, 0.012], gain: [1, 1, 1], fade: 0,
    world: {},
  };

  // ───────────── 5.7–10.7  legenda atrás da cabeça (só desenha; nada global) ─────────────

  // ───────────── 22.4–24.2  lançamento → impacto → portal de teleporte ─────────────
  const ti = t - T.impactT;
  const flashIn = sstep(T.impactT - 0.12, T.impactT + 0.01, t) * 0.95;
  const flashOut = 1 - sstep(T.impactT + 0.03, T.impactT + 0.5, t);
  S.flash = Math.max(S.flash, t < T.impactT + 0.02 ? flashIn : flashOut * 0.95);
  S.flashCol = [0.86, 0.9, 1.0];
  if (ti > 0 && ti < 1.6) {
    S.ripple = [POS.portal[0], POS.portal[1], ti * 1.5, 1.0 * Math.exp(-ti * 1.6)];
    S.zoom = [0.5, 0.52, 0.28 * Math.exp(-ti * 3.2), 1 + 0.07 * Math.exp(-ti * 5)];
    S.chroma += 0.007 * Math.exp(-ti * 3);
    const a = 0.02 * Math.exp(-ti * 5);
    S.shake[0] += (hr(frame * 3.1) - 0.5) * 2 * a; S.shake[1] += (hr(frame * 5.3 + 1) - 0.5) * 2 * a;
  }
  // carregando: tremida crescente
  if (t > 18 && t < T.impactT) {
    const k = sstep(18, T.throwT, t); const a = 0.0035 * k;
    S.shake[0] += (hr(frame * 7.7) - 0.5) * 2 * a; S.shake[1] += (hr(frame * 9.1 + 2) - 0.5) * 2 * a;
    S.chroma += 0.0015 * k;
  }

  // ───────────── ESPAÇO (a partir do portal) ─────────────
  const inSpace = t >= T.portalT;
  const W = S.world;
  W.uPortal = [POS.portal[0], POS.portal[1], 0, 0.03];
  W.uWarp = 0;
  W.uCam = [0, 0, 0, 1];
  W.uBH = [POS.bh[0], POS.bh[1], 1000, 0];
  W.uBH2 = [0, -1, 0, 0];
  W.uSN = [POS.sn[0], POS.sn[1], -1, 0];
  W.uSN2 = [0, 0, 0, 0];
  W.uPl = [POS.planet[0], POS.planet[1], POS.planet[2], 0];
  if (inSpace) {
    const pt = t - T.portalT;
    const e = easeOutCubic(pt / 1.0);
    W.uPortal = [POS.portal[0], POS.portal[1], 1.45 * e, mix(0.05, 0.02, e)];
    W.uWarp = t < T.warpEnd ? (1 - easeOutCubic((t - T.portalT - 0.1) / (T.warpEnd - T.portalT - 0.1))) : 0;
    const ts = t - 24;
    W.uCam = [0.010 * ts + 0.04, 0.006 * ts, 0, 1 + 0.12 * (1 - easeOutCubic((t - T.portalT) / 1.8))];
    W.uPl[3] = sstep(T.portalT + 0.9, T.portalT + 1.7, t);
    // grade do "mundo espacial"
    const sp = sstep(T.portalT + 0.2, T.portalT + 1.2, t);
    S.relight = sp;
    S.rimAmt = 0.45 * sp;
    S.rimCol = [0.45, 0.62, 1.0];
    S.rimDir = [-0.45, 0.85];
    S.vignette = mix(0.12, 0.26, sp);
    S.sat = mix(1.04, 1.1, sp);
    S.contrast = mix(1.05, 1.08, sp);
    S.lift = [mix(0.004, 0.006, sp), mix(0.006, 0.008, sp), mix(0.012, 0.022, sp)];
  }

  // ───────────── 28.3–32  buraco negro ─────────────
  if (t >= T.bhIn - 0.05 && t < T.bhOut + 0.7) {
    const tau = clamp((t - T.bhIn) / (T.bhFull - T.bhIn));
    const ee = easeOutCubic(tau);
    let Dc = 40 + 360 * Math.pow(1 - ee, 2);
    const coll = clamp((t - (T.bhOut - 0.45)) / 0.55);
    Dc = Dc + easeOutCubic(coll) * 700 * coll;
    const vis = sstep(T.bhIn - 0.02, T.bhIn + 0.35, t) * (1 - sstep(0.55, 1.0, coll));
    if (vis > 0.002 && Dc < 790) {
      W.uBH = [POS.bh[0], POS.bh[1], Dc, t * 1.0];
      W.uBH2 = [vis, t - T.bhIn, coll, 0];
      // luz alaranjada do disco sobre a pessoa
      S.rimCol = [1.0, 0.62, 0.3]; S.rimDir = [0.0, 1.0]; S.rimAmt = (0.30 + 0.55 * ee) * vis;
      // pancadas de câmera: nascimento e colapso
      const born = Math.exp(-(t - T.bhIn) * 3.2) * (t >= T.bhIn ? 1 : 0);
      const a = 0.007 * born + 0.012 * Math.exp(-Math.abs(t - (T.bhOut - 0.1)) * 8) * (t > T.bhOut - 0.4 ? 1 : 0);
      S.shake[0] += (hr(frame * 3.3) - 0.5) * 2 * a; S.shake[1] += (hr(frame * 4.7 + 1) - 0.5) * 2 * a;
      S.flash = Math.max(S.flash, 0.25 * Math.exp(-(t - (T.bhIn + 0.1)) * 9) * (t >= T.bhIn ? 1 : 0), 0.45 * Math.exp(-Math.abs(t - (T.bhOut + 0.05)) * 14) * (t > T.bhOut - 0.3 ? 1 : 0));
      S.flashCol = [1.0, 0.88, 0.7];
      S.chroma += 0.002 * vis;
    }
  }

  // ───────────── 32.5–37.5  supernova ─────────────
  if (t >= T.snPre) {
    const age = t - T.snBang;
    if (age < 0) {
      const k = Math.pow(sstep(T.snPre, T.snBang, t), 1.4);
      W.uSN = [POS.sn[0], POS.sn[1], age, k];
      W.uSN2[0] = sstep(T.snPre, T.snPre + 0.6, t);
      // a estrela "chama a atenção": rim de luz fria crescendo
      S.rimCol = [0.7, 0.8, 1.0]; S.rimDir = norm2([POS.sn[0] - cur.head.c[0], POS.sn[1] - cur.head.c[1]]); S.rimAmt = 0.45 + 0.9 * k;
      const a = 0.0025 * k;
      S.shake[0] += (hr(frame * 3.3) - 0.5) * 2 * a; S.shake[1] += (hr(frame * 4.7 + 1) - 0.5) * 2 * a;
    } else {
      W.uSN = [POS.sn[0], POS.sn[1], age, 1];
      W.uSN2[0] = 1;
      const fadeLight = Math.exp(-0.28 * Math.max(age - 0.6, 0));
      S.rimCol = [1.0, 0.72, 0.5]; S.rimDir = norm2([POS.sn[0] - cur.head.c[0], POS.sn[1] - cur.head.c[1]]);
      S.rimAmt = 0.9 + 1.6 * Math.exp(-age * 1.6) * 1.0 + 0.5 * fadeLight;
      S.relight = 1;
      // estrondo: flash, onda de refração, zoom, tremor, aberração
      S.flash = Math.max(S.flash, 0.98 * (1 - sstep(0.0, 0.42, age)) * (age >= -0.02 ? 1 : 0));
      S.flashCol = [1.0, 0.95, 0.88];
      S.ripple = [POS.sn[0], POS.sn[1], age * 1.25, 0.9 * Math.exp(-age * 1.4)];
      S.zoom = [POS.sn[0], POS.sn[1], 0.1 * Math.exp(-age * 4.5), 1 + 0.06 * Math.exp(-age * 6)];
      S.chroma += 0.006 * Math.exp(-age * 2.4);
      const a = 0.02 * Math.exp(-age * 4.2) + 0.0015;
      S.shake[0] += (hr(frame * 3.3) - 0.5) * 2 * a; S.shake[1] += (hr(frame * 4.7 + 1) - 0.5) * 2 * a;
      S.bloom += 0.5 * Math.exp(-age * 1.5);
    }
  }
  return S;
}

function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
