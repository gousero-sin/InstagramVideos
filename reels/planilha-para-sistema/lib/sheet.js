import * as THREE from 'three';
import { hash } from '../../../engine/core/random.js';
import { C, F } from '../config.js';

// Planilha 3D instanciada: milhares de células (atlas de textura) que podem
// virar erro (#REF!...), descolar do chão, girar e ser sugadas por um vórtice —
// tudo calculado na GPU como função do tempo (sem estado entre frames).

export const CW = 2.4; // largura da célula (mundo)
export const CH = 0.6; // altura da célula (mundo)
const TW = 512, TH = 128, AC = 8, AR = 32; // atlas 4096×4096 (nítido mesmo em close-up)

const NUMBERS = 96, LABELS = 32, FORMULAS = 32, ERRORS = 16, HEADERS = 32, EMPTY = 16;
export const T = {
  num: 0,
  label: NUMBERS,
  formula: NUMBERS + LABELS,
  error: NUMBERS + LABELS + FORMULAS,
  header: NUMBERS + LABELS + FORMULAS + ERRORS,
  empty: NUMBERS + LABELS + FORMULAS + ERRORS + HEADERS,
};

const LABEL_TXT = ['Cliente', 'Fornecedor', 'Total', 'Saldo', 'Vendas', 'Itaú', 'Safra', 'Caixa', 'Mercantil', 'DRE', 'Receita', 'Despesa', 'Lucro', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Estoque', 'Comissão', 'Boleto', 'Pix', 'Pendente', 'Atrasado', 'Pago', 'Imposto', 'Folha', 'Aluguel', 'Frete', 'Meta', 'TOTAL GERAL'];
const FORMULA_TXT = ['=SOMA(B2:B9)', '=PROCV(A2;D:F;3;0)', '=SE(C4>0;C4;0)', '=MÉDIA(E2:E40)', '=B7*1,15', '=CONT.SE(F:F;"ok")', '=HOJE()', '=SOMASE(A:A;"Pix")', '=B12-C12', '=ARRED(D3;2)', '=ÍNDICE(A:A;5)', '=CORRESP(9;B:B)', '=SE(É.ERRO(X);0)', '=MÁXIMO(G2:G90)', '=D4/D$1', '=SOMA(H:H)*0,9'];
const ERROR_TXT = ['#REF!', '#N/D', '#VALOR!', '#DIV/0!', '#NOME?', '#NÚM!'];

function fmtBR(v) {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(2).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + s[0] + ',' + s[1];
}

export function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = TW * AC;
  c.height = TH * AR;
  const ctx = c.getContext('2d');
  const tile = (i, draw) => {
    const x = (i % AC) * TW, y = Math.floor(i / AC) * TH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, TW, TH);
    ctx.clip();
    ctx.translate(x, y);
    draw();
    ctx.restore();
  };
  const cell = (bg, border = 'rgba(140,255,150,0.16)') => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, TW, TH);
    ctx.fillStyle = border;
    ctx.fillRect(0, 0, TW, 4); // linha superior
    ctx.fillRect(0, 0, 4, TH); // linha esquerda
  };
  const text = (s, color, align = 'right', font = `500 52px "${F.mono}"`) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    ctx.fillText(s, align === 'right' ? TW - 36 : align === 'center' ? TW / 2 : 36, TH / 2 + 4, TW - 60);
  };
  let seed = 7;
  const rnd = () => hash(seed++, 99);
  for (let i = 0; i < NUMBERS; i++) {
    tile(T.num + i, () => {
      cell('#090c0b');
      const r = rnd();
      let s;
      if (r < 0.45) s = fmtBR((rnd() * 98000 + 120) * (rnd() < 0.18 ? -1 : 1));
      else if (r < 0.7) s = 'R$ ' + fmtBR(rnd() * 48000 + 50);
      else if (r < 0.85) s = (rnd() * 140).toFixed(1).replace('.', ',') + '%';
      else s = `${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}/${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}/25`;
      text(s, s.startsWith('-') ? C.redSoft : '#c9d3ce');
    });
  }
  for (let i = 0; i < LABELS; i++) {
    tile(T.label + i, () => {
      cell('#0b0f0d');
      text(LABEL_TXT[i % LABEL_TXT.length], '#f3f6f4', 'left', `700 52px "${F.mono}"`);
    });
  }
  for (let i = 0; i < FORMULAS; i++) {
    tile(T.formula + i, () => {
      cell('#08100a');
      text(FORMULA_TXT[i % FORMULA_TXT.length], C.green, 'left', `500 48px "${F.mono}"`);
    });
  }
  for (let i = 0; i < ERRORS; i++) {
    tile(T.error + i, () => {
      cell('#2a0209', 'rgba(255,40,80,0.55)');
      ctx.fillStyle = 'rgba(255,0,60,0.18)';
      ctx.fillRect(8, 8, TW - 16, TH - 16);
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, TW - 12, TH - 12);
      text(ERROR_TXT[i % ERROR_TXT.length], '#ff2a5c', 'center', `700 60px "${F.mono}"`);
    });
  }
  const colName = (n) => (n < 26 ? String.fromCharCode(65 + n) : 'A' + String.fromCharCode(65 + n - 26));
  for (let i = 0; i < HEADERS; i++) {
    tile(T.header + i, () => {
      cell('#121816', 'rgba(140,255,150,0.22)');
      text(colName(i), '#7f8d86', 'center', `700 52px "${F.mono}"`);
    });
  }
  for (let i = 0; i < EMPTY; i++) tile(T.empty + i, () => cell('#090c0b'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
attribute vec2 aCell;   // coluna, linha
attribute vec2 aTile;   // tile normal, tile de erro
attribute vec4 aRnd;
uniform float uTime;
uniform float uCW;
uniform float uCH;
// onda de erros
uniform float uWaveT0;
uniform float uWaveSpeed;
uniform vec2 uWaveCenter;
uniform float uErrRatio;
// descolamento
uniform float uLiftT0;
uniform float uLiftSpread;
uniform float uLiftRatio;
uniform vec2 uLiftCenter;
// vórtice
uniform float uVortex;
uniform float uVTime;
uniform vec3 uVCenter;
uniform vec3 uVAxis;
uniform vec3 uVU;
uniform vec3 uVV;
// glitch de posição
uniform float uJitter;
varying vec2 vUv;
varying float vErr;
varying float vFog;
varying float vHeat;
varying float vLift;

mat3 rotAxis(vec3 a, float ang) {
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

void main() {
  vec3 base = vec3(aCell.x * uCW, 0.0, -aCell.y * uCH);
  vec3 p = position; // quad no plano XZ, centrado

  // ── flip para erro (meia volta no eixo X, troca o conteúdo no meio) ──
  float isErr = step(aRnd.x, uErrRatio);
  float d = length((aCell - uWaveCenter) * vec2(uCW, uCH));
  float tf = uWaveT0 + d / uWaveSpeed + aRnd.y * 0.12;
  float fp = isErr * clamp((uTime - tf) / 0.16, 0.0, 1.0);
  float ang = fp < 0.5 ? fp * 3.14159 : (fp - 1.0) * 3.14159;
  vErr = step(0.5, fp);
  p = rotAxis(vec3(1.0, 0.0, 0.0), ang) * p;

  // ── descolamento: célula sobe com arrasto e gira num eixo aleatório ──
  float liftOn = step(aRnd.z, uLiftRatio);
  float dl = length((aCell - uLiftCenter) * vec2(uCW, uCH));
  float tl = uLiftT0 + aRnd.w * uLiftSpread + dl * 0.035;
  float lt = max(0.0, uTime - tl) * liftOn;
  float k = 1.6;
  float rise = (1.0 - exp(-k * lt)) / k * (2.2 + aRnd.y * 3.5) + lt * 0.35;
  vec3 axis = normalize(vec3(aRnd.y - 0.5, aRnd.z - 0.5, aRnd.w - 0.5) + 0.001);
  p = rotAxis(axis, lt * (1.5 + aRnd.x * 4.0)) * p;
  vec3 drift = vec3((aRnd.w - 0.5) * 1.6, rise, (aRnd.y - 0.5) * 1.2) * min(1.0, lt * 3.0);
  vec3 wp = base + drift + p;
  vLift = min(1.0, lt * 2.0);

  // ── vórtice: as células formam um disco espiral (3 braços) e colapsam no centro ──
  if (uVortex > 0.0) {
    float arm = floor(aRnd.x * 3.0);
    float Rd = 1.0 + pow(aRnd.y, 0.8) * 17.0;
    float phi = arm * 2.0944 + log(Rd) * 2.4 + (aRnd.z - 0.5) * 0.6;
    float gather = smoothstep(0.0, 0.5, uVortex - aRnd.w * 0.12);
    float col = clamp((uVortex - 0.42) / 0.58, 0.0, 1.0);
    float R = Rd * pow(1.0 - col, 1.5);
    float w = 1.3 * (1.0 + 7.0 / (R + 1.0));
    float th = phi + w * uVTime;
    vec3 dp = uVCenter + (cos(th) * uVU + sin(th) * uVV) * R + uVAxis * (aRnd.z - 0.5) * 1.4 * (1.0 - col);
    float shrink = 1.0 - smoothstep(0.7, 1.0, col);
    wp = mix(wp, dp + p * mix(1.0, shrink, gather), gather);
    vHeat = col * gather;
  } else vHeat = 0.0;

  // jitter de glitch (por linha)
  wp.x += (fract(sin(aCell.y * 12.9898 + floor(uTime * 24.0) * 78.233) * 43758.5453) - 0.5) * uJitter * step(0.82, aRnd.y);

  // UV do tile
  float tileIdx = vErr > 0.5 ? aTile.y : aTile.x;
  float tx = mod(tileIdx, ${AC}.0);
  float ty = floor(tileIdx / ${AC}.0);
  vUv = vec2((tx + uv.x) / ${AC}.0, 1.0 - (ty + 1.0 - uv.y) / ${AR}.0);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFog = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform float uRed;      // 0..1: tinge tudo de vermelho (caos)
uniform float uBright;
uniform float uErrGlow;
varying vec2 vUv;
varying float vErr;
varying float vFog;
varying float vHeat;
varying float vLift;
void main() {
  vec3 c = texture2D(uAtlas, vUv).rgb;
  if (!gl_FrontFacing) c *= 0.25;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 red = vec3(lum * 1.6, lum * 0.18, lum * 0.32) + vec3(0.05, 0.0, 0.01);
  c = mix(c, red, uRed * (1.0 - vErr) * 0.85);
  c *= uBright;
  c += vErr * c * uErrGlow;
  c += vHeat * vHeat * vec3(1.9, 0.12, 0.28) * 1.1;
  c += vLift * vec3(0.02, 0.0, 0.0) * uRed;
  float f = smoothstep(uFogNear, uFogFar, vFog);
  gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
}`;

export function makeSheet({ cols = 26, rows = 150, atlas, overrides = {} }) {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(CW * 0.995, CH * 0.99);
  quad.rotateX(-Math.PI / 2);
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const n = cols * rows;
  const aCell = new Float32Array(n * 2);
  const aTile = new Float32Array(n * 2);
  const aRnd = new Float32Array(n * 4);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = k++;
      aCell[i * 2] = c - Math.floor(cols / 2);
      aCell[i * 2 + 1] = r;
      const h = hash(i, 3);
      let tile;
      const colX = c - Math.floor(cols / 2);
      if (r === 0) tile = T.header + (c % HEADERS);
      else if ((colX === -4 || colX === 6) && h < 0.85) tile = T.label + Math.floor(hash(i, 5) * LABELS);
      else if (h < 0.1) tile = T.formula + Math.floor(hash(i, 6) * FORMULAS);
      else if (h < 0.2) tile = T.empty + Math.floor(hash(i, 7) * EMPTY);
      else if (h < 0.26) tile = T.label + Math.floor(hash(i, 8) * LABELS);
      else tile = T.num + Math.floor(hash(i, 9) * NUMBERS);
      const ov = overrides[`${colX},${r}`];
      if (ov !== undefined) tile = ov;
      aTile[i * 2] = tile;
      aTile[i * 2 + 1] = T.error + Math.floor(hash(i, 10) * ERRORS);
      aRnd[i * 4] = hash(i, 11);
      aRnd[i * 4 + 1] = hash(i, 12);
      aRnd[i * 4 + 2] = hash(i, 13);
      aRnd[i * 4 + 3] = hash(i, 14);
    }
  }
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 2));
  geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(aTile, 2));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uTime: { value: 0 },
      uCW: { value: CW },
      uCH: { value: CH },
      uWaveT0: { value: 1e4 },
      uWaveSpeed: { value: 18 },
      uWaveCenter: { value: new THREE.Vector2(0, 40) },
      uErrRatio: { value: 0.0 },
      uLiftT0: { value: 1e4 },
      uLiftSpread: { value: 3 },
      uLiftRatio: { value: 0 },
      uLiftCenter: { value: new THREE.Vector2(0, 40) },
      uVortex: { value: 0 },
      uVCenter: { value: new THREE.Vector3() },
      uVAxis: { value: new THREE.Vector3(0, 0, 1) },
      uVU: { value: new THREE.Vector3(1, 0, 0) },
      uVV: { value: new THREE.Vector3(0, 1, 0) },
      uVTime: { value: 0 },
      uJitter: { value: 0 },
      uFogNear: { value: 8 },
      uFogFar: { value: 60 },
      uFogColor: { value: new THREE.Color(C.bg) },
      uRed: { value: 0 },
      uBright: { value: 1 },
      uErrGlow: { value: 1.2 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// Retângulo de seleção (estilo planilha): contorno verde + "alça" no canto.
export function makeSelection() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(2.2), toneMapped: false, fog: false });
  const t = 0.07;
  const bars = [
    [CW + t, t, 0, CH / 2],
    [CW + t, t, 0, -CH / 2],
    [t, CH + t, -CW / 2, 0],
    [t, CH + t, CW / 2, 0],
  ];
  for (const [w, h, x, z] of bars) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), mat);
    m.position.set(x, 0.01, z);
    g.add(m);
  }
  const handle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22).rotateX(-Math.PI / 2), mat);
  handle.position.set(CW / 2, 0.012, CH / 2);
  g.add(handle);
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(CW, CH).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(0.25), transparent: true, opacity: 0.35, depthWrite: false, fog: false })
  );
  fill.position.y = 0.005;
  g.add(fill);
  return g;
}

export const cellPos = (col, row, y = 0) => new THREE.Vector3(col * CW, y, -row * CH);
