import * as THREE from 'three';

// Texto 2D renderizado em canvas → textura → plano. Unidade = 1 px do quadro 1080×1920
// (quando usado no HUD ortográfico). Suporta máscara (clip), blur por mip, skew, wipe e
// cores HDR (intensidade > 1 para o bloom pegar).

const VERT = /* glsl */ `
uniform float uSkew;
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x += p.y * uSkew;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec4 uClip;      // xmin, ymin, xmax, ymax (coordenadas de mundo)
uniform float uBlur;     // bias de mip (0 = nítido)
uniform vec4 uWipe;      // x: progresso 0..1, y: suavidade, zw: direção em uv
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  if (vWorld.x < uClip.x || vWorld.y < uClip.y || vWorld.x > uClip.z || vWorld.y > uClip.w) discard;
  vec4 tex = texture2D(map, vUv, uBlur);
  float a = uOpacity;
  if (uWipe.x < 1.0) {
    vec2 d = normalize(uWipe.zw);
    float coord = dot(vUv - 0.5, d) + 0.5; // 0..1 ao longo da direção
    a *= 1.0 - smoothstep(uWipe.x - uWipe.y, uWipe.x, coord * (1.0 - uWipe.y) + uWipe.y * 0.5);
  }
  gl_FragColor = vec4(tex.rgb * uColor, tex.a) * a;
}`;

const NO_CLIP = new THREE.Vector4(-1e6, -1e6, 1e6, 1e6);

export function makeTextMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 },
      uClip: { value: NO_CLIP.clone() },
      uBlur: { value: 0 },
      uSkew: { value: 0 },
      uWipe: { value: new THREE.Vector4(1, 0.05, 1, 0) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

const fontStr = (o, ss) => `${o.weight} ${o.size * ss}px "${o.family}"`;

function measureCtx() {
  if (!measureCtx.ctx) measureCtx.ctx = document.createElement('canvas').getContext('2d');
  return measureCtx.ctx;
}

// Mede uma string com as opções dadas (em px finais, sem supersampling)
export function measureText(text, o) {
  const ctx = measureCtx();
  ctx.font = fontStr(o, 1);
  ctx.letterSpacing = `${o.letterSpacing || 0}px`;
  const m = ctx.measureText(text);
  return { width: m.width - (o.letterSpacing || 0), ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
}

const DEFAULTS = {
  family: 'Inter Tight',
  weight: 900,
  size: 100,
  color: '#ffffff',
  letterSpacing: 0,
  ss: 2,
  pad: 10,
  align: 'center', // left | center | right
  valign: 'middle', // middle | baseline | top | bottom
  bg: null, // { color, padX, padY, radius }
  stroke: null, // { width, color, fill: false }
  runs: null, // [{ text, color }]
  shadow: null, // { blur, color }
  underline: null,
};

// Desenha texto num canvas e devolve {canvas, w, h, ascent, descent} em px finais
export function rasterizeText(text, opts) {
  const o = { ...DEFAULTS, ...opts };
  const ss = o.ss;
  const runs = o.runs || [{ text, color: o.color }];
  const ctx0 = measureCtx();
  ctx0.font = fontStr(o, ss);
  ctx0.letterSpacing = `${o.letterSpacing * ss}px`;
  let total = 0;
  for (const r of runs) {
    r.w = ctx0.measureText(r.text).width;
    total += r.w;
  }
  total -= o.letterSpacing * ss; // remove espaçamento após o último caractere
  const fm = ctx0.measureText('ÁÇQjgp|');
  const ascent = fm.fontBoundingBoxAscent;
  const descent = fm.fontBoundingBoxDescent;
  const bgPadX = o.bg ? (o.bg.padX ?? 24) * ss : 0;
  const bgPadY = o.bg ? (o.bg.padY ?? 12) * ss : 0;
  const pad = o.pad * ss;
  const W = Math.ceil(total + 2 * (pad + bgPadX));
  const H = Math.ceil(ascent + descent + 2 * (pad + bgPadY));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, W);
  canvas.height = Math.max(2, H);
  const ctx = canvas.getContext('2d');
  if (o.bg) {
    ctx.fillStyle = o.bg.color;
    const r = (o.bg.radius ?? 0) * ss;
    ctx.beginPath();
    ctx.roundRect(pad, pad, W - 2 * pad, H - 2 * pad, r);
    ctx.fill();
    if (o.bg.stroke) {
      ctx.lineWidth = o.bg.stroke.width * ss;
      ctx.strokeStyle = o.bg.stroke.color;
      ctx.stroke();
    }
  }
  ctx.font = fontStr(o, ss);
  ctx.letterSpacing = `${o.letterSpacing * ss}px`;
  ctx.textBaseline = 'alphabetic';
  let x = pad + bgPadX;
  const y = pad + bgPadY + ascent;
  if (o.shadow) {
    ctx.shadowBlur = o.shadow.blur * ss;
    ctx.shadowColor = o.shadow.color;
  }
  for (const r of runs) {
    if (o.stroke) {
      ctx.lineWidth = o.stroke.width * ss;
      ctx.strokeStyle = r.stroke || o.stroke.color || r.color;
      ctx.lineJoin = 'round';
      ctx.strokeText(r.text, x, y);
      if (o.stroke.fill) {
        ctx.fillStyle = r.color;
        ctx.fillText(r.text, x, y);
      }
    } else {
      ctx.fillStyle = r.color;
      ctx.fillText(r.text, x, y);
    }
    if (o.underline) {
      ctx.fillStyle = o.underline.color || r.color;
      ctx.fillRect(x, y + o.underline.offset * ss, r.w - o.letterSpacing * ss, o.underline.width * ss);
    }
    x += r.w;
  }
  return {
    canvas,
    w: canvas.width / ss,
    h: canvas.height / ss,
    ascent: ascent / ss,
    descent: descent / ss,
    pad: o.pad + (o.bg ? o.bg.padY ?? 12 : 0),
    padX: o.pad + (o.bg ? o.bg.padX ?? 24 : 0),
    textWidth: total / ss,
  };
}

export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Um bloco de texto como um único plano.
export class Text2D extends THREE.Mesh {
  constructor(text, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const r = rasterizeText(text, o);
    const tex = canvasTexture(r.canvas);
    const geo = new THREE.PlaneGeometry(r.w, r.h);
    // âncora
    let ox = 0;
    if (o.align === 'left') ox = r.w / 2 - r.padX;
    else if (o.align === 'right') ox = -r.w / 2 + r.padX;
    let oy = 0;
    const baselineFromCenter = r.h / 2 - r.pad - r.ascent; // y do baseline relativo ao centro (y para cima)
    if (o.valign === 'baseline') oy = -baselineFromCenter;
    else if (o.valign === 'top') oy = -r.h / 2 + r.pad;
    else if (o.valign === 'bottom') oy = r.h / 2 - r.pad;
    else oy = -baselineFromCenter - capHeight(o) / 2; // 'middle' / 'cap': centro ótico da caixa-alta
    geo.translate(ox, oy, 0);
    super(geo, makeTextMaterial(tex));
    this.text = text;
    this.opts = o;
    this.w = r.textWidth;
    this.h = r.h;
    this.ascent = r.ascent;
    this.frustumCulled = false;
  }
  set opacity(v) {
    this.material.uniforms.uOpacity.value = v;
    this.visible = v > 0.001;
  }
  get opacity() {
    return this.material.uniforms.uOpacity.value;
  }
  setColor(c, intensity = 1) {
    this.material.uniforms.uColor.value.set(c).multiplyScalar(intensity);
    return this;
  }
  setClip(xmin, ymin, xmax, ymax) {
    this.material.uniforms.uClip.value.set(xmin, ymin, xmax, ymax);
    return this;
  }
  set blur(v) {
    this.material.uniforms.uBlur.value = v;
  }
  set skew(v) {
    this.material.uniforms.uSkew.value = v;
  }
  dispose() {
    this.geometry.dispose();
    this.material.uniforms.map.value.dispose();
    this.material.dispose();
  }
}

// Altura de versal aproximada para centralização ótica de caixa-alta
function capHeight(o) {
  const ctx = measureCtx();
  ctx.font = fontStr(o, 1);
  ctx.letterSpacing = '0px';
  const m = ctx.measureText('H');
  return m.actualBoundingBoxAscent;
}

// Linha com glifos independentes (para animação letra a letra).
// Cada glifo gira/escala em torno do próprio centro ótico.
export class TextGlyphs extends THREE.Group {
  constructor(text, opts = {}) {
    super();
    const o = { ...DEFAULTS, ...opts };
    const chars = [...text];
    const ctx = measureCtx();
    ctx.font = fontStr(o, 1);
    ctx.letterSpacing = `${o.letterSpacing}px`;
    const total = ctx.measureText(text).width - o.letterSpacing;
    const cap = capHeight(o);
    let start = o.align === 'left' ? 0 : o.align === 'right' ? -total : -total / 2;
    this.glyphs = [];
    this.w = total;
    this.cap = cap;
    let prefix = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const x0 = ctx.measureText(prefix).width;
      prefix += ch;
      const cw = ctx.measureText(ch).width - o.letterSpacing;
      if (ch === ' ') continue;
      const g = new Text2D(ch, { ...o, align: 'center', valign: 'cap', letterSpacing: 0, runs: null, color: (o.colorAt && o.colorAt(i, ch)) || o.color });
      g.position.x = start + x0 + cw / 2;
      g.userData.index = this.glyphs.length;
      g.userData.char = ch;
      g.userData.baseX = g.position.x;
      this.add(g);
      this.glyphs.push(g);
    }
  }
  forEach(fn) {
    this.glyphs.forEach(fn);
  }
  set opacity(v) {
    this.glyphs.forEach((g) => (g.opacity = v));
  }
  setClip(...a) {
    this.glyphs.forEach((g) => g.setClip(...a));
    return this;
  }
  setColor(c, i = 1) {
    this.glyphs.forEach((g) => g.setColor(c, i));
    return this;
  }
}
