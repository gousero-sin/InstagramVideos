import * as THREE from 'three';
import { Shot } from '../../../engine/stage.js';
import { ease, invLerp, clamp, lerp, hit, pulse, spring, smoothstep } from '../../../engine/core/time.js';
import { fbm1 } from '../../../engine/core/random.js';
import { applyPose, cameraBlur } from '../../../engine/camera.js';
import { Text3D } from '../../../engine/gfx/text3d.js';
import { chromeMaterial } from '../../../engine/gfx/materials.js';
import { makeGrid } from '../../../engine/gfx/grid.js';
import { makeParticles, updatePointScale } from '../../../engine/gfx/particles.js';
import { slam, riseGlyphs, DynamicText } from '../../../engine/anim.js';
import { S, txt, glyphs } from '../lib/type.js';
import { cashPanel, kpiCard, tableCard, uiPlane } from '../lib/ui.js';
import { B, C, F, COPY } from '../config.js';

// SHOT 2 (7,5 → 11,25 s): o DROP.
//  B16  flash + onda de choque: "POR UM" / "SISTEMA." neon gigante (câmera colada, lente 96°)
//  B16–B17.6 dolly-out violento (vertigo reverso) revelando o dashboard se montando
//  B18–B23 órbita; KPIs contam; "FEITO SOB MEDIDA / PRO SEU NEGÓCIO."
//  B23.2–B24 mergulho nas barras → corte para a cidade de dados

const WY = 2.2;
const DEG = Math.PI / 180;
const T0 = B(16);

const RIG = [
  [B(16), { tx: 0, ty: WY, tz: 0, d: 6.2, az: 0.0, el: 1 * DEG, roll: 0.06, fov: 98 }],
  [B(17.6), { tx: 0, ty: 3.6, tz: -1.5, d: 26, az: -0.2, el: 9 * DEG, roll: 0.0, fov: 46 }, ease.outExpo],
  [B(21), { tx: 0, ty: 3.8, tz: -1.8, d: 24.5, az: 0.16, el: 10.5 * DEG, roll: -0.01, fov: 46 }, ease.inOutSine],
  [B(23.2), { tx: 0, ty: 3.6, tz: -1.5, d: 23.5, az: 0.26, el: 12 * DEG, roll: -0.02, fov: 47 }, ease.inOutSine],
  [B(24.05), { tx: 0, ty: 0.9, tz: 4.6, d: 2.6, az: 0.05, el: 38 * DEG, roll: 0.12, fov: 84 }, ease.inExpo],
];

function rigAt(t) {
  const k = RIG;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const [t0, a] = k[i - 1];
      const [t1, b, e] = k[i];
      const u = (e || ease.inOutCubic)(invLerp(t0, t1, t));
      const o = {};
      for (const key in a) o[key] = lerp(a[key], b[key], u);
      return o;
    }
  }
  return k[k.length - 1][1];
}

function poseAt(t) {
  const r = rigAt(t);
  const target = new THREE.Vector3(r.tx, r.ty, r.tz);
  const ce = Math.cos(r.el), se = Math.sin(r.el);
  const pos = target.clone().add(new THREE.Vector3(ce * Math.sin(r.az), se, ce * Math.cos(r.az)).multiplyScalar(r.d));
  pos.x += fbm1(t * 0.6, 21) * 0.15;
  pos.y += fbm1(t * 0.5, 22) * 0.1;
  return { pos, target, roll: r.roll, fov: r.fov, t };
}

const BARS = [0.55, 0.8, 0.7, 1.05, 0.95, 1.3, 1.2, 1.5, 1.7, 1.55, 1.95, 2.3];

export class ShotSystem extends Shot {
  constructor(stage, fonts) {
    super(stage, { name: 'system', start: B(16), end: B(24), fov: 60, far: 300 });
    const sc = this.scene;
    sc.fog = new THREE.Fog(C.bg, 30, 75);

    // piso
    this.grid = makeGrid({ cell: 1, major: 5, fade: 0.03, minor: 0.16, majorI: 0.55 });
    sc.add(this.grid);

    // brilho atrás da palavra
    const glowTex = radialTexture();
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 10),
      new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(C.green).multiplyScalar(0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    this.glow.position.set(0, WY, -1.2);
    sc.add(this.glow);

    // "SISTEMA." neon
    this.face = chromeMaterial({ matcap: 'chrome', tint: '#2c3a2a', gradTop: '#f4fff0', gradBot: '#2bd60f', gradIntensity: 0.95, gradH: 0.75, sweepColor: '#ffffff', sweepIntensity: 1.6 });
    this.face.uniforms.uSweepWidth.value = 0.7;
    this.side = chromeMaterial({ matcap: 'dark', rim: C.green, rimIntensity: 0.45, rimPow: 3 });
    const wopts = { depth: 0.75, letterSpacing: 0.06, materials: [this.face, this.side], bevelThickness: 0.05, bevelSize: 0.035 };
    const probe = new Text3D(fonts.heroC, COPY.dropWord, { ...wopts, size: 2.3 });
    const size = (2.3 * 8.8) / probe.width; // cabe na largura do quadro 9:16
    probe.letters.forEach((l) => l.geometry.dispose());
    this.word = new Text3D(fonts.heroC, COPY.dropWord, { ...wopts, size, depth: size * 0.32 });
    this.word.position.set(0, WY, 0);
    sc.add(this.word);

    // painel principal (fundo + gráfico revelável)
    const cash = cashPanel();
    this.cashBg = uiPlane(cash.bg, cash.w, cash.h, 0.0105);
    this.cashFg = uiPlane(cash.fg, cash.w, cash.h, 0.0105);
    this.cashFg.position.z = 0.04;
    this.cash = new THREE.Group();
    this.cash.add(this.cashBg, this.cashFg);
    this.cash.position.set(0, 4.9, -7.5);
    sc.add(this.cash);

    // KPIs (cantos, mais ao fundo)
    const k1 = kpiCard('RECEITA DO MÊS', '▲ 18,4%', { icon: 'R$' });
    const k2 = kpiCard('LUCRO LÍQUIDO · DRE', '▲ 9,2%', { icon: '%' });
    const k3 = tableCard();
    const k4 = kpiCard('A RECEBER HOJE', '12 títulos', { icon: '⏱', chip: { color: '#ffd23f', bg: 'rgba(255,210,63,0.14)' } });
    this.kpis = [
      { m: uiPlane(k1.tex, k1.w, k1.h, 0.0105), p: [-7.2, 6.4, -11], ry: 0.5, d: 0 },
      { m: uiPlane(k2.tex, k2.w, k2.h, 0.0105), p: [7.2, 6.4, -11], ry: -0.5, d: 0.08 },
      { m: uiPlane(k3.tex, k3.w, k3.h, 0.0105), p: [-8.6, 2.6, -9], ry: 0.62, d: 0.16 },
      { m: uiPlane(k4.tex, k4.w, k4.h, 0.0105), p: [8.6, 2.9, -9], ry: -0.62, d: 0.22 },
    ];
    this.kpiNums = [
      { from: 0, to: 248390, fmt: (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR') },
      { from: 0, to: 61720, fmt: (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR') },
      null,
      { from: 0, to: 32180, fmt: (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR') },
    ].map((n, i) => {
      if (!n) return null;
      const dt = new DynamicText({
        width: 400,
        height: 80,
        draw: (ctx, s, w, h) => {
          ctx.font = `800 54px "${F.sans}"`;
          ctx.letterSpacing = '-1px';
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.v, 4, h / 2 + 2);
        },
      });
      dt.material.depthTest = true;
      dt.scale.setScalar(0.0105);
      dt.position.set(-0.1, 0.02, 0.03);
      this.kpis[i].m.add(dt);
      return { ...n, dt };
    });
    this.kpis.forEach((k) => sc.add(k.m));

    // barras 3D em primeiro plano
    this.barMat = chromeMaterial({ matcap: 'dark', tint: '#ffffff', gradTop: '#39ff14', gradBot: '#000000', gradIntensity: 0.42, gradH: 0.5, rim: C.green, rimIntensity: 0.22, rimPow: 3 });
    const bg = new THREE.BoxGeometry(0.62, 1, 0.62);
    bg.translate(0, 0.5, 0);
    this.bars = BARS.map((h, i) => {
      const m = new THREE.Mesh(bg, this.barMat);
      const x = (i - (BARS.length - 1) / 2) * 0.86;
      m.position.set(x, 0, 4.4 + Math.abs(x) * 0.12);
      m.userData.h = h;
      sc.add(m);
      return m;
    });
    // tampas brilhantes das barras
    this.caps = this.bars.map((b) => {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(1.5), toneMapped: false }));
      sc.add(c);
      return c;
    });

    // anel de energia no ar
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.ring.position.set(0, WY, 0);
    sc.add(this.ring);

    // partículas: explosão do drop + poeira ambiente
    this.burst = makeParticles({
      count: 3500,
      seed: 7,
      a: () => new THREE.Vector3(0, WY, 0),
      b: (i, r) => {
        const u = r() * 2 - 1, th = r() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        return new THREE.Vector3(s * Math.cos(th) * 1.4, u * 0.8 + 0.15, s * Math.sin(th));
      },
      colorA: '#ffffff',
      colorB: C.green,
      intensity: 2.6,
      size: 0.07,
    });
    this.burst.material.uniforms.uT0.value = T0;
    this.burst.material.uniforms.uSpeed.value = 26;
    this.burst.material.uniforms.uDrag.value = 2.4;
    this.burst.material.uniforms.uLife.value = 2.2;
    this.burst.material.uniforms.uStagger.value = 0.04;
    this.burst.material.uniforms.uGravity.value.set(0, -1.2, 0);
    sc.add(this.burst);
    this.dust = makeParticles({
      count: 1400,
      seed: 9,
      mode: 2,
      a: (i, r) => new THREE.Vector3((r() - 0.5) * 40, r() * 18, (r() - 0.5) * 40 - 6),
      colorA: '#ffffff',
      colorB: C.green,
      intensity: 0.9,
      size: 0.05,
    });
    this.dust.material.uniforms.uNoise.value = 0.6;
    sc.add(this.dust);

    // ── HUD ──
    const shadow = { blur: 30, color: 'rgba(0,0,0,0.92)' };
    this.porUm = txt(COPY.drop1, S.hook, { shadow, pad: 40, size: 120 });
    this.porUm.position.set(0, 560, 0);
    this.cap1 = glyphs(COPY.tailor[0], S.hook, { shadow, pad: 40, size: 112 });
    this.cap2 = glyphs(COPY.tailor[1], S.hook, { shadow, pad: 40, size: 112, color: C.green });
    this.cap1.position.set(0, 690, 0);
    this.cap2.position.set(0, 574, 0);
    // streak anamórfico
    this.streak = new THREE.Mesh(new THREE.PlaneGeometry(1600, 14), new THREE.MeshBasicMaterial({ map: streakTexture(), color: new THREE.Color(1, 1, 1).multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.hud.add(this.porUm, this.cap1, this.cap2, this.streak);
  }

  update(t, lt, fx) {
    const pose = poseAt(t);
    const beatPulse = t > B(16.9) ? pulse(t, B(Math.floor(t / B(1))), 7) : 0;
    const sh = 0.55 * pulse(t, T0, 5) + 0.06 * beatPulse + 0.25 * smoothstep(B(23.4), B(24), t);
    applyPose(this.camera, { ...pose, shake: sh, shakeFreq: 14, shakeSeed: 5 });
    const bl = cameraBlur(poseAt, t, { depth: Math.max(4, rigAt(t).d), gain: 0.75 });
    fx.addBlur(bl.x, bl.y);
    fx.zoomBlur += Math.abs(bl.zoom) * 0.55;
    updatePointScale(this.burst, this.camera);
    updatePointScale(this.dust, this.camera);

    // piso: onda de choque + pulso no beat
    const g = this.grid.material.uniforms;
    const r = Math.max(0, t - T0);
    g.uRingR.value = 38 * (1 - Math.exp(-1.6 * r));
    g.uRingW.value = 0.35 + r * 1.2;
    g.uRingColor.value.set(C.green).multiplyScalar(2.6 * Math.exp(-1.2 * r) + 0.5 * beatPulse);
    g.uMajorI.value = 0.5 + 0.35 * beatPulse;

    // anel no ar
    const rs = 1.2 + 22 * (1 - Math.exp(-2.6 * r));
    this.ring.scale.setScalar(rs);
    this.ring.material.opacity = Math.exp(-2.2 * r);
    this.ring.quaternion.copy(this.camera.quaternion);

    // brilho
    this.glow.material.color.set(C.green).multiplyScalar(0.16 + 0.9 * pulse(t, T0, 3) + 0.08 * beatPulse);

    // palavra: escala de impacto + varreduras de luz
    const ws = lerp(1.18, 1, ease.outExpo(clamp(r / 0.35))) * (1 + 0.012 * beatPulse);
    this.word.scale.setScalar(ws);
    this.word.letters.forEach((L, i) => {
      const s = spring(r - i * 0.018, 2.6, 0.4);
      L.position.y = (1 - s) * -0.6;
      L.rotation.x = (1 - s) * 0.9;
    });
    const swT = [B(16.4), B(19), B(22)].reduce((a, s) => (t > s ? s : a), -10);
    this.face.uniforms.uSweepPos.value = t - swT < 0.7 ? lerp(-9, 9, ease.inOutCubic((t - swT) / 0.7)) : -1000;
    this.face.uniforms.uEmissive.value.set(C.green).multiplyScalar(0.12 * beatPulse + 0.5 * pulse(t, T0, 4));

    // painel principal: entra girando, gráfico se desenha
    const pIn = ease.outExpo(clamp((t - B(16.5)) / 0.7));
    this.cash.position.set(0, lerp(1.5, 4.9, pIn), lerp(-20, -7.5, pIn));
    this.cash.rotation.set(lerp(-0.9, -0.04, pIn), 0, 0);
    this.cashBg.material.uniforms.uOpacity.value = clamp((t - B(16.5)) / 0.15);
    const draw = clamp((t - B(17.4)) / B(3));
    this.cashFg.material.uniforms.uWipe.value.set(ease.inOutCubic(draw), 0.04, 1, 0);
    this.cashFg.material.uniforms.uOpacity.value = draw > 0 ? 1 : 0;

    // KPIs voando para o lugar
    this.kpis.forEach((k, i) => {
      const p = ease.outExpo(clamp((t - B(17) - k.d) / 0.6));
      const [x, y, z] = k.p;
      k.m.position.set(x * lerp(2.2, 1, p), lerp(y + 6, y, p), z);
      k.m.rotation.set(0, k.ry + (1 - p) * 1.4 * Math.sign(-x), 0);
      k.m.material.uniforms.uOpacity.value = p > 0 ? 1 : 0;
      const n = this.kpiNums[i];
      if (n) {
        const c = ease.outCubic(clamp((t - B(17.6) - k.d) / B(3)));
        n.dt.update({ v: n.fmt(lerp(n.from, n.to, c)) });
        n.dt.material.uniforms.uOpacity.value = p > 0 ? 1 : 0;
      }
    });

    // barras sobem com mola (stagger) e crescem no mergulho final
    const grow = 1 + 3.5 * ease.inExpo(clamp((t - B(23.2)) / B(0.85)));
    this.bars.forEach((b, i) => {
      const s = spring(t - B(16.6) - i * 0.05, 2.0, 0.45);
      const h = Math.max(0.001, b.userData.h * s * (1 + 0.06 * beatPulse) * grow);
      b.scale.set(1, h, 1);
      this.caps[i].position.set(b.position.x, h + 0.002, b.position.z);
      this.caps[i].visible = s > 0.02;
    });

    // partículas
    this.burst.material.uniforms.uTime.value = t;
    this.dust.material.uniforms.uTime.value = t;

    // ── HUD ──
    slam(this.porUm, t, T0, { from: 2.4, dur: 0.26 });
    if (t > B(19.5)) this.porUm.visible = false;
    riseGlyphs(this.cap1, t, B(20), { dur: 0.45, stagger: 0.022 });
    riseGlyphs(this.cap2, t, B(21), { dur: 0.45, stagger: 0.022 });
    const sr = Math.exp(-6 * r);
    this.streak.material.opacity = sr;
    this.streak.scale.set(1 + r * 2, 1 + sr, 1);
    this.streak.position.y = 0;
    this.streak.visible = sr > 0.01;

    // ── FX ──
    fx.flashTo(Math.max(0, 1 - r / 0.16) * 0.95);
    fx.punch += 0.75 * hit(t, T0, 0.005, 5) + 0.06 * beatPulse;
    fx.chroma += 0.01 * pulse(t, T0, 6) + 0.001 * beatPulse;
    fx.bloom += 0.8 * pulse(t, T0, 3);
    fx.threshold = 0.9;
    fx.zoomBlur += 0.18 * ease.inExpo(clamp((t - B(23.3)) / B(0.75)));
    fx.flashTo(0.5 * smoothstep(B(23.85), B(24), t), [0.75, 1, 0.65]);
    fx.saturation += 0.06;
  }
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 16;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 512, 0);
  gr.addColorStop(0, 'rgba(160,255,140,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(160,255,140,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
