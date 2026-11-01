import { COMMON } from './shaders.js';

// MUNDO (atrás da pessoa): portal de teleporte → espaço (estrelas, nebulosa, planeta) → buraco negro (lente
// gravitacional por traçado de raios, pseudo-Schwarzschild) → supernova. Saída: rgb premultiplicado + alpha (máscara do portal).
export const WORLD = /* glsl */ `
uniform vec2 uRes; uniform float uT;
uniform vec4 uPortal;   // cx, cy (uv), raio (em alturas), suavidade
uniform float uWarp;    // 0..1 — estrelas esticadas (salto hiperespacial)
uniform vec4 uCam;      // yaw, pitch, -, zoom
uniform vec4 uBH;       // cx, cy (uv), distância Dc (rs), fase do giro   (Dc>=900 → sem buraco negro)
uniform vec4 uBH2;      // intensidade do disco, idade da onda (s; <0 = nenhuma), colapso (0..1), -
uniform vec4 uSN;       // cx, cy (uv), idade desde a explosão (s; <0 = pré-explosão), força da pré-explosão
uniform vec4 uSN2;      // brilho global, -, -, -
uniform vec4 uPl;       // planeta: cx, cy (uv), raio (alturas), visibilidade
varying vec2 vUv;
${COMMON}

const float TANF = 0.466;
const float PI = 3.14159265;

vec3 camRot(vec3 d) {
  float cy = cos(uCam.x), sy = sin(uCam.x), cp = cos(uCam.y), sp = sin(uCam.y);
  d = vec3(cy * d.x + sy * d.z, d.y, -sy * d.x + cy * d.z);
  return vec3(d.x, cp * d.y - sp * d.z, sp * d.y + cp * d.z);
}
vec3 camDir0(vec2 p) { return normalize(vec3(p * TANF * uCam.w, 1.0)); }

// ───────── estrelas (camadas de células 3D; o raio varia conforme a esfera corta a célula) ─────────
vec3 starLayer(vec3 d, float S, float density, float size, float seed, float boost) {
  vec3 p = d * S;
  vec3 c = floor(p);
  float h = h31(c + seed);
  if (h > density) return vec3(0.0);
  vec3 o = 0.22 + 0.56 * h33(c + seed * 1.7);
  float dd = length(p - c - o);
  float r = size * (0.65 + 0.7 * h31(c + seed + 4.0));
  float s = smoothstep(r, 0.0, dd);
  vec3 tint = mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.80, 0.58), h31(c + seed + 9.0));
  tint = mix(tint, vec3(1.0), 0.35);
  float tw = 0.78 + 0.22 * sin(uT * (2.0 + 6.0 * h31(c + seed + 2.0)) + h * 60.0);
  float br = 0.55 + 3.2 * pow(h31(c + seed + 6.0), 4.0);
  return tint * s * s * br * tw * boost;
}
vec3 starsAll(vec3 d) {
  vec3 c = starLayer(d, 340.0, 0.40, 0.20, 1.0, 0.6);
  c += starLayer(d, 150.0, 0.34, 0.20, 7.0, 1.0);
  c += starLayer(d, 62.0, 0.26, 0.15, 13.0, 1.6);
  return c;
}

// ───────── nebulosa ─────────
vec3 nebula(vec3 d) {
  vec3 q = d * 2.3 + vec3(0.0, 0.0, uT * 0.006);
  float w = fbm3L(q * 1.2 + 5.0);
  q += (w - 0.5) * 1.5;
  float n = fbm3(q * 1.5);
  float m = smoothstep(0.30, 0.78, n);
  float n2 = fbm3(q * 2.4 + 11.0);
  float n3 = fbm3L(q * 0.9 + 20.0);
  vec3 c1 = vec3(0.16, 0.05, 0.50);
  vec3 c2 = vec3(0.92, 0.22, 0.52);
  vec3 c3 = vec3(0.06, 0.52, 0.86);
  vec3 col = mix(c1, c2, smoothstep(0.30, 0.80, n2));
  col = mix(col, c3, smoothstep(0.50, 0.88, n3));
  float dust = smoothstep(0.35, 0.7, fbm3L(q * 3.1 + 40.0));
  return col * m * (0.35 + 1.15 * n2) * (1.0 - 0.4 * dust) * 1.05;
}

vec3 envSpace(vec3 d) {
  vec3 col = vec3(0.004, 0.006, 0.016) + vec3(0.01, 0.006, 0.02) * (0.5 + 0.5 * d.y);
  col += nebula(d);
  col += starsAll(d);
  return col;
}

// ───────── planeta com anéis (sprite 2D, na posição "de origem" do raio) ─────────
vec4 planet(vec2 p) {
  float asp = uRes.x / uRes.y;
  vec2 c = (uPl.xy - 0.5) * vec2(asp, 1.0) * 2.0;
  float R = uPl.z * 2.0;
  vec2 q = (p - c) / R;
  vec3 col = vec3(0.0); float a = 0.0;
  vec2 qr = rot(-0.38) * q;
  vec2 e = qr / vec2(1.0, 0.26);
  float rr = length(e);
  float ringMask = smoothstep(1.32, 1.36, rr) * (1.0 - smoothstep(2.25, 2.30, rr));
  float gap = 1.0 - 0.9 * smoothstep(0.018, 0.0, abs(rr - 1.78));
  float ringN = 0.55 + 0.45 * vn2(vec2(rr * 38.0, 3.0));
  vec3 ringCol = mix(vec3(0.92, 0.80, 0.62), vec3(0.6, 0.5, 0.45), ringN) * (0.35 + 0.65 * ringN) * gap;
  float ringA = ringMask * 0.82;
  bool front = qr.y < 0.0;
  float r2 = dot(q, q);
  if (r2 < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - r2));
    vec3 L = normalize(vec3(0.7, 0.45, 0.6));
    float dif = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0); dif = dif * dif;
    float lat = n.y + 0.07 * vn2(vec2(n.x * 5.0 + uT * 0.02, n.y * 14.0));
    float bands = 0.5 + 0.5 * sin(lat * 22.0 + 2.0 * vn2(vec2(lat * 8.0, n.x * 3.0)));
    vec3 pc = mix(vec3(0.62, 0.34, 0.20), vec3(0.93, 0.74, 0.50), bands);
    pc = mix(pc, vec3(0.45, 0.30, 0.38), smoothstep(0.65, 1.0, vn2(vec2(lat * 5.0, 7.0))) * 0.5);
    float atm = pow(1.0 - n.z, 3.0);
    col = pc * dif * 1.25 + vec3(0.35, 0.5, 0.9) * atm * 0.9 * (0.3 + dif);
    a = smoothstep(1.0, 0.985, sqrt(r2));
    // sombra do planeta sobre os anéis (lado de trás) — simplificada
    if (front) { col = mix(col, ringCol * 1.1, ringA); }
  } else {
    // halo atmosférico
    float h = exp(-(sqrt(r2) - 1.0) * 14.0);
    col = vec3(0.3, 0.45, 0.9) * h * 0.25; a = h * 0.25;
    col = mix(col, ringCol, ringA); a = max(a, ringA);
  }
  return vec4(col, a * uPl.w);
}

// ───────── buraco negro: traçado de raios (aceleração -1.5 h² r̂ / r⁴, rs = 1) ─────────
// d0: direção da câmera (frame da câmera, antes do yaw/pitch). Retorna emissão do disco e direção final.
void blackHole(vec2 p, out vec3 emis, out float absorbed, out vec3 dOut, out float glow, out float trOut) {
  float asp = uRes.x / uRes.y;
  vec2 c = (uBH.xy - 0.5) * vec2(asp, 1.0) * 2.0;
  float Dc = uBH.z;
  vec2 q = (p - c) * TANF * uCam.w;
  vec3 d0 = camDir0(p);
  emis = vec3(0.0); absorbed = 0.0; glow = 0.0; dOut = d0; trOut = 1.0;
  float el = 0.31 + 0.05 * sin(uT * 0.4);
  float qm = length(q);
  // desvio analítico (campo fraco) — vale fora da região de traçado
  float b = max(qm * Dc, 0.001);
  float alpha = 2.0 / b + 2.945 / (b * b);
  vec3 dAn = normalize(d0 - vec3(q / max(qm, 1e-5), 0.0) * alpha);
  float qMax = 0.34 * 40.0 / Dc;
  if (qm > qMax * 1.05 || Dc > 800.0) { dOut = (Dc > 800.0) ? d0 : dAn; return; }

  vec3 ro = vec3(0.0, Dc * sin(el), -Dc * cos(el));
  vec3 f = -normalize(ro); vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f)); vec3 u = cross(f, r);
  vec3 vel = normalize(q.x * r + q.y * u + f);
  vec3 v0 = vel;
  vec3 pos = ro;
  vec3 hh = cross(pos, vel);
  float h2 = dot(hh, hh);
  float trans = 1.0;
  float minR = 1e9;
  const float RIN = 2.5, ROUT = 8.5;
  bool esc = false;
  for (int i = 0; i < 130; i++) {
    float r2 = dot(pos, pos); float rr = sqrt(r2);
    minR = min(minR, rr);
    if (rr < 1.0) { absorbed = 1.0; break; }
    if (rr > 120.0 && dot(pos, vel) > 0.0) { esc = true; break; }
    float dt = clamp(0.07 * rr, 0.03, 3.5);
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * rr);
    vel = normalize(vel + acc * dt);
    vec3 np = pos + vel * dt;
    if (pos.y * np.y < 0.0) {
      float k = pos.y / (pos.y - np.y);
      vec3 hit = mix(pos, np, k);
      float rd = length(hit.xz);
      if (rd > RIN && rd < ROUT) {
        float T = pow(RIN / rd, 0.78);
        float ang = atan(hit.z, hit.x);
        float om = 1.0 / (rd * sqrt(rd));
        float a2 = ang - uBH.w * om * 7.0;
        float str = fbm2(vec2(a2 * 3.2, rd * 2.4));
        float str2 = vn2(vec2(a2 * 9.0 + 3.0, rd * 7.0));
        float pat = 0.35 + 0.95 * smoothstep(0.25, 0.85, str) + 0.35 * str2;
        vec3 vd = normalize(vec3(-hit.z, 0.0, hit.x));
        float dop = clamp(1.0 + 0.62 * dot(vd, -vel) * min(1.0, 2.2 / sqrt(rd)), 0.35, 1.9);
        vec3 hot = mix(vec3(1.0, 0.30, 0.04), vec3(1.0, 0.82, 0.50), T);
        hot = mix(hot, vec3(1.0, 0.95, 0.9), pow(T, 2.5));
        hot = mix(hot, hot * vec3(0.75, 0.9, 1.25), clamp(dop - 1.0, 0.0, 1.0));
        float op = smoothstep(RIN, RIN + 0.35, rd) * (1.0 - smoothstep(ROUT - 2.6, ROUT, rd));
        vec3 em = hot * pat * pow(dop, 1.7) * (0.38 + 2.1 * pow(T, 1.7)) * op;
        emis += trans * em;
        trans *= 1.0 - 0.80 * op;
      }
    }
    pos = np;
  }
  if (!esc && absorbed < 0.5) { if (dot(pos, pos) < 9.0) absorbed = 1.0; }
  glow = exp(-pow((minR - 1.62) / 0.16, 2.0)) * (1.0 - absorbed);
  vec3 dv = vel - v0;
  vec3 dl = normalize(d0 + vec3(dot(dv, r), dot(dv, u), dot(dv, f)));
  // junta o traçado (centro) com o desvio analítico (borda) sem emenda visível
  float bl = smoothstep(qMax * 0.78, qMax * 1.02, qm);
  dOut = normalize(mix(dl, dAn, bl));
  emis *= (1.0 - bl);
  absorbed *= (1.0 - bl);
  glow *= (1.0 - bl);
  trOut = mix(trans, 1.0, bl);
}

// ───────── supernova (2D, em coordenadas p) ─────────
vec3 supernova(vec2 p) {
  float asp = uRes.x / uRes.y;
  vec2 c = (uSN.xy - 0.5) * vec2(asp, 1.0) * 2.0;
  vec2 d = p - c;
  float dist = length(d);
  float ang = atan(d.y, d.x);
  float age = uSN.z;
  vec3 col = vec3(0.0);
  if (age < 0.0) {
    // pré-explosão: estrela instável pulsando, anéis implodindo, espículas
    float k = uSN.w;
    float pul = 0.75 + 0.25 * sin(uT * (10.0 + 40.0 * k) );
    float core = exp(-dist * (60.0 - 30.0 * k)) * (1.0 + 7.0 * k) * pul;
    float halo = exp(-dist * 7.0) * (0.12 + 0.8 * k) * pul;
    float spike = 0.0;
    for (int i = 0; i < 3; i++) {
      float a = float(i) * PI / 3.0 + 0.3;
      vec2 dir = vec2(cos(a), sin(a));
      float along = abs(dot(d, dir)), perp = abs(d.x * dir.y - d.y * dir.x);
      spike += exp(-perp * 220.0) * exp(-along * 3.4) * (0.3 + 1.5 * k);
    }
    col = vec3(0.75, 0.85, 1.0) * core + vec3(0.45, 0.6, 1.0) * halo + vec3(0.8, 0.9, 1.0) * spike * pul * 0.5;
    // anéis de matéria sendo sugados
    for (int i = 0; i < 3; i++) {
      float ph = fract(uT * 1.1 + float(i) / 3.0);
      float rr = mix(0.55, 0.03, ph * ph);
      col += vec3(0.5, 0.65, 1.0) * exp(-pow((dist - rr) / 0.006, 2.0)) * k * 0.8 * sin(ph * PI);
    }
    return col * uSN2.x;
  }
  // pós-explosão
  float Rs = 0.04 + 1.15 * (1.0 - exp(-age * 1.35));             // raio da casca
  float w = 0.035 + 0.16 * sqrt(age + 0.0001);                   // espessura
  float fade = exp(-0.42 * max(age - 1.2, 0.0));
  vec2 pr = rot(age * 0.15) * d;
  float n = fbm2(pr * (3.2 / (0.35 + Rs)) + vec2(age * 0.6, 3.0));
  float n2 = fbm2(pr * (7.5 / (0.35 + Rs)) - vec2(0.0, age * 0.9) + 9.0);
  float rad = (dist - Rs) / w;
  float shell = exp(-rad * rad * (0.9 + 0.8 * (1.0 - n)));
  float dens = shell * (0.35 + 1.5 * n * n2);
  // cor ao longo da casca: interior quente → exterior frio
  vec3 hotc = vec3(1.0, 0.78, 0.46), midc = vec3(1.0, 0.38, 0.22), mag = vec3(0.95, 0.18, 0.55), outc = vec3(0.25, 0.45, 1.0);
  float cs = clamp(rad * 0.5 + 0.5 + (n - 0.5) * 0.5, 0.0, 1.0);
  vec3 gc = mix(mix(hotc, midc, smoothstep(0.0, 0.35, cs)), mix(mag, outc, smoothstep(0.55, 1.0, cs)), smoothstep(0.3, 0.7, cs));
  col += gc * dens * (1.3 + 1.7 / (1.0 + age * 1.6)) * fade;
  // gás interno (miolo) e brilho
  float inner = exp(-dist / (0.18 + 0.38 * age)) * (0.5 + 0.9 * fbm2(pr * 5.0 + age));
  col += mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.35, 0.3), clamp(age * 0.35, 0.0, 1.0)) * inner * (2.0 / (1.0 + age * 1.8)) * fade;
  // onda de choque (anel fino)
  col += vec3(1.0, 0.95, 0.9) * exp(-pow((dist - Rs * 1.06) / (0.008 + 0.01 * age), 2.0)) * 2.4 * fade;
  // filamentos radiais
  float fil = pow(vn2(vec2(ang * 22.0, dist * 3.0 - age * 2.0)), 3.0) * exp(-dist * 1.7) * (1.0 / (1.0 + age * 0.9));
  col += mix(vec3(1.0, 0.7, 0.5), vec3(0.6, 0.7, 1.0), dist) * fil * 3.2 * fade;
  // raios de luz (crepusculares) + estrela remanescente
  float rays = pow(vn2(vec2(ang * 9.0 + 3.0, uT * 0.35)), 2.0) * exp(-dist * 2.4);
  col += vec3(1.0, 0.8, 0.65) * rays * 1.4 * exp(-age * 0.9);
  col += vec3(1.0, 0.95, 0.9) * exp(-dist * 38.0) * (1.0 + 10.0 * exp(-age * 5.0));
  // detritos
  vec2 pc2 = vec2(ang * 70.0, (dist - age * 0.35) * 55.0);
  vec2 cell = floor(pc2); vec2 lf = fract(pc2) - 0.5;
  float db = step(0.982, h21(cell + 7.0)) * smoothstep(0.30, 0.0, length(lf)) * smoothstep(0.0, 0.2, dist) * exp(-dist * 1.4);
  col += vec3(1.0, 0.82, 0.62) * db * 2.4 * fade;
  return col * uSN2.x;
}

void main() {
  float asp = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(asp, 1.0) * 2.0;

  // ── máscara do portal ──
  vec2 pc = (uPortal.xy - 0.5) * vec2(asp, 1.0) * 2.0;
  float pd = length(p - pc) * 0.5;
  float ang = atan(p.y - pc.y, p.x - pc.x);
  float edgeN = (fbm2(vec2(ang * 3.0 + uT * 2.0, uT * 1.5)) - 0.5) * 0.05 * smoothstep(0.0, 0.3, uPortal.z) * (1.0 - smoothstep(0.8, 1.4, uPortal.z));
  pd += edgeN;
  float full = step(1.25, uPortal.z);
  float mask = full + (1.0 - full) * (1.0 - smoothstep(uPortal.z - uPortal.w, uPortal.z, pd)) * step(0.001, uPortal.z);
  float ring = (1.0 - full) * exp(-pow((pd - uPortal.z + uPortal.w * 0.5) / (0.012 + uPortal.w * 0.25), 2.0)) * step(0.001, uPortal.z);
  if (mask < 0.001 && ring < 0.001) { gl_FragColor = vec4(0.0); return; }

  // ── onda no espaço-tempo (quando o buraco negro nasce) ──
  vec2 pp = p;
  if (uBH2.y >= 0.0) {
    vec2 bc = (uBH.xy - 0.5) * vec2(asp, 1.0) * 2.0;
    float bd = length(p - bc);
    float wv = exp(-pow((bd - uBH2.y * 1.7) / 0.22, 2.0)) * exp(-uBH2.y * 1.1);
    pp += normalize(p - bc + 1e-5) * wv * 0.06;
  }

  // ── buraco negro / lente ──
  vec3 bhE = vec3(0.0); float bhAbs = 0.0; vec3 dCam = camDir0(pp); float bhGlow = 0.0; float bhTr = 1.0;
  if (uBH.z < 800.0) blackHole(pp, bhE, bhAbs, dCam, bhGlow, bhTr);
  vec3 dEnv = camRot(dCam);

  vec3 col;
  if (uWarp > 0.002) {
    // hiperespaço: estrelas esticadas radialmente + túnel luminoso
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      float f = float(i) / 13.0;
      vec2 ps = pp * (1.0 - uWarp * 0.62 * f);
      acc += starsAll(camRot(camDir0(ps))) * (1.0 - 0.55 * f);
    }
    acc = acc / 14.0 * (1.5 + uWarp * 9.0);
    col = envSpace(dEnv) * (1.0 - 0.6 * uWarp) * 0.6 + acc;
    float rr = length(pp);
    col += mix(vec3(0.5, 0.7, 1.0), vec3(0.9, 0.5, 1.0), clamp(rr, 0.0, 1.0)) * exp(-rr * 2.6) * uWarp * 1.4;
  } else {
    col = envSpace(dEnv);
  }

  // planeta (posicionado na origem do raio, então também sofre a lente)
  vec2 pSrc = (dCam.z > 0.05) ? dCam.xy / dCam.z / (TANF * uCam.w) : pp;
  vec4 pl = planet(pSrc);
  col = col * (1.0 - pl.a) + pl.rgb;

  // buraco negro: disco de acreção e sombra
  if (uBH.z < 800.0) {
    float coll = uBH2.z;
    col = col * mix(1.0, bhTr, uBH2.x) * (1.0 - bhAbs * uBH2.x) + bhE * uBH2.x * (1.0 - coll * 0.5);
    col += vec3(1.0, 0.85, 0.6) * bhGlow * 0.55 * uBH2.x;
  }

  // supernova
  if (uSN2.x > 0.0) col += supernova(p);

  // ── composição do portal ──
  vec3 ringc = mix(vec3(0.45, 0.8, 1.0), vec3(1.0, 1.0, 1.0), 0.5) * ring * 5.0;
  gl_FragColor = vec4(col * mask + ringc, mask);
}`;
