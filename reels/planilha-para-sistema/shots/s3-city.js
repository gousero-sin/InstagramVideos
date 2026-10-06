import * as THREE from 'three';
import { Shot } from '../../../engine/stage.js';
import { ease, invLerp, clamp, lerp, hit, pulse, smoothstep } from '../../../engine/core/time.js';
import { hash, fbm1 } from '../../../engine/core/random.js';
import { applyPose, cameraBlur } from '../../../engine/camera.js';
import { makeGrid } from '../../../engine/gfx/grid.js';
import { Text2D } from '../../../engine/gfx/text2d.js';
import { slam, riseGlyphs, setBlur } from '../../../engine/anim.js';
import { S, txt, glyphs } from '../lib/type.js';
import { B, C, F, COPY } from '../config.js';

// SHOT 3 (11,25 → 15 s): CIDADE DE DADOS.
//  voo rasante a ~40 u/s por uma avenida de torres (janelas = dados acesos),
//  pacotes de luz nas ruas, etiquetas de métricas flutuando,
//  B28 curva "chicote" de 90° + "ZERO RETRABALHO.", subida e olhar pro céu → serviços.

const DEG = Math.PI / 180;
const CROSS_Z = -60;

const TOWER_VERT = /* glsl */ `
attribute vec4 aInfo; // altura, seed, destaque, 0
uniform float uTime;
uniform float uGrow;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vInfo;
varying float vLocalY;
varying vec2 vLocalXZ;
void main() {
  vInfo = aInfo;
  vec3 p = position;
  vLocalXZ = p.xz / 0.95;
  float h = aInfo.x * uGrow;
  p.y *= h;
  vLocalY = p.y;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const TOWER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uGrow;
uniform float uBeat;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vInfo;
varying float vLocalY;
varying vec2 vLocalXZ;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 n = normalize(vN);
  float h = vInfo.x * uGrow;
  vec3 base = vec3(0.007, 0.011, 0.009);
  vec3 col = base;
  float occ = 0.12 + 0.55 * fract(vInfo.y * 7.31);   // ocupação por prédio
  if (abs(n.y) < 0.5) {
    vec2 uv = abs(n.x) > 0.5 ? vec2(vWorld.z, vLocalY) : vec2(vWorld.x, vLocalY);
    vec2 cell = uv / vec2(0.36, 0.5);
    vec2 f = fract(cell);
    vec2 id = floor(cell);
    float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.75);
    float r = h21(id + vInfo.y * 91.7);
    float lit = step(1.0 - occ - vInfo.z * 0.2, r);
    float blink = step(0.5, fract(r * 13.7 + uTime * (0.5 + r)));
    lit *= mix(1.0, blink, step(0.97, r));
    float tone = h21(id + 3.1);
    vec3 wc = tone < 0.62 ? vec3(0.78, 0.9, 0.86) : (tone < 0.9 ? vec3(0.25, 1.0, 0.1) : vec3(1.0, 0.92, 0.75));
    col += win * lit * wc * (0.25 + 0.75 * h21(id + 7.3)) * (0.85 + 0.4 * uBeat);
    // faixa de "upload" subindo nos prédios em destaque
    float band = smoothstep(0.93, 1.0, fract(vLocalY * 0.05 - uTime * 0.8 + vInfo.y * 3.0));
    col += vec3(0.1, 0.9, 0.05) * band * 0.4 * vInfo.z;
    // arestas verticais (contorno tech)
    float along = abs(n.x) > 0.5 ? abs(vLocalXZ.y) : abs(vLocalXZ.x);
    col += vec3(0.12, 0.85, 0.06) * smoothstep(0.9, 0.99, along) * (0.25 + 0.6 * vInfo.z);
    // brilho do chão na base
    col += vec3(0.02, 0.12, 0.02) * (1.0 - smoothstep(0.0, 1.6, vLocalY));
  } else if (n.y > 0.5) {
    col = vec3(0.008, 0.014, 0.01);
  }
  // borda no topo
  col += vec3(0.25, 1.6, 0.12) * smoothstep(h - 0.12, h, vLocalY) * (0.4 + vInfo.z);
  float d = length(vWorld - cameraPosition);
  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));
  gl_FragColor = vec4(col, 1.0);
}`;

const PKT_VERT = /* glsl */ `
attribute vec4 aLane; // x/z do trilho, eixo (0 = z, 1 = x), velocidade
attribute vec2 aOff;
uniform float uTime;
varying float vA;
void main() {
  float L = 180.0;
  float s = mod(aOff.x * L + uTime * aLane.w, L) - L * 0.5;
  vec3 p = position;
  vec3 c;
  if (aLane.z < 0.5) { c = vec3(aLane.x, 0.06, s - 40.0); }
  else { p = p.zyx; c = vec3(s + 30.0, 0.06, aLane.y); }
  vA = aOff.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(c + p, 1.0);
}`;

const PKT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() { gl_FragColor = vec4(uColor * (0.6 + vA), 1.0); }`;

// pose: posição + yaw/pitch/roll
function poseAt(t) {
  // trecho 1: avenida (eixo -Z)
  const a = clamp(invLerp(B(24), B(28.15), t));
  const z = lerp(16, CROSS_Z + 1.5, ease.inOutSine(a) * 0.35 + a * 0.65);
  let pos = new THREE.Vector3(0, lerp(9, 1.7, ease.outExpo(clamp(invLerp(B(24), B(25), t)))), z);
  let yaw = 0;
  let pitch = lerp(-38, 5, ease.outExpo(clamp(invLerp(B(24), B(25), t)))) * DEG;
  let roll = Math.sin(t * 2.1) * 0.035;
  // curva chicote
  const w = clamp(invLerp(B(27.7), B(28.3), t));
  yaw = -90 * DEG * ease.whip(w);
  roll += Math.sin(w * Math.PI) * 0.22;
  // trecho 2: rua transversal (eixo +X), subindo
  const b = clamp(invLerp(B(28.0), B(31.5), t));
  if (b > 0) {
    pos.x = lerp(0, 66, ease.inOutSine(b) * 0.4 + b * 0.6);
    pos.z = CROSS_Z + 1.5 - 1.5 * smoothstep(0, 0.2, b);
    pos.y = lerp(1.7, 16, ease.inQuad(b));
    pitch = lerp(5, -12, ease.inOutSine(b)) * DEG;
  }
  // olhar para o céu → transição
  const up = clamp(invLerp(B(31.3), B(32), t));
  pitch += 92 * DEG * ease.inExpo(up);
  pos.y += 6 * ease.inExpo(up);
  // yaw 0 → olha para -Z; yaw -90° → olha para +X
  const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  pos.x += fbm1(t * 1.4, 31) * 0.08;
  pos.y += fbm1(t * 1.2, 32) * 0.06;
  return { pos, target: pos.clone().add(dir), roll, fov: lerp(78, 62, smoothstep(B(24), B(25), t)) + 8 * Math.sin(w * Math.PI), t };
}

export class ShotCity extends Shot {
  constructor(stage) {
    super(stage, { name: 'city', start: B(24), end: B(32), fov: 70, far: 260 });
    const sc = this.scene;

    this.grid = makeGrid({ cell: 1.2, major: 5, fade: 0.022, minor: 0.12, majorI: 0.45 });
    sc.add(this.grid);

    // anel de brilho no horizonte (silhueta da cidade)
    const hc = document.createElement('canvas');
    hc.width = 4;
    hc.height = 256;
    const hg = hc.getContext('2d');
    const gr = hg.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    hg.fillStyle = gr;
    hg.fillRect(0, 0, 4, 256);
    const htex = new THREE.CanvasTexture(hc);
    htex.colorSpace = THREE.SRGBColorSpace;
    this.horizon = new THREE.Mesh(
      new THREE.CylinderGeometry(170, 170, 70, 64, 1, true),
      new THREE.MeshBasicMaterial({ map: htex, color: new THREE.Color(C.green).multiplyScalar(0.3), side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    this.horizon.position.set(20, 30, -40);
    sc.add(this.horizon);

    // torres
    const lots = [];
    const S0 = 2.5;
    for (let ix = -14; ix <= 34; ix++) {
      for (let iz = -60; iz <= 8; iz++) {
        const x = ix * S0, z = iz * S0;
        if (Math.abs(x) < 4.2) continue; // avenida principal
        if (Math.abs(z - CROSS_Z) < 4.2 && x > -4) continue; // rua transversal
        if (ix % 5 === 0 || iz % 6 === 0) continue; // ruas menores
        const n = hash(ix * 131 + iz * 7, 4);
        const canyon = Math.exp(-Math.min(Math.abs(x), Math.abs(z - CROSS_Z) + (x < 0 ? 99 : 0)) / 9);
        let h = 1.5 + 7 * Math.pow(n, 2.2) + 9 * canyon * hash(ix + iz * 3, 9);
        if (hash(ix * 7 + iz, 12) > 0.965) h += 10;
        lots.push({ x, z, h, seed: hash(ix, iz), hi: hash(iz, ix) > 0.8 ? 1 : 0 });
      }
    }
    const geo = new THREE.BoxGeometry(1.9, 1, 1.9);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color(C.bg) }, uFogNear: { value: 25 }, uFogFar: { value: 120 }, uGrow: { value: 1 }, uBeat: { value: 0 } },
      vertexShader: TOWER_VERT,
      fragmentShader: TOWER_FRAG,
    });
    this.towers = new THREE.InstancedMesh(geo, mat, lots.length);
    const info = new Float32Array(lots.length * 4);
    const m4 = new THREE.Matrix4();
    lots.forEach((l, i) => {
      m4.makeTranslation(l.x, 0, l.z);
      this.towers.setMatrixAt(i, m4);
      info.set([l.h, l.seed, l.hi, 0], i * 4);
    });
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    this.towers.frustumCulled = false;
    sc.add(this.towers);

    // pacotes de luz nas ruas
    const N = 520;
    const pg = new THREE.InstancedBufferGeometry();
    const box = new THREE.BoxGeometry(0.05, 0.04, 1.7);
    pg.index = box.index;
    pg.setAttribute('position', box.getAttribute('position'));
    const lane = new Float32Array(N * 4), off = new Float32Array(N * 2);
    const lanesZ = [-2.6, -1.3, 1.3, 2.6, -12.5, 12.5, 25];
    const lanesX = [CROSS_Z - 2.6, CROSS_Z - 1.3, CROSS_Z + 1.3, CROSS_Z + 2.6, -30, -90];
    for (let i = 0; i < N; i++) {
      const alongX = hash(i, 5) < 0.42 ? 1 : 0;
      const lx = lanesZ[Math.floor(hash(i, 6) * lanesZ.length)];
      const lz = lanesX[Math.floor(hash(i, 7) * lanesX.length)];
      const dir = (alongX ? lz : lx) > (alongX ? CROSS_Z : 0) ? 1 : -1;
      lane.set([lx, lz, alongX, dir * (18 + hash(i, 8) * 40)], i * 4);
      off.set([hash(i, 9), hash(i, 10)], i * 2);
    }
    pg.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    pg.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
    pg.instanceCount = N;
    this.packets = new THREE.Mesh(
      pg,
      new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(C.green).multiplyScalar(1.2) } }, vertexShader: PKT_VERT, fragmentShader: PKT_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    this.packets.frustumCulled = false;
    sc.add(this.packets);

    // etiquetas de métricas flutuando (billboards)
    const labels = [
      ['+18,4% receita', -5.5, 7.5, -8],
      ['DRE ✓ fechado', 6, 9, -18],
      ['R$ 248.390', -6.5, 10, -28],
      ['estoque OK', 6.5, 6.5, -36],
      ['pedido #4821 ✓', -6, 8.5, -46],
      ['caixa: +R$ 12k', 7, 11, -52],
      ['meta 87%', 14, 9, CROSS_Z - 6],
      ['inadimplência ▼2%', 26, 12, CROSS_Z + 6],
      ['NPS 92', 38, 13, CROSS_Z - 7],
    ];
    this.labels = labels.map(([s, x, y, z], i) => {
      const g = new THREE.Group();
      const t2 = new Text2D(s, { family: F.mono, weight: 700, size: 30, color: '#04140a', bg: { color: C.green, padX: 14, padY: 6, radius: 8 }, ss: 2 });
      t2.material.depthTest = true;
      t2.scale.setScalar(0.0125);
      g.add(t2);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.03, y), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(0.8), transparent: true, opacity: 0.6, depthWrite: false }));
      line.position.y = -y / 2 - 0.35;
      g.add(line);
      g.position.set(x, y, z);
      g.userData = { t2, line, y, i };
      sc.add(g);
      return g;
    });

    // ── HUD ──
    const shadow = { blur: 30, color: 'rgba(0,0,0,0.92)' };
    this.c1 = glyphs(COPY.city[0], S.hook, { shadow, pad: 40, size: 124 });
    this.c2 = glyphs(COPY.city[1], S.hook, { shadow, pad: 40, size: 124, color: C.green });
    this.c1.position.set(0, 680, 0);
    this.c2.position.set(0, 552, 0);
    this.zero = txt(COPY.zero[0], S.giant, { shadow, pad: 50, size: 400 });
    this.zero.position.set(0, 540, 0);
    this.zero2 = txt(COPY.zero[1], S.hook, { shadow, pad: 40, size: 118, color: C.green });
    this.zero2.position.set(0, 300, 0);
    this.hud.add(this.c1, this.c2, this.zero, this.zero2);
  }

  update(t, lt, fx) {
    const pose = poseAt(t);
    const beatPulse = pulse(t, B(Math.floor(t / B(1))), 7);
    applyPose(this.camera, { ...pose, shake: 0.04 + 0.25 * pulse(t, B(28), 5) + 0.15 * pulse(t, B(24), 6), shakeFreq: 12, shakeSeed: 8 });
    const bl = cameraBlur(poseAt, t, { depth: 10, gain: 0.75 });
    fx.addBlur(bl.x, bl.y);
    fx.zoomBlur += Math.min(0.14, Math.abs(bl.zoom) * 0.35);

    const tu = this.towers.material.uniforms;
    tu.uTime.value = t;
    tu.uBeat.value = beatPulse;
    tu.uGrow.value = lerp(0.25, 1, ease.outExpo(clamp((t - B(24)) / 0.5)));
    this.packets.material.uniforms.uTime.value = t;
    const g = this.grid.material.uniforms;
    g.uMajorI.value = 0.4 + 0.3 * beatPulse;

    // etiquetas: pop + billboard
    this.labels.forEach((L) => {
      L.quaternion.copy(this.camera.quaternion);
      const { t2, line } = L.userData;
      const d = L.position.distanceTo(this.camera.position);
      const vis = smoothstep(70, 45, d);
      t2.material.uniforms.uOpacity.value = vis;
      line.material.opacity = 0.55 * vis;
      L.visible = vis > 0.01;
      const s = 0.0125 * (1 + 0.15 * beatPulse);
      t2.scale.setScalar(s);
    });

    // ── HUD ──
    riseGlyphs(this.c1, t, B(24.25), { dur: 0.42, stagger: 0.02 });
    riseGlyphs(this.c2, t, B(25), { dur: 0.42, stagger: 0.02 });
    if (t > B(27.75)) this.c1.visible = this.c2.visible = false;
    slam(this.zero, t, B(28), { from: 2.8, dur: 0.24 });
    slam(this.zero2, t, B(28.5), { from: 1.8, dur: 0.22 });
    if (t > B(31.4)) {
      const p = ease.inExpo(clamp((t - B(31.4)) / B(0.6)));
      this.zero.position.y = 540 - 900 * p;
      this.zero2.position.y = 300 - 900 * p;
      setBlur(this.zero, 4 * p);
    } else {
      this.zero.position.y = 540;
      this.zero2.position.y = 300;
    }

    // ── FX ──
    fx.flashTo(0.55 * pulse(t, B(24), 14), [0.7, 1, 0.6]);
    fx.punch += 0.3 * hit(t, B(24), 0.005, 7) + 0.45 * hit(t, B(28), 0.005, 6);
    fx.chroma += 0.005 * pulse(t, B(28), 6);
    fx.glitch += 0.25 * pulse(t, B(28), 14);
    fx.flashTo(0.25 * smoothstep(B(31.8), B(32), t), [0.8, 1, 0.75]);
  }
}
