// Linha do tempo: tempos (s) de cada efeito, curvas de animação e leitura do rastreamento.
// Tempos ancorados na fala (Whisper large-v3) — ver data/words.json.

export const FPS = 30;
export const DURATION = 37.5;
export const FRAMES = 1125;

export const T = {
  // 5.77 "Aqui atrás tem uma legenda…" → legenda atrás da cabeça
  capIn: 5.55, capOut: 10.75,
  // 12.26 "Aqui tem uma mágica, qualquer uma que seja."
  m1In: 12.18, m1Out: 16.15,
  // 16.80 "puxando e concentrando a mágica e lançando ela na tela"
  pullIn: 16.05, // varrida da mão para a esquerda: começa a "puxar"
  chargeIn: 17.75, // concentra (orbe cresce na mão)
  throwT: 22.38, // orbe sai da mão em direção à tela
  impactT: 22.78, // atinge a "tela" (câmera)
  // 24.08 "Aqui a gente teleportou, tá no meio do espaço."
  portalT: 22.78, // onda do portal começa a revelar o espaço
  warpEnd: 24.15, // hiperespaço desacelera e assenta
  // 28.64 "Teleportou com um buraco negro que apareceu"
  bhIn: 28.30, bhFull: 29.70, bhOut: 31.95,
  // 32.62 "E agora, uma Supernova atrás de mim."  (Supernova = 34.54)
  snPre: 32.55, snBang: 34.50,
};

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t) => Math.pow(clamp(t), 3);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
export const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutBack = (t, s = 1.70158) => { t = clamp(t) - 1; return 1 + (s + 1) * t * t * t + s * t * t; };
export const pulse = (t, a, b, fi, fo) => sstep(a, a + fi, t) * (1 - sstep(b - fo, b, t));

// ── leitura do rastreamento (interpolado entre quadros; y invertido → uv com y para cima) ──
export function makeTrack(data) {
  const lerpIdx = (t) => {
    const f = clamp(t * data.fps, 0, data.n - 1);
    const i = Math.floor(f), j = Math.min(data.n - 1, i + 1), k = f - i;
    return [i, j, k];
  };
  const v = (arr, i, j, k) => arr[i] + (arr[j] - arr[i]) * k;
  const p2 = (arr, i, j, k) => [v(arr.map((a) => a[0]), i, j, k), 1 - v(arr.map((a) => a[1]), i, j, k)];
  const p2f = (arr, i, j, k) => [arr[i][0] + (arr[j][0] - arr[i][0]) * k, 1 - (arr[i][1] + (arr[j][1] - arr[i][1]) * k)];
  const at = (t) => {
    const [i, j, k] = lerpIdx(t);
    const h = data.hand, hd = data.head;
    return {
      hand: {
        v: v(h.v, i, j, k), tip: p2f(h.tip, i, j, k), cen: p2f(h.cen, i, j, k), palm: p2f(h.palm, i, j, k),
        size: v(h.size, i, j, k), open: v(h.open, i, j, k), dir: [v(h.dir.map((a) => a[0]), i, j, k), -v(h.dir.map((a) => a[1]), i, j, k)],
      },
      head: { c: p2f(hd.c, i, j, k), top: p2f(hd.top, i, j, k), size: v(hd.size, i, j, k), roll: v(hd.roll, i, j, k) },
    };
  };
  // média numa janela (suaviza movimento de elementos "presos" à cabeça)
  const avg = (t, win, steps = 9) => {
    let c = [0, 0], top = [0, 0], size = 0;
    for (let s = 0; s < steps; s++) {
      const q = at(t + (s / (steps - 1) - 0.5) * win).head;
      c[0] += q.c[0]; c[1] += q.c[1]; top[0] += q.top[0]; top[1] += q.top[1]; size += q.size;
    }
    return { c: [c[0] / steps, c[1] / steps], top: [top[0] / steps, top[1] / steps], size: size / steps };
  };
  return { at, avg };
}
