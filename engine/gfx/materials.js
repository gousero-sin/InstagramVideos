import * as THREE from 'three';

// ───────────────────────────── Matcaps procedurais ─────────────────────────────
// Gera um matcap "de estúdio" calculando, para cada pixel da esfera, a reflexão
// num ambiente sintético (softbox, linha do horizonte, luzes de recorte coloridas).

const cache = new Map();

export function makeMatcap(kind = 'chrome', size = 256) {
  const key = kind + size;
  if (cache.has(key)) return cache.get(key);
  const P = PRESETS[kind];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = -(((j + 0.5) / size) * 2 - 1);
      const r2 = u * u + v * v;
      const k = (j * size + i) * 4;
      if (r2 > 1) {
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 0;
        img.data[k + 3] = 255;
        continue;
      }
      const nz = Math.sqrt(1 - r2);
      // reflexão do vetor de visão (0,0,-1) pela normal (u,v,nz)
      const d = -nz; // dot(V, n)
      const rx = 0 - 2 * d * u;
      const ry = 0 - 2 * d * v;
      const rz = -1 - 2 * d * nz;
      const col = env(P, rx, ry, rz, u, v, nz);
      for (let ch = 0; ch < 3; ch++) {
        // tonemap suave + gamma
        const x = col[ch];
        const tm = x / (1 + x * 0.35);
        img.data[k + ch] = Math.max(0, Math.min(255, Math.pow(Math.min(1, tm), 1 / 2.2) * 255));
      }
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

const PRESETS = {
  chrome: { base: [0.02, 0.022, 0.025], sky: [0.16, 0.17, 0.18], top: [3.2, 3.2, 3.1], horizon: [1.6, 1.65, 1.6], rimR: [0.25, 1.9, 0.12], rimL: [1.0, 1.05, 1.1], ground: [0.01, 0.012, 0.01] },
  chromeRed: { base: [0.03, 0.01, 0.012], sky: [0.2, 0.08, 0.09], top: [3.0, 2.6, 2.6], horizon: [1.8, 0.5, 0.5], rimR: [2.2, 0.08, 0.2], rimL: [1.0, 0.85, 0.85], ground: [0.02, 0.0, 0.0] },
  neon: { base: [0.01, 0.04, 0.01], sky: [0.08, 0.3, 0.06], top: [1.6, 3.4, 1.3], horizon: [0.6, 2.2, 0.4], rimR: [0.4, 2.6, 0.2], rimL: [1.2, 1.6, 1.1], ground: [0.0, 0.02, 0.0] },
  dark: { base: [0.008, 0.009, 0.01], sky: [0.05, 0.055, 0.06], top: [0.9, 0.95, 0.95], horizon: [0.35, 0.4, 0.38], rimR: [0.1, 0.8, 0.06], rimL: [0.3, 0.32, 0.34], ground: [0.004, 0.005, 0.004] },
  darkRed: { base: [0.012, 0.005, 0.006], sky: [0.07, 0.03, 0.035], top: [0.95, 0.85, 0.85], horizon: [0.45, 0.15, 0.16], rimR: [0.9, 0.04, 0.1], rimL: [0.32, 0.28, 0.28], ground: [0.006, 0.002, 0.002] },
  white: { base: [0.5, 0.52, 0.55], sky: [0.9, 0.92, 0.95], top: [2.4, 2.4, 2.4], horizon: [1.4, 1.45, 1.4], rimR: [0.6, 1.8, 0.5], rimL: [1.2, 1.2, 1.25], ground: [0.12, 0.13, 0.13] },
};

function env(P, rx, ry, rz, u, v, nz) {
  const out = [0, 0, 0];
  const add = (c, w) => {
    out[0] += c[0] * w;
    out[1] += c[1] * w;
    out[2] += c[2] * w;
  };
  // gradiente céu/chão
  const sky = Math.max(0, ry);
  add(P.base, 1);
  add(P.sky, Math.pow(sky, 0.8));
  add(P.ground, Math.max(0, -ry));
  // softbox no topo (retângulo largo)
  const top = smooth(0.55, 0.75, ry) * smooth(0.95, 0.6, Math.abs(rx));
  add(P.top, top);
  // linha do horizonte (fina e brilhante)
  const hz = Math.exp(-Math.pow((ry + 0.04) / 0.035, 2)) * smooth(-0.6, 0.2, -rz);
  add(P.horizon, hz);
  // luz de recorte colorida à direita (contraluz), branca à esquerda
  const rr = smooth(0.55, 0.95, rx) * smooth(-0.6, 0.4, ry + 0.3);
  add(P.rimR, rr);
  const rl = smooth(0.7, 0.98, -rx) * smooth(-0.2, 0.6, ry + 0.2);
  add(P.rimL, rl * 0.8);
  // borda de fresnel geral
  const fres = Math.pow(1 - nz, 3);
  add(P.sky, fres * 0.6);
  return out;
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ───────────────────────────── Material "Chrome" ─────────────────────────────
// matcap + rim de fresnel + faixa de luz varrendo + emissivo HDR + dissolve com borda brilhante.

const CHROME_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vN;
varying vec3 vViewPos;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  vViewPos = -mvPosition.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const CHROME_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMatcap;
uniform vec3 uTint;
uniform vec3 uEmissive;
uniform vec3 uRim;
uniform float uRimPow;
uniform vec3 uSweepColor;
uniform vec3 uSweepDir;
uniform float uSweepPos;
uniform float uSweepWidth;
uniform float uOpacity;
uniform vec3 uRevealDir;
uniform float uReveal;
uniform float uRevealEdge;
uniform vec3 uEdgeColor;
uniform float uMatRot;
uniform vec3 uGradTop;
uniform vec3 uGradBot;
uniform float uGradH;
varying vec3 vN;
varying vec3 vViewPos;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  float rc = dot(vWorld, uRevealDir);
  if (rc > uReveal) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 viewDir = normalize(vViewPos);
  vec3 x = normalize(vec3(viewDir.z, 0.0, -viewDir.x));
  vec3 y = cross(viewDir, x);
  vec2 muv = vec2(dot(x, n), dot(y, n));
  float cr = cos(uMatRot), sr = sin(uMatRot);
  muv = mat2(cr, -sr, sr, cr) * muv;
  muv = muv * 0.495 + 0.5;
  vec3 col = texture2D(uMatcap, muv).rgb * uTint;
  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), uRimPow);
  col += uRim * fres;
  float s = dot(vWorld, uSweepDir) - uSweepPos;
  col += uSweepColor * exp(-s * s / (uSweepWidth * uSweepWidth));
  col += uEmissive;
  col += mix(uGradBot, uGradTop, smoothstep(-uGradH, uGradH, vLocal.y));
  float edge = 1.0 - smoothstep(0.0, uRevealEdge, uReveal - rc);
  col += uEdgeColor * edge;
  gl_FragColor = vec4(col, uOpacity);
  #include <fog_fragment>
}`;

export function chromeMaterial(o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMatcap: { value: null },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uEmissive: { value: new THREE.Color(0, 0, 0) },
        uRim: { value: new THREE.Color(0, 0, 0) },
        uRimPow: { value: 3 },
        uSweepColor: { value: new THREE.Color(0, 0, 0) },
        uSweepDir: { value: new THREE.Vector3(1, 0.35, 0).normalize() },
        uSweepPos: { value: -1000 },
        uSweepWidth: { value: 0.35 },
        uOpacity: { value: 1 },
        uRevealDir: { value: new THREE.Vector3(0, 1, 0) },
        uReveal: { value: 1e6 },
        uRevealEdge: { value: 0.08 },
        uEdgeColor: { value: new THREE.Color(0, 0, 0) },
        uMatRot: { value: 0 },
        uGradTop: { value: new THREE.Color(0, 0, 0) },
        uGradBot: { value: new THREE.Color(0, 0, 0) },
        uGradH: { value: 1 },
      },
    ]),
    vertexShader: CHROME_VERT,
    fragmentShader: CHROME_FRAG,
    fog: o.fog ?? true,
    transparent: o.transparent ?? false,
    side: o.side ?? THREE.FrontSide,
    depthWrite: o.depthWrite ?? true,
  });
  m.uniforms.uMatcap.value = makeMatcap(o.matcap || 'chrome');
  if (o.tint) m.uniforms.uTint.value.set(o.tint);
  if (o.emissive) m.uniforms.uEmissive.value.set(o.emissive).multiplyScalar(o.emissiveIntensity ?? 1);
  if (o.rim) m.uniforms.uRim.value.set(o.rim).multiplyScalar(o.rimIntensity ?? 1);
  if (o.rimPow) m.uniforms.uRimPow.value = o.rimPow;
  if (o.sweepColor) m.uniforms.uSweepColor.value.set(o.sweepColor).multiplyScalar(o.sweepIntensity ?? 1);
  if (o.edgeColor) m.uniforms.uEdgeColor.value.set(o.edgeColor).multiplyScalar(o.edgeIntensity ?? 1);
  if (o.gradTop) m.uniforms.uGradTop.value.set(o.gradTop).multiplyScalar(o.gradIntensity ?? 1);
  if (o.gradBot) m.uniforms.uGradBot.value.set(o.gradBot).multiplyScalar(o.gradIntensity ?? 1);
  if (o.gradH) m.uniforms.uGradH.value = o.gradH;
  return m;
}

// Material emissivo simples (HDR) com opacidade, para linhas/neons/painéis.
export function glowMaterial(color, intensity = 1, o = {}) {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    transparent: o.transparent ?? true,
    opacity: o.opacity ?? 1,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: o.depthWrite ?? !o.additive,
    side: o.side ?? THREE.FrontSide,
    fog: o.fog ?? true,
    toneMapped: false,
  });
  return m;
}
