// Shaders do compositor. Tudo em espaço de display (sRGB) com HDR (>1) só nos brilhos dos efeitos;
// o bloom pega apenas o que passa de ~1.0, então o vídeo original não "estoura".

export const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const COMMON = /* glsl */ `
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h31(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 h33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

float vn2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float fbm3L(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ───────────────────────────── bloom (dual filter) ─────────────────────────────
export const BLOOM_PRE = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
vec3 pf(vec3 c) {
  c = min(c, vec3(32.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec3 c = pf(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  c += pf(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  c += pf(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  c += pf(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

export const BLOOM_DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uHalf; varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv - uHalf).rgb;
  s += texture2D(tSrc, vUv + uHalf).rgb;
  s += texture2D(tSrc, vUv + vec2(uHalf.x, -uHalf.y)).rgb;
  s += texture2D(tSrc, vUv - vec2(uHalf.x, -uHalf.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

export const BLOOM_UP = /* glsl */ `
uniform sampler2D tLow; uniform sampler2D tCur; uniform vec2 uHalf; uniform float uScatter; varying vec2 vUv;
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

// ───────────────────────────── final: distorção, CA, bloom, grade, grão ─────────────────────────────
export const FINAL = /* glsl */ `
uniform sampler2D tComp; uniform sampler2D tBloom;
uniform vec2 uRes; uniform float uSeed;
uniform float uBloom;
uniform float uChroma;
uniform vec2 uShake;           // deslocamento (uv)
uniform vec4 uRipple;          // cx, cy, raio (altura), força
uniform vec4 uZoom;            // cx, cy, força do blur radial, zoom
uniform vec3 uFlash; uniform float uFlashAmt;
uniform float uVignette; uniform float uGrain; uniform float uSat; uniform float uContrast; uniform vec3 uLift; uniform vec3 uGain;
uniform float uFade;
varying vec2 vUv;
${COMMON}
vec3 shoulder(vec3 c) {
  // joelho suave: abaixo de 0.88 não altera nada (mantém o vídeo original), acima comprime sem estourar
  vec3 k = vec3(0.88);
  vec3 over = max(c - k, 0.0);
  vec3 o = k + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
  return mix(c, o, step(k, c));
}
vec3 sceneAt(vec2 uv, float ca) {
  vec2 d = (uv - 0.5) * ca;
  return vec3(texture2D(tComp, uv + d).r, texture2D(tComp, uv).g, texture2D(tComp, uv - d).b);
}
void main() {
  float asp = uRes.y / uRes.x;
  vec2 uv = vUv + uShake;
  // zoom/punch
  uv = (uv - 0.5) / uZoom.w + 0.5;
  // onda de choque (refração)
  if (uRipple.w > 0.0005) {
    vec2 d = (uv - uRipple.xy) * vec2(1.0, asp);
    float r = length(d);
    float w = exp(-pow((r - uRipple.z) / 0.09, 2.0));
    uv += normalize(d + 1e-6) * w * uRipple.w * vec2(1.0, 1.0 / asp) * 0.05;
  }
  float ca = uChroma;
  vec3 col;
  if (uZoom.z > 0.002) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      float f = float(i) / 9.0;
      vec2 suv = (uv - uZoom.xy) * (1.0 - uZoom.z * f) + uZoom.xy;
      acc += sceneAt(suv, ca * (1.0 + f * 2.0));
    }
    col = acc / 10.0;
  } else col = sceneAt(uv, ca);
  col += texture2D(tBloom, uv).rgb * uBloom;
  col = shoulder(col);
  // grade leve
  float l = lum(col);
  col = mix(vec3(l), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  col = col * uGain + uLift * (1.0 - col);
  // vinheta
  vec2 vv = (vUv - 0.5) * vec2(1.0, asp * 0.7);
  col *= 1.0 - uVignette * smoothstep(0.28, 0.95, length(vv) * 1.3);
  col = mix(col, uFlash, clamp(uFlashAmt, 0.0, 1.0));
  // grão fino + dither (evita banding no espaço escuro depois da compressão)
  float g = h21(gl_FragCoord.xy + fract(uSeed * 0.6180339) * 1000.0) + h21(gl_FragCoord.yx * 1.31 + uSeed) - 1.0;
  col += g * (uGrain * (0.55 + 0.45 * (1.0 - l)) + 1.5 / 255.0);
  col *= 1.0 - uFade;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ───────────────────────────── composição ─────────────────────────────
// ordem (de trás para frente):  vídeo → MUNDO (espaço/buraco negro/supernova) → LEGENDA → PESSOA (matte) → luz → FG (mágica)
export const COMP = /* glsl */ `
uniform sampler2D tFoot; uniform sampler2D tMatte; uniform sampler2D tWorld; uniform sampler2D tCap; uniform sampler2D tFg;
uniform vec2 uRes; uniform float uT;
uniform vec4 uLightA;  // x,y (uv), raio (px), intensidade
uniform vec4 uLightB;
uniform vec3 uTintA; uniform vec3 uTintB;
uniform float uRelight;                 // 0..1  quanto o "mundo" ilumina a pessoa (espaço)
uniform vec3 uRimCol; uniform vec2 uRimDir; uniform float uRimAmt;
uniform float uFgGain;
uniform float uExposure;
uniform vec2 uMatte;                    // lo, hi (contraste da máscara)
uniform float uCapOcc;
varying vec2 vUv;
${COMMON}

float matteAt(vec2 uv) {
  float m = texture2D(tMatte, uv).r;
  return smoothstep(uMatte.x, uMatte.y, m);
}
float lightFall(vec2 uv, vec4 L) {
  if (L.w <= 0.0) return 0.0;
  vec2 d = (uv - L.xy) * uRes;
  float r = length(d) / max(L.z, 1.0);
  return L.w / (1.0 + r * r * 2.2);
}

void main() {
  vec2 uv = vUv;
  vec2 px = 1.0 / uRes;
  vec3 foot = texture2D(tFoot, uv).rgb * uExposure;
  float a = matteAt(uv);

  vec4 world = texture2D(tWorld, uv);
  vec3 bg = foot * (1.0 - world.a) + world.rgb;

  // legenda "atrás da cabeça": entra entre o fundo e a pessoa; escurece perto da silhueta (oclusão ambiente)
  vec4 cap = texture2D(tCap, uv);
  if (cap.a > 0.001) {
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float ang = float(i) * 0.5236;
      float rad = (i < 6 ? 34.0 : 78.0);
      occ += texture2D(tMatte, uv + vec2(cos(ang), sin(ang)) * rad * px).r;
    }
    occ /= 12.0;
    bg = bg * (1.0 - cap.a) + cap.rgb * (1.0 - uCapOcc * occ);
  }

  // pessoa
  vec3 pc = foot;
  float inner = 0.0;
  vec2 grad = vec2(0.0);
  if (uRelight > 0.001 || uRimAmt > 0.001) {
    // silhueta: média da máscara num anel → borda interna; gradiente aponta para fora
    float mavg = 0.0;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7854;
      vec2 o = vec2(cos(ang), sin(ang));
      float m = texture2D(tMatte, uv + o * 17.0 * px).r;
      mavg += m; grad += o * (1.0 - m);
    }
    mavg /= 8.0;
    inner = a * clamp(1.0 - mavg * 1.15, 0.0, 1.0);
    grad = normalize(grad + vec2(1e-4));
    // luz ambiente do mundo (média grosseira em volta)
    vec3 amb = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7854 + 0.3;
      amb += texture2D(tWorld, uv + vec2(cos(ang), sin(ang)) * 90.0 * px).rgb;
    }
    amb /= 8.0;
    float l0 = lum(pc);
    pc = pc * (1.0 - 0.06 * uRelight) + amb * (0.30 + 0.9 * (1.0 - l0)) * 0.17 * uRelight * (0.35 + 0.65 * smoothstep(0.0, 0.5, 1.0 - l0));
    float facing = pow(clamp(dot(grad, uRimDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
    pc += uRimCol * pow(inner, 1.1) * facing * uRimAmt * 0.75;
  }
  vec3 col = mix(bg, pc, a);

  // luz dos orbes sobre tudo (vídeo + pessoa)
  float la = lightFall(uv, uLightA), lb = lightFall(uv, uLightB);
  col += col * (uTintA * la + uTintB * lb) * 1.35 + (uTintA * la + uTintB * lb) * 0.05;

  // FG: camada de efeitos aditiva (canvas 2D, premultiplicada)
  col += texture2D(tFg, uv).rgb * uFgGain;
  gl_FragColor = vec4(col, 1.0);
}`;
