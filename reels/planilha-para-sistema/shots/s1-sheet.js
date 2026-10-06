import * as THREE from 'three';
import { Shot } from '../../../engine/stage.js';
import { ease, invLerp, clamp, lerp, hit, pulse, spring, smoothstep } from '../../../engine/core/time.js';
import { hash, fbm1 } from '../../../engine/core/random.js';
import { applyPose, cameraBlur } from '../../../engine/camera.js';
import { Text3D } from '../../../engine/gfx/text3d.js';
import { chromeMaterial, makeMatcap } from '../../../engine/gfx/materials.js';
import { slam, riseGlyphs, typeGlyphs, setBlur, DynamicText } from '../../../engine/anim.js';
import { makeAtlas, makeSheet, makeSelection, cellPos, T } from '../lib/sheet.js';
import { S, txt, glyphs, GlitchText } from '../lib/type.js';
import { makeErrorDialog } from '../lib/ui.js';
import { B, C, F, COPY } from '../config.js';

// SHOT 1 (0 → 7,5 s): a planilha.
//  B0–B2  close na célula =SOMA(), câmera puxa de cima ("SUA EMPRESA / AINDA RODA EM")
//  B2     crane: a câmera mergulha e a palavra 3D "PLANILHA?" brota da planilha
//  B8–B14 caos: onda de #REF!/#N/D, células descolam, tudo fica vermelho
//  B14–B16 vórtice: o caos inteiro é sugado para um ponto → silêncio → DROP

const WORD_Z = -36;
const VC = new THREE.Vector3(0, 7, -46); // centro do vórtice
const V_AZ = 0.0, V_EL = 0.26;
const VA = new THREE.Vector3(Math.sin(V_AZ) * Math.cos(V_EL), Math.sin(V_EL), Math.cos(V_AZ) * Math.cos(V_EL)).normalize();
const DEG = Math.PI / 180;

// trilha de keyframes do rig orbital (alvo, distância, azimute, elevação, roll, fov)
const RIG = [
  [B(-0.25), { tx: 0.02, ty: 0, tz: -12, d: 5.2, az: 0, el: 89.5 * DEG, roll: 0.24, fov: 50 }],
  [B(1.95), { tx: 0, ty: 0, tz: -13.5, d: 31, az: 0, el: 89 * DEG, roll: 0.07, fov: 50 }, ease.outExpo],
  [B(3.3), { tx: 0, ty: 0.9, tz: WORD_Z, d: 38, az: -0.08, el: 7.5 * DEG, roll: 0.0, fov: 54 }, ease.snap],
  [B(6), { tx: 0.1, ty: 1.0, tz: WORD_Z, d: 30.5, az: 0.11, el: 6.2 * DEG, roll: -0.025, fov: 54 }, ease.inOutSine],
  [B(8), { tx: 0.4, ty: 1.2, tz: WORD_Z, d: 23, az: 0.3, el: 5 * DEG, roll: -0.03, fov: 54 }, ease.inQuad],
  [B(11), { tx: 0, ty: 3.4, tz: WORD_Z - 2, d: 17, az: 0.62, el: 11 * DEG, roll: 0.1, fov: 56 }, ease.inOutCubic],
  [B(14), { tx: VC.x, ty: VC.y, tz: VC.z, d: 27, az: V_AZ, el: V_EL, roll: -0.05, fov: 60 }, ease.inOutCubic],
  [B(15.75), { tx: VC.x, ty: VC.y, tz: VC.z, d: 6.5, az: V_AZ, el: V_EL, roll: 2.2, fov: 70 }, ease.inCubic],
  [B(16.2), { tx: VC.x, ty: VC.y, tz: VC.z, d: 5.8, az: V_AZ, el: V_EL, roll: 2.4, fov: 72 }, ease.outCubic],
];

function rigAt(t) {
  const keys = RIG;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b, e] = keys[i];
      const u = (e || ease.inOutCubic)(invLerp(t0, t1, t));
      const o = {};
      for (const k in a) o[k] = lerp(a[k], b[k], u);
      return o;
    }
  }
  return keys[keys.length - 1][1];
}

function poseAt(t) {
  const r = rigAt(t);
  const target = new THREE.Vector3(r.tx, r.ty, r.tz);
  const ce = Math.cos(r.el), se = Math.sin(r.el);
  const pos = target.clone().add(new THREE.Vector3(ce * Math.sin(r.az), se, ce * Math.cos(r.az)).multiplyScalar(r.d));
  const up = new THREE.Vector3(-se * Math.sin(r.az), ce, -se * Math.cos(r.az));
  // respiração "de mão" sutil
  pos.x += fbm1(t * 0.7, 5) * 0.12;
  pos.y += fbm1(t * 0.6, 8) * 0.08;
  return { pos, target, up, roll: r.roll, fov: r.fov, t };
}

// base do disco do vórtice (perpendicular ao eixo de visão)
const VU = new THREE.Vector3().crossVectors(VA, new THREE.Vector3(0, 1, 0)).normalize();
const VV = new THREE.Vector3().crossVectors(VA, VU).normalize();

// posição no disco espiral (mesma matemática do shader das células)
function diskPos(seed, vort, vt) {
  const arm = Math.floor(hash(seed, 1) * 3);
  const Rd = 2.5 + hash(seed, 2) * 8;
  const phi = arm * 2.0944 + Math.log(Rd) * 2.4;
  const col = clamp((vort - 0.42) / 0.58);
  const R = Rd * Math.pow(1 - col, 1.5);
  const w = 1.3 * (1 + 7 / (R + 1));
  const th = phi + w * vt;
  return VC.clone().add(VU.clone().multiplyScalar(Math.cos(th) * R)).add(VV.clone().multiplyScalar(Math.sin(th) * R));
}

export class ShotSheet extends Shot {
  constructor(stage, fonts) {
    super(stage, { name: 'sheet', start: 0, end: B(16), fov: 50, far: 400 });
    const sc = this.scene;
    sc.fog = new THREE.Fog(C.bg, 30, 90);

    // ── a planilha ──
    this.atlas = makeAtlas();
    this.sheet = makeSheet({ cols: 26, rows: 150, atlas: this.atlas, overrides: { '0,20': T.formula + 0, '1,20': T.num + 5, '-1,20': T.label + 2 } });
    sc.add(this.sheet);
    this.sel = makeSelection();
    sc.add(this.sel);

    // ── "PLANILHA?" 3D ──
    this.faceMat = chromeMaterial({ matcap: 'chrome', tint: '#5a5f5c', gradTop: '#ffffff', gradBot: '#9aa39e', gradIntensity: 1.05, gradH: 1.4, sweepColor: '#ffffff', sweepIntensity: 2.2 });
    this.faceMat.uniforms.uSweepWidth.value = 0.9;
    this.sideMat = chromeMaterial({ matcap: 'dark', rim: C.green, rimIntensity: 0.32, rimPow: 4 });
    this.word = new Text3D(fonts.hero, COPY.hookWord, { size: 3.15, depth: 0.95, letterSpacing: 0.1, materials: [this.faceMat, this.sideMat], bevelThickness: 0.07, bevelSize: 0.045 });
    this.word.position.set(0, 0, WORD_Z);
    sc.add(this.word);
    this.matRed = makeMatcap('chromeRed');
    this.matDark = makeMatcap('dark');
    this.matDarkRed = makeMatcap('darkRed');
    this.matChrome = makeMatcap('chrome');

    // brilho do horizonte (contraluz que recorta a palavra)
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 256, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 8, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 11),
      new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(C.green).multiplyScalar(0.55), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false })
    );
    this.horizon.position.set(0, 4.2, -118);
    sc.add(this.horizon);

    // ponto quente final (o caos colapsado)
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.9).multiplyScalar(6), toneMapped: false, fog: false })
    );
    this.core.position.copy(VC);
    sc.add(this.core);

    // janelas de erro em cascata (presas à câmera, com perspectiva)
    sc.add(this.camera);
    this.dialogs = [];
    for (let k = 0; k < 7; k++) {
      const d = makeErrorDialog(k, 0.92);
      const wave = k < 4 ? 0 : 1;
      const j = wave ? k - 4 : k;
      d.userData = {
        t0: B(10 + wave * 2) + 0.05 + j * 0.075,
        x: (wave ? 0.35 : -0.42) + j * 0.2 + (hash(k, 3) - 0.5) * 0.1,
        y: (wave ? -0.35 : -0.55) - j * 0.3,
        rz: (hash(k, 4) - 0.5) * 0.12,
      };
      this.camera.add(d);
      this.dialogs.push(d);
    }

    // ── HUD ──
    const h = this.hud;
    const shadow = { blur: 28, color: 'rgba(0,0,0,0.9)' };
    this.hook1 = txt(COPY.hook[0], S.hook, { shadow, pad: 40 });
    this.hook1.position.set(0, 640, 0);
    this.hook2 = txt(COPY.hook[1], S.hook, { color: '#d9e0dc', shadow, pad: 40 });
    this.hook2.position.set(0, 498, 0);
    h.add(this.hook1, this.hook2);

    this.joke = glyphs(COPY.joke, S.mono, { size: 40 });
    this.joke.position.set(0, 372, 0);
    this.cursor = new THREE.Mesh(new THREE.PlaneGeometry(20, 44), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(1.6), toneMapped: false }));
    h.add(this.joke, this.cursor);

    this.pains = COPY.pains.map((p, i) => {
      const g = new THREE.Group();
      const l1 = new GlitchText(p.l1, S.pain, { seed: 10 + i });
      const l2 = new GlitchText(p.l2, S.pain, { seed: 20 + i, ghost1: '#ffffff' });
      const fit = Math.min(1, 900 / Math.max(l1.w, l2.w));
      l1.scale.setScalar(fit);
      l2.scale.setScalar(fit);
      l2.main.setColor(C.red, 1.25);
      l1.position.y = 82;
      l2.position.y = -82;
      const tag = txt(p.tag, S.tag);
      tag.position.set(Math.min((l1.w * fit) / 2 - 30, 300), 82 + 112, 0);
      tag.rotation.z = -0.08;
      g.add(l1, l2, tag);
      g.position.set(0, 560, 0);
      g.userData = { l1, l2, tag };
      h.add(g);
      return g;
    });

    this.money = new DynamicText({
      width: 700,
      height: 130,
      draw: (ctx, s, w, hh) => {
        ctx.font = `700 70px "${F.mono}"`;
        const tw = ctx.measureText(s.v).width;
        const bw = tw + 64, bh = 104;
        ctx.fillStyle = 'rgba(14,0,4,0.92)';
        ctx.beginPath();
        ctx.roundRect((w - bw) / 2, (hh - bh) / 2, bw, bh, 14);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.red;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(s.v, w / 2, hh / 2 + 4);
      },
    });
    this.money.position.set(0, 290, 0);
    h.add(this.money);

    this.turn = new THREE.Group();
    const tshadow = { blur: 34, color: 'rgba(0,0,0,0.95)' };
    this.turnA = glyphs(COPY.turn[0], S.pain, { size: 210, letterSpacing: 2, shadow: tshadow, pad: 44 });
    this.turnB = glyphs(COPY.turn[1], S.pain, { size: 210, letterSpacing: 2, shadow: tshadow, pad: 44 });
    this.turnA.position.y = 105;
    this.turnB.position.y = -105;
    this.turn.add(this.turnA, this.turnB);
    this.turn.position.set(0, 430, 0);
    h.add(this.turn);
  }

  update(t, lt, fx) {
    const pose = poseAt(t);
    // ── shake (impactos + caos crescente) ──
    const chaos = smoothstep(B(8), B(9), t) * (1 - smoothstep(B(13.5), B(14.5), t));
    const sh =
      0.18 * pulse(t, 0, 7) + 0.12 * pulse(t, B(1), 8) + 0.35 * pulse(t, B(2.05), 5) +
      0.45 * pulse(t, B(8), 4) + 0.3 * pulse(t, B(10), 5) + 0.3 * pulse(t, B(12), 5) +
      chaos * 0.11 + smoothstep(B(14), B(15.7), t) * 0.22;
    applyPose(this.camera, { ...pose, shake: sh, shakeFreq: 13 });
    // motion blur derivado da câmera
    const blur = cameraBlur(poseAt, t, { depth: rigAt(t).d, gain: 0.8 });
    const early = lerp(0.35, 1, smoothstep(0.05, 0.35, t)); // frame 0 nítido (capa)
    fx.addBlur(blur.x * early, blur.y * early);
    fx.zoomBlur += Math.abs(blur.zoom) * 0.5 * early;

    // ── planilha ──
    const u = this.sheet.material.uniforms;
    u.uTime.value = t;
    const topdown = 1 - smoothstep(B(2), B(3.2), t);
    u.uFogNear.value = lerp(15, 60, topdown);
    u.uFogFar.value = lerp(62, 160, topdown);
    this.scene.fog.near = lerp(18, 60, topdown);
    this.scene.fog.far = lerp(70, 160, topdown);
    u.uWaveT0.value = B(8);
    u.uWaveSpeed.value = 30;
    u.uWaveCenter.value.set(0, 60);
    u.uErrRatio.value = 0.42;
    u.uLiftT0.value = B(9);
    u.uLiftSpread.value = B(4.5);
    u.uLiftCenter.value.set(0, 60);
    u.uLiftRatio.value = 0.72;
    const red = smoothstep(B(8), B(9.5), t);
    u.uRed.value = red;
    u.uBright.value = 1 + 0.5 * pulse(t, B(8), 6);
    u.uErrGlow.value = 1.4 + 1.2 * Math.max(pulse(t, B(10), 7), pulse(t, B(12), 7));
    u.uJitter.value = 1.4 * Math.max(pulse(t, B(8), 10), pulse(t, B(10), 12), pulse(t, B(12), 12));
    const vort = clamp(invLerp(B(14), B(15.72), t));
    u.uVortex.value = ease.inQuad(vort);
    u.uVCenter.value.copy(VC);
    u.uVAxis.value.copy(VA);
    u.uVU.value.copy(VU);
    u.uVV.value.copy(VV);
    u.uVTime.value = Math.max(0, t - B(14));

    // seleção (cursor da planilha) pulando de célula em célula
    const selKeys = [[0, 20], [1, 20], [1, 21], [-1, 22], [0, 23], [2, 59], [3, 59], [3, 60], [1, 61], [-2, 58], [0, 57], [4, 60], [-3, 61]];
    const selT = [-1, B(0.5), B(1), B(1.5), B(1.75), B(3.2), B(4), B(5), B(5.5), B(6), B(6.5), B(7), B(7.5)];
    let si = 0;
    for (let i = 0; i < selT.length; i++) if (t >= selT[i]) si = i;
    const prev = selKeys[Math.max(0, si - 1)], cur = selKeys[si];
    const sp = ease.outExpo(clamp((t - selT[si]) / 0.07));
    const selP = cellPos(lerp(prev[0], cur[0], sp), lerp(prev[1], cur[1], sp));
    this.sel.position.copy(selP);
    this.sel.visible = t < B(9.2) && !(t > B(8) && Math.floor(t * 16) % 3 === 0);
    this.sel.children.forEach((m) => m.material.color && m.material.color.set(t > B(8) ? C.red : C.green).multiplyScalar(m.material.opacity < 1 ? 0.3 : 2.2));

    // ── palavra 3D ──
    const letters = this.word.letters;
    const n = letters.length;
    const cap = this.word.cap;
    const isRed = t > B(8);
    const fu = this.faceMat.uniforms;
    fu.uMatcap.value = isRed ? this.matRed : this.matChrome;
    fu.uGradTop.value.set(isRed ? '#ff2a4d' : '#ffffff').multiplyScalar(isRed ? 0.9 + 0.8 * pulse(t, B(8), 5) : 1.05);
    fu.uGradBot.value.set(isRed ? '#5c0012' : '#9aa39e').multiplyScalar(isRed ? 0.8 : 1.05);
    fu.uEmissive.value.set('#ff1040').multiplyScalar(isRed ? 0.15 * Math.max(0, Math.sin(t * 40)) * chaos : 0);
    this.sideMat.uniforms.uRim.value.set(isRed ? C.red : C.green).multiplyScalar(isRed ? 0.6 : 0.32);
    this.sideMat.uniforms.uMatcap.value = isRed ? this.matDarkRed : this.matDark;
    // varreduras de luz nos beats
    const sw = Math.max(0, ...[B(3.3), B(5), B(7)].map((s) => (t > s && t < s + 0.6 ? 1 : 0)));
    const swT = [B(3.3), B(5), B(7)].reduce((a, s) => (t > s ? s : a), -10);
    this.faceMat.uniforms.uSweepPos.value = sw ? lerp(-12, 10, ease.inOutCubic((t - swT) / 0.6)) : -1000;
    letters.forEach((L, i) => {
      const base = L.userData.base;
      // brota da planilha (molas com stagger)
      const t0 = B(2) + 0.02 + i * 0.045;
      const s = spring(t - t0, 2.0, 0.42);
      let p = new THREE.Vector3(base.x, lerp(-cap * 0.6, cap / 2, s), 0);
      let rx = (1 - Math.min(1, s)) * 0.6, ry = 0, rz = 0;
      // pulso no beat (B4..B8): a palavra "respira" com a música
      let bp = 0;
      for (let b = 4; b < 8; b++) bp += pulse(t, B(b) + i * 0.012, 9);
      p.y += bp * 0.18;
      // glitch nos impactos
      const gj = Math.max(pulse(t, B(8), 9), pulse(t, B(10), 10), pulse(t, B(12), 10));
      if (gj > 0.05) {
        const st = Math.floor(t * 30);
        p.x += (hash(st * 13 + i, 1) - 0.5) * 0.9 * gj;
        p.y += (hash(st * 17 + i, 2) - 0.5) * 0.5 * gj;
      }
      // desmonte: letras descolam, giram e flutuam (a partir de B10)
      const lt0 = B(10) + hash(i, 33) * B(2.5);
      const lt2 = Math.max(0, t - lt0);
      if (lt2 > 0) {
        const k = 1.2;
        const up = ((1 - Math.exp(-k * lt2)) / k) * (1.2 + hash(i, 4) * 1.6);
        p.y += up;
        p.x += (hash(i, 5) - 0.5) * lt2 * 1.4;
        p.z += (hash(i, 6) - 0.2) * lt2 * 1.0;
        rx += lt2 * (hash(i, 7) - 0.5) * 2.4;
        ry += lt2 * (hash(i, 8) - 0.5) * 2.0;
        rz += lt2 * (hash(i, 9) - 0.5) * 1.6;
      }
      // vórtice
      const world = p.clone().add(this.word.position);
      if (vort > 0) {
        const vv = ease.inQuad(vort);
        const g = smoothstep(0, 0.5, vv);
        world.lerp(diskPos(i + 50, vv, t - B(14)), g);
        const sc = 1 - smoothstep(0.55, 0.95, vv);
        L.scale.setScalar(Math.max(0.001, sc));
        rz += vv * 6;
      } else L.scale.setScalar(1);
      L.position.copy(world.sub(this.word.position));
      L.rotation.set(rx, ry, rz);
      L.visible = t >= t0 - 0.05;
    });

    // horizonte: só no modo perspectiva; fica vermelho no caos
    const persp = smoothstep(B(2.2), B(3.4), t);
    this.horizon.material.color.set(isRed ? C.red : C.green).multiplyScalar(0.15 * persp * (1 - smoothstep(B(14), B(15), t)) + 0.25 * pulse(t, B(8), 4));
    this.horizon.visible = persp > 0.01;

    // núcleo: aparece no fim do vórtice
    const coreOn = smoothstep(B(15.2), B(15.75), t);
    this.core.scale.setScalar(0.05 + coreOn * 0.5 + 0.15 * Math.sin(t * 60) * coreOn);
    this.core.visible = coreOn > 0.01;

    // ── HUD ──
    // gancho: já está entrando no frame 0 (capa forte)
    slam(this.hook1, t, -0.1, { from: 2.6, dur: 0.26 });
    slam(this.hook2, t, B(1) - 0.04, { from: 2.2, dur: 0.24 });
    const hookOut = t >= B(8);
    if (hookOut) {
      this.hook1.visible = this.hook2.visible = false;
    } else {
      // micro deriva para não "congelar"
      const d = (t - B(2)) * 6;
      this.hook1.position.y = 640 + Math.max(0, d) * 0.6;
      this.hook2.position.y = 498 + Math.max(0, d) * 0.6;
      if (t > B(7.75)) {
        const g = Math.floor(t * 40) % 2;
        this.hook1.position.x = g ? 18 : -14;
        this.hook2.position.x = g ? -22 : 10;
      } else this.hook1.position.x = this.hook2.position.x = 0;
    }

    // piada digitada
    const jokeT0 = B(4);
    const shown = typeGlyphs(this.joke, t, jokeT0, 0.026);
    const jokeEnd = t >= B(8);
    this.joke.visible = t >= jokeT0 && !jokeEnd;
    const lastG = this.joke.glyphs[Math.max(0, shown - 1)];
    const cx = shown ? lastG.position.x + 22 : -this.joke.w / 2;
    this.cursor.position.set(cx, this.joke.position.y + 2, 0);
    const blinkOn = t < jokeT0 + this.joke.glyphs.length * 0.026 + 0.05 || Math.floor((t - jokeT0) / B(0.5)) % 2 === 0;
    this.cursor.visible = t >= jokeT0 - B(0.5) && !jokeEnd && blinkOn;

    // dores (B8, B10, B12)
    this.pains.forEach((g, i) => {
      const t0 = B(8 + i * 2);
      const t1 = i < 2 ? B(10 + i * 2) : B(14);
      const on = t >= t0 - 0.03 && t < t1;
      g.visible = on;
      if (!on) return;
      const { l1, l2, tag } = g.userData;
      const p = ease.outExpo(clamp((t - t0) / 0.22));
      const s = lerp(1.9, 1, p);
      g.scale.set(s, s, 1);
      g.rotation.z = lerp(-0.12, -0.02, p);
      const gl = 0.25 + 0.75 * pulse(t, t0, 8) + 0.5 * (t > t1 - 0.12 ? 1 : 0);
      l1.glitch(t, gl, clamp((t - t0) / 0.04));
      l2.glitch(t + 0.37, gl, clamp((t - t0 - 0.06) / 0.04));
      l1.setBlur(3 * (1 - p));
      l2.setBlur(3 * (1 - p));
      // tag "carimbo" entra um pouco depois
      const tp = spring(t - t0 - 0.12, 3.2, 0.45);
      tag.scale.setScalar(Math.max(0.001, tp));
      tag.opacity = t > t0 + 0.12 ? 1 : 0;
      g.position.y = 560 + (t - t0) * 30;
    });

    // janelas de erro: pop com mola, tremem nos impactos, somem no vórtice
    this.dialogs.forEach((d, k) => {
      const u = d.userData;
      const lt = t - u.t0;
      const on = lt >= 0 && t < B(14);
      d.visible = on;
      if (!on) return;
      const s = spring(lt, 3.4, 0.5);
      const z = -6 + k * 0.01;
      const j = Math.max(pulse(t, B(12), 10), pulse(t, B(10), 10)) * (hash(Math.floor(t * 30) + k, 9) - 0.5) * 0.12;
      d.position.set(u.x + j, u.y, z);
      d.scale.setScalar(Math.max(0.001, s));
      d.rotation.set(0, 0, u.rz);
      d.renderOrder = 10 + k;
    });

    // contador de prejuízo
    const mOn = t >= B(12.3) && t < B(14);
    this.money.visible = mOn;
    if (mOn) {
      const p = clamp((t - B(12.3)) / B(1.6));
      const v = Math.round(lerp(1250, 48392.17, ease.inCubic(p)) * 100) / 100;
      const s = v.toFixed(2).split('.');
      s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      this.money.update({ v: `R$ -${s[0]},${s[1]}` });
      this.money.opacity = 1;
      this.money.position.y = 300 + 8 * Math.sin(t * 50) * pulse(t, B(12.3), 5);
    }

    // "TROQUE O CAOS" → sugado para o centro
    const turnIn = B(14);
    riseGlyphs(this.turnA, t, turnIn, { dur: 0.42, stagger: 0.03 });
    riseGlyphs(this.turnB, t, turnIn + B(0.5), { dur: 0.42, stagger: 0.03 });
    this.turn.visible = t >= turnIn;
    const suck = clamp(invLerp(B(15.25), B(15.75), t));
    if (suck > 0) {
      const e = ease.inExpo(suck);
      this.turn.position.set(0, lerp(430, 0, e), 0);
      this.turn.scale.setScalar(lerp(1, 0.02, e));
      this.turn.rotation.z = e * 2.4;
      setBlur(this.turnA, e * 4);
      setBlur(this.turnB, e * 4);
    } else {
      this.turn.position.set(0, 430, 0);
      this.turn.scale.setScalar(1);
      this.turn.rotation.z = 0;
      setBlur(this.turnA, 0);
      setBlur(this.turnB, 0);
    }

    // ── FX globais ──
    fx.punch += 0.32 * hit(t, 0, 0.01, 7) + 0.18 * hit(t, B(1), 0.01, 8) + 0.6 * hit(t, B(2.05), 0.01, 5) +
      0.55 * hit(t, B(8), 0.01, 6) + 0.35 * hit(t, B(10), 0.01, 7) + 0.35 * hit(t, B(12), 0.01, 7) + 0.25 * hit(t, B(14), 0.01, 7);
    fx.flashTo(0.32 * pulse(t, B(2.05), 12));
    fx.flashTo(0.45 * pulse(t, B(8), 10), [1, 0.02, 0.12]);
    fx.flashTo(0.25 * pulse(t, B(10), 12), [1, 0.02, 0.12]);
    fx.flashTo(0.25 * pulse(t, B(12), 12), [1, 0.02, 0.12]);
    fx.glitch += 0.95 * pulse(t, B(8), 9) + 0.6 * pulse(t, B(10), 11) + 0.6 * pulse(t, B(12), 11) +
      chaos * 0.12 * (hash(Math.floor(t * 12), 77) < 0.25 ? 1 : 0) + (t > B(7.75) && t < B(8) ? 0.4 : 0);
    fx.chroma += 0.004 * chaos + 0.006 * pulse(t, B(8), 6) + 0.006 * vort;
    // grade: vermelho no caos
    const rg = red * (1 - smoothstep(B(15.5), B(16), t));
    fx.tint = [lerp(1, 1.08, rg), lerp(1, 0.86, rg), lerp(1, 0.9, rg)];
    fx.saturation += 0.1 * rg;
    // vórtice: zoom blur e escuridão antes do drop
    fx.zoomBlur += 0.32 * ease.inQuad(vort) * (1 - smoothstep(B(15.6), B(15.8), t));
    fx.exposure *= lerp(1, 0.35, smoothstep(B(15.6), B(15.85), t));
    fx.bloom += 0.6 * coreOn;
  }
}
