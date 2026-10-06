import * as THREE from 'three';

// Pós-processamento enxuto (pensado para rodar até em renderização por software):
//  1) bloom dual-filter (Kawase) em meia resolução, 6 níveis
//  2) composição final única: motion blur direcional/zoom, aberração cromática,
//     glitch, punch de lente, tonemap ACES, grade, vinheta, scanlines, grão e flash.

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tHud;
uniform float uHudBloom;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 pf(vec3 c) {
  c = min(c, vec3(24.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
vec3 comp(vec2 uv) {
  vec4 h = texture2D(tHud, uv) * uHudBloom;
  return texture2D(tSrc, uv).rgb * (1.0 - h.a) + h.rgb;
}
void main() {
  vec3 c = pf(comp(vUv + uTexel * vec2(-1.0, -1.0)));
  c += pf(comp(vUv + uTexel * vec2(1.0, -1.0)));
  c += pf(comp(vUv + uTexel * vec2(-1.0, 1.0)));
  c += pf(comp(vUv + uTexel * vec2(1.0, 1.0)));
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uHalf;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv - uHalf).rgb;
  s += texture2D(tSrc, vUv + uHalf).rgb;
  s += texture2D(tSrc, vUv + vec2(uHalf.x, -uHalf.y)).rgb;
  s += texture2D(tSrc, vUv - vec2(uHalf.x, -uHalf.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tCur;
uniform vec2 uHalf;
uniform float uScatter;
varying vec2 vUv;
void main() {
  vec2 h = uHalf;
  vec3 s = texture2D(tLow, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture2D(tLow, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(tLow, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture2D(tLow, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture2D(tLow, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture2D(tLow, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(tLow, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture2D(tLow, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 * uScatter + texture2D(tCur, vUv).rgb, 1.0);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tHud;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uSeed;
uniform vec2 uBlurDir;
uniform float uZoomBlur;
uniform vec2 uZoomCenter;
uniform float uChroma;
uniform float uBloom;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uTint;
uniform vec3 uLift;
uniform float uVignette;
uniform float uGrain;
uniform float uScan;
uniform float uGlitch;
uniform vec3 uFlash;
uniform float uFlashAmt;
uniform float uPunch;
uniform float uInvert;
uniform float uFade;
varying vec2 vUv;

float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 sceneAt(vec2 uv, float ca) {
  if (ca < 0.00025) return texture2D(tScene, uv).rgb;
  vec2 d = (uv - 0.5) * vec2(1.0, uRes.y / uRes.x) * ca;
  d.y *= uRes.x / uRes.y;
  return vec3(texture2D(tScene, uv + d).r, texture2D(tScene, uv).g, texture2D(tScene, uv - d).b);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.y / uRes.x;
  // punch de lente (barril) — impacto
  if (abs(uPunch) > 0.0001) {
    vec2 cc = (uv - 0.5) * vec2(1.0, aspect);
    float r2 = dot(cc, cc);
    uv = 0.5 + (uv - 0.5) * (1.0 - uPunch * r2 * 0.6) / (1.0 - uPunch * 0.25);
  }
  // glitch: faixas horizontais deslocadas + blocos
  float gBand = 0.0;
  if (uGlitch > 0.001) {
    float band = floor(uv.y * 28.0 + h12(vec2(uSeed, 1.7)) * 9.0);
    float r = h12(vec2(band, uSeed));
    if (r < uGlitch * 0.55) {
      uv.x += (h12(vec2(band, uSeed + 3.1)) - 0.5) * 0.16 * uGlitch;
      gBand = 1.0;
    }
    vec2 blk = floor(uv * vec2(10.0, 30.0) + uSeed);
    if (h12(blk + 0.37) < uGlitch * 0.12) {
      uv += (vec2(h12(blk + 1.7), h12(blk + 4.1)) - 0.5) * 0.06;
      gBand = 1.0;
    }
  }
  float ca = uChroma * (1.0 + gBand * 6.0 + uGlitch * 2.0);
  vec3 col;
  float blurLen = length(uBlurDir) + abs(uZoomBlur);
  if (blurLen > 0.0006) {
    // nº de amostras adaptativo (rastros curtos custam pouco); CA só se houver glitch
    float nt = clamp(floor(blurLen * 900.0) + 3.0, 3.0, 13.0);
    float cab = gBand > 0.5 || uGlitch > 0.05 ? ca : 0.0;
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    for (int i = 0; i < 13; i++) {
      if (float(i) >= nt) break;
      float f = float(i) / (nt - 1.0) - 0.5;
      vec2 suv = uv + uBlurDir * f + (uv - uZoomCenter) * (uZoomBlur * f);
      float w = 1.0 - abs(f) * 0.9;
      acc += (cab > 0.0 ? sceneAt(suv, cab) : texture2D(tScene, suv).rgb) * w;
      ws += w;
    }
    col = acc / ws;
  } else {
    col = sceneAt(uv, ca);
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  col = toSRGB(col);
  // grade (em espaço de display)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col = col * uTint + uLift * (1.0 - col);
  // glitch: troca de canais em algumas faixas
  if (gBand > 0.5 && h12(vec2(floor(vUv.y * 40.0), uSeed + 9.0)) < 0.3) col = col.brg;
  // vinheta
  vec2 vv = (vUv - 0.5) * vec2(1.0, aspect * 0.62);
  col *= 1.0 - uVignette * smoothstep(0.25, 0.95, length(vv) * 1.25);
  // HUD (texto/UI): composto já em espaço de display → cores exatas da marca
  vec4 hud = texture2D(tHud, uv);
  if (ca > 0.0004) {
    vec2 dh = (uv - 0.5) * ca * 0.6;
    hud.r = texture2D(tHud, uv + dh).r;
    hud.b = texture2D(tHud, uv - dh).b;
  }
  if (hud.a > 0.0005) {
    vec3 hc = hud.rgb / max(hud.a, 1e-4);
    hc = toSRGB(clamp(hc, 0.0, 1.0)) + max(hc - 1.0, 0.0) * 0.25;
    col = col * (1.0 - clamp(hud.a, 0.0, 1.0)) + hc * hud.a;
  }
  // scanlines (a cada 3 px)
  col *= 1.0 - uScan * step(2.0, mod(gl_FragCoord.y, 3.0));
  // grão + dither (evita banding nos gradientes escuros após compressão)
  float g = h12(gl_FragCoord.xy + fract(uSeed * 0.6180339) * 1000.0) + h12(gl_FragCoord.yx * 1.31 + uSeed) - 1.0;
  col += g * (uGrain * (0.6 + 0.4 * (1.0 - l)) + 1.5 / 255.0);
  col = mix(col, uFlash, clamp(uFlashAmt, 0.0, 1.0));
  col = mix(col, vec3(1.0) - col, uInvert);
  col *= 1.0 - uFade;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FS_VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
  });
}

export class Post {
  constructor(renderer, w, h) {
    this.renderer = renderer;
    this.w = w;
    this.h = h;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.levels = [];
    let lw = Math.round(w / 2), lh = Math.round(h / 2);
    for (let i = 0; i < 6; i++) {
      this.levels.push({ rt: new THREE.WebGLRenderTarget(lw, lh, opt), up: new THREE.WebGLRenderTarget(lw, lh, opt), w: lw, h: lh });
      lw = Math.max(1, Math.round(lw / 2));
      lh = Math.max(1, Math.round(lh / 2));
    }
    this.mPre = fsMaterial(PREFILTER, { tSrc: { value: null }, tHud: { value: null }, uHudBloom: { value: 0.6 }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 }, uKnee: { value: 0.5 } });
    this.mDown = fsMaterial(DOWN, { tSrc: { value: null }, uHalf: { value: new THREE.Vector2() } });
    this.mUp = fsMaterial(UP, { tLow: { value: null }, tCur: { value: null }, uHalf: { value: new THREE.Vector2() }, uScatter: { value: 0.85 } });
    this.mFinal = fsMaterial(FINAL, {
      tScene: { value: null },
      tHud: { value: null },
      tBloom: { value: null },
      uRes: { value: new THREE.Vector2(w, h) },
      uSeed: { value: 0 },
      uBlurDir: { value: new THREE.Vector2() },
      uZoomBlur: { value: 0 },
      uZoomCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uChroma: { value: 0 },
      uBloom: { value: 1 },
      uExposure: { value: 1 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uLift: { value: new THREE.Color(0, 0, 0) },
      uVignette: { value: 0.3 },
      uGrain: { value: 0.03 },
      uScan: { value: 0.05 },
      uGlitch: { value: 0 },
      uFlash: { value: new THREE.Color(1, 1, 1) },
      uFlashAmt: { value: 0 },
      uPunch: { value: 0 },
      uInvert: { value: 0 },
      uFade: { value: 0 },
    });
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  bloom(src, fx) {
    const L = this.levels;
    this.mPre.uniforms.tSrc.value = src;
    this.mPre.uniforms.uTexel.value.set(0.5 / L[0].w, 0.5 / L[0].h);
    this.mPre.uniforms.uThreshold.value = fx.threshold;
    this.mPre.uniforms.uKnee.value = fx.knee;
    this.pass(this.mPre, L[0].rt);
    for (let i = 1; i < L.length; i++) {
      this.mDown.uniforms.tSrc.value = L[i - 1].rt.texture;
      this.mDown.uniforms.uHalf.value.set(0.5 / L[i - 1].w, 0.5 / L[i - 1].h);
      this.pass(this.mDown, L[i].rt);
    }
    let low = L[L.length - 1].rt.texture;
    for (let i = L.length - 2; i >= 0; i--) {
      this.mUp.uniforms.tLow.value = low;
      this.mUp.uniforms.tCur.value = L[i].rt.texture;
      this.mUp.uniforms.uHalf.value.set(0.5 / L[i + 1].w, 0.5 / L[i + 1].h);
      this.mUp.uniforms.uScatter.value = fx.scatter;
      this.pass(this.mUp, L[i].up);
      low = L[i].up.texture;
    }
    return low;
  }

  render(src, hud, fx, frameSeed) {
    this.mPre.uniforms.tHud.value = hud;
    this.mPre.uniforms.uHudBloom.value = fx.hudBloom;
    const bloomTex = this.bloom(src, fx);
    const u = this.mFinal.uniforms;
    u.tScene.value = src;
    u.tHud.value = hud;
    u.tBloom.value = bloomTex;
    u.uSeed.value = frameSeed;
    // limita o rastro para manter legibilidade mesmo nos movimentos mais violentos
    const bl = Math.hypot(fx.blur[0], fx.blur[1]);
    const k = bl > fx.maxBlur ? fx.maxBlur / bl : 1;
    u.uBlurDir.value.set(fx.blur[0] * k, fx.blur[1] * k);
    u.uZoomBlur.value = Math.max(-0.4, Math.min(0.4, fx.zoomBlur));
    u.uZoomCenter.value.set(fx.zoomCenter[0], fx.zoomCenter[1]);
    u.uChroma.value = fx.chroma;
    u.uBloom.value = fx.bloom / 5; // normaliza a soma dos níveis
    u.uExposure.value = fx.exposure;
    u.uContrast.value = fx.contrast;
    u.uSaturation.value = fx.saturation;
    u.uTint.value.setRGB(fx.tint[0], fx.tint[1], fx.tint[2]);
    u.uLift.value.setRGB(fx.lift[0], fx.lift[1], fx.lift[2]);
    u.uVignette.value = fx.vignette;
    u.uGrain.value = fx.grain;
    u.uScan.value = fx.scan;
    u.uGlitch.value = fx.glitch;
    u.uFlash.value.setRGB(fx.flashColor[0], fx.flashColor[1], fx.flashColor[2]);
    u.uFlashAmt.value = fx.flash;
    u.uPunch.value = fx.punch;
    u.uInvert.value = fx.invert;
    u.uFade.value = fx.fade;
    this.pass(this.mFinal, null);
  }
}
