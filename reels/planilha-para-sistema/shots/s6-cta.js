import * as THREE from 'three';
import { Shot } from '../../../engine/stage.js';
import { ease, invLerp, clamp, lerp, hit, pulse, spring } from '../../../engine/core/time.js';
import { hash, fbm1 } from '../../../engine/core/random.js';
import { applyPose, cameraBlur } from '../../../engine/camera.js';
import { Text3D } from '../../../engine/gfx/text3d.js';
import { chromeMaterial } from '../../../engine/gfx/materials.js';
import { makeGrid } from '../../../engine/gfx/grid.js';
import { makeParticles, updatePointScale } from '../../../engine/gfx/particles.js';
import { canvasTexture, makeTextMaterial } from '../../../engine/gfx/text2d.js';
import { riseGlyphs, setOpacity } from '../../../engine/anim.js';
import { S, txt, glyphs } from '../lib/type.js';
import { B, C, F, COPY, HANDLE } from '../config.js';

// SHOT 6 (26,25 → 30 s): CTA.
//  "@gouserodev" em cromo 3D (letras voando e pousando), marca "</>", halo,
//  botão "MANDA “SISTEMA” NO DIRECT", cursor clica → balão de DM enviado.
//  fim: flash que emenda no começo (loop perfeito do Reels).

const T0 = B(56);
const LOGO_Y = 0.2;

function poseAt(t) {
  const a = ease.outExpo(clamp(invLerp(B(55.5), B(57.6), t)));
  const d = lerp(5, 21.5, a) - 1.6 * ease.inOutSine(clamp(invLerp(B(57.6), B(63.5), t)));
  const az = lerp(0.35, -0.08, a) + 0.06 * Math.sin((t - T0) * 0.6);
  const el = lerp(0.02, 0.1, a);
  const target = new THREE.Vector3(0, LOGO_Y + lerp(1.2, -0.35, a), 0);
  const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(target);
  pos.x += fbm1(t * 0.6, 61) * 0.08;
  pos.y += fbm1(t * 0.5, 62) * 0.06;
  // mergulho final (emenda com o início)
  const dive = ease.inExpo(clamp(invLerp(B(63.35), B(64), t)));
  pos.lerp(target, dive * 0.85);
  return { pos, target, roll: lerp(-0.25, 0, a) + 0.4 * dive, fov: lerp(75, 42, a) + 30 * dive, t };
}

export class ShotCTA extends Shot {
  constructor(stage, fonts) {
    super(stage, { name: 'cta', start: B(55.5), end: B(64) + 0.01, fov: 45, far: 200 });
    const sc = this.scene;
    sc.fog = new THREE.Fog(C.bg, 20, 60);

    this.grid = makeGrid({ cell: 1, major: 5, fade: 0.05, minor: 0.1, majorI: 0.4 });
    this.grid.position.y = -2.6;
    sc.add(this.grid);

    // halo (anel) atrás da marca
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.04, 10, 220), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(2.2), toneMapped: false }));
    this.halo.position.set(0, LOGO_Y + 1.6, -4);
    sc.add(this.halo);
    this.halo2 = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.012, 6, 220), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(1.1), toneMapped: false }));
    this.halo2.position.copy(this.halo.position);
    sc.add(this.halo2);
    // raios de luz (leque) atrás do halo
    this.rays = new THREE.Group();
    const rayTex = rayTexture();
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 24), new THREE.MeshBasicMaterial({ map: rayTex, color: new THREE.Color(C.green).multiplyScalar(0.03 + hash(i, 2) * 0.045), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.geometry.translate(0, 12, 0);
      m.rotation.z = (i / 10) * Math.PI * 2 + hash(i, 3) * 0.3;
      this.rays.add(m);
    }
    this.rays.position.set(0, LOGO_Y + 1.6, -6);
    sc.add(this.rays);

    // marca "</>"
    this.markFace = chromeMaterial({ matcap: 'chrome', tint: '#4a5a46', gradTop: '#eaffd9', gradBot: C.green, gradIntensity: 1.0, gradH: 0.6, sweepColor: '#ffffff', sweepIntensity: 1.8 });
    this.markSide = chromeMaterial({ matcap: 'dark', rim: C.green, rimIntensity: 0.6 });
    this.mark = new Text3D(fonts.mono, '</>', { size: 2.0, depth: 0.55, letterSpacing: -0.15, materials: [this.markFace, this.markSide], bevelThickness: 0.04, bevelSize: 0.03 });
    this.mark.position.set(0, LOGO_Y + 3.0, 0);
    sc.add(this.mark);

    // "@gouserodev"
    this.face = chromeMaterial({ matcap: 'chrome', tint: '#6b736f', gradTop: '#ffffff', gradBot: '#b8c2bc', gradIntensity: 0.95, gradH: 0.5, sweepColor: '#ffffff', sweepIntensity: 2.2 });
    this.face.uniforms.uSweepWidth.value = 0.55;
    this.side = chromeMaterial({ matcap: 'dark', rim: C.green, rimIntensity: 0.55, rimPow: 3 });
    const probe = new Text3D(fonts.wide, HANDLE, { size: 1, depth: 0.3, materials: [this.face, this.side] });
    const size = 7.2 / probe.width;
    probe.letters.forEach((l) => l.geometry.dispose());
    this.logo = new Text3D(fonts.wide, HANDLE, { size, depth: size * 0.42, letterSpacing: size * 0.02, materials: [this.face, this.side], bevelThickness: size * 0.05, bevelSize: size * 0.03 });
    this.logo.position.set(0, LOGO_Y, 0);
    sc.add(this.logo);

    this.sparks = makeParticles({
      count: 1600,
      seed: 41,
      a: (i, r) => new THREE.Vector3((r() - 0.5) * 7.2, LOGO_Y + (r() - 0.5) * 0.5, 0.3),
      b: (i, r) => new THREE.Vector3((r() - 0.5) * 1.6, r() * 1.4 + 0.2, (r() - 0.2) * 1.2),
      colorA: '#ffffff',
      colorB: C.green,
      intensity: 2.2,
      size: 0.045,
    });
    this.sparks.material.uniforms.uT0.value = B(56.6);
    this.sparks.material.uniforms.uSpeed.value = 6;
    this.sparks.material.uniforms.uLife.value = 1.6;
    this.sparks.material.uniforms.uStagger.value = 0.5;
    sc.add(this.sparks);
    this.dust = makeParticles({ count: 1000, seed: 43, mode: 2, a: (i, r) => new THREE.Vector3((r() - 0.5) * 26, (r() - 0.5) * 16, -r() * 16), colorA: '#ffffff', colorB: C.green, intensity: 0.8, size: 0.04 });
    this.dust.material.uniforms.uNoise.value = 0.6;
    sc.add(this.dust);

    // ── HUD ──
    const shadow = { blur: 30, color: 'rgba(0,0,0,0.92)' };
    this.k1 = glyphs(COPY.ctaKicker[0], S.hook, { shadow, pad: 40, size: 92 });
    this.k2 = glyphs(COPY.ctaKicker[1], S.hook, { shadow, pad: 40, size: 92, colorAt: (i) => (i >= 3 ? C.red : '#ffffff') });
    const kfit = Math.min(1, 930 / this.k1.w);
    this.k1.scale.setScalar(kfit);
    this.k2.scale.setScalar(kfit);
    this.k1.position.set(0, 735, 0);
    this.k2.position.set(0, 638, 0);
    // botão
    this.btn = new THREE.Group();
    const bt = buttonTexture(COPY.ctaButton);
    this.btnMesh = new THREE.Mesh(new THREE.PlaneGeometry(bt.w, bt.h), makeTextMaterial(bt.tex));
    this.btnRing = new THREE.Mesh(new THREE.PlaneGeometry(bt.w, bt.h), makeTextMaterial(ringTexture(bt.w, bt.h)));
    this.btn.add(this.btnRing, this.btnMesh);
    this.btn.position.set(0, -330, 0);
    this.btnW = bt.w;
    this.sub = txt(COPY.ctaSub, S.mono, { size: 30, color: '#9fb8a8', shadow, pad: 30 });
    this.sub.position.set(0, -455, 0);
    // cursor + balão de DM
    this.cursor = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), makeTextMaterial(cursorTexture()));
    this.cursor.geometry.translate(22, -22, 0);
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green), transparent: true }));
    const bb = bubbleTexture('SISTEMA');
    this.bubble = new THREE.Mesh(new THREE.PlaneGeometry(bb.w, bb.h), makeTextMaterial(bb.tex));
    this.hud.add(this.k1, this.k2, this.btn, this.sub, this.ripple, this.bubble, this.cursor);
  }

  update(t, lt, fx) {
    const pose = poseAt(t);
    const beat = t > T0 ? pulse(t, B(Math.floor(t / B(1))), 7) : 0;
    applyPose(this.camera, { ...pose, shake: 0.02 + 0.3 * pulse(t, T0, 6), shakeFreq: 10, shakeSeed: 17 });
    const bl = cameraBlur(poseAt, t, { depth: 12, gain: 0.7 });
    fx.addBlur(bl.x, bl.y);
    fx.zoomBlur += Math.min(0.3, Math.abs(bl.zoom) * 0.5);
    updatePointScale(this.sparks, this.camera);
    updatePointScale(this.dust, this.camera);
    this.sparks.material.uniforms.uTime.value = t;
    this.dust.material.uniforms.uTime.value = t;

    // halo e raios
    const hIn = ease.outExpo(clamp((t - T0) / 0.8));
    this.halo.scale.setScalar(Math.max(0.001, hIn * (1 + 0.02 * beat)));
    this.halo2.scale.setScalar(Math.max(0.001, hIn * 1.0));
    this.halo.rotation.set(0.2 * Math.sin(t * 0.5), 0.25 * Math.sin(t * 0.4), 0);
    this.halo2.rotation.set(-0.15 * Math.sin(t * 0.45), -0.3 * Math.sin(t * 0.35), t * 0.2);
    this.halo.material.color.set(C.green).multiplyScalar(1.6 + 1.2 * beat);
    this.rays.rotation.z = t * 0.08;
    this.rays.scale.setScalar(Math.max(0.001, hIn));

    // letras do @ voando e pousando
    this.logo.letters.forEach((L, i) => {
      const ti = T0 + 0.02 + i * 0.045;
      const s = spring(t - ti, 2.1, 0.5);
      const dir = new THREE.Vector3(hash(i, 1) - 0.5, hash(i, 2) - 0.3, hash(i, 3) * 0.6 + 0.4).normalize().multiplyScalar(14);
      const b = L.userData.base;
      L.position.set(b.x + dir.x * (1 - s), b.y + dir.y * (1 - s), b.z + dir.z * (1 - s));
      L.rotation.set((1 - s) * (hash(i, 4) - 0.5) * 6, (1 - s) * (hash(i, 5) - 0.5) * 6, (1 - s) * (hash(i, 6) - 0.5) * 3);
      L.visible = t >= ti - 0.02;
      L.position.y += 0.08 * pulse(t, B(Math.floor(t / B(1))) + i * 0.01, 8) * (t > B(57.5) ? 1 : 0);
    });
    // varredura de luz
    const swT = [B(57.4), B(60.5), B(62.5)].reduce((a, s) => (t > s ? s : a), -10);
    this.face.uniforms.uSweepPos.value = t - swT < 0.8 ? lerp(-7, 7, ease.inOutCubic((t - swT) / 0.8)) : -1000;
    this.markFace.uniforms.uSweepPos.value = this.face.uniforms.uSweepPos.value;
    // marca "</>"
    const mIn = spring(t - (T0 + 0.35), 1.8, 0.45);
    this.mark.scale.setScalar(Math.max(0.001, mIn));
    this.mark.rotation.y = (1 - Math.min(1, mIn)) * Math.PI * 2 + 0.35 * Math.sin((t - T0) * 1.4);
    this.mark.position.y = LOGO_Y + 3.0 + 0.12 * Math.sin((t - T0) * 2.2);

    // ── HUD ──
    riseGlyphs(this.k1, t, B(56.4), { dur: 0.45, stagger: 0.018 });
    riseGlyphs(this.k2, t, B(57), { dur: 0.45, stagger: 0.022 });
    const bIn = spring(t - B(58), 2.4, 0.42);
    const press = 1 - 0.07 * Math.sin(Math.PI * clamp((t - B(60)) / 0.16));
    const bs = Math.max(0.001, bIn) * (1 + 0.025 * beat * (t > B(58.5) ? 1 : 0)) * press;
    this.btn.scale.setScalar(bs);
    this.btn.visible = t >= B(58);
    // anel pulsando em volta do botão a cada 2 beats
    const rp = ((t - B(58.5)) / B(2)) % 1;
    const rOn = t > B(58.5);
    this.btnRing.scale.set(1 + 0.12 * rp, 1 + 0.5 * rp, 1);
    this.btnRing.material.uniforms.uOpacity.value = rOn ? (1 - rp) * 0.9 : 0;
    this.sub.visible = t > B(58.6);
    this.sub.opacity = clamp((t - B(58.6)) / 0.3);
    // cursor
    const cIn = ease.inOutCubic(clamp((t - B(58.9)) / B(1.0)));
    const cx = lerp(470, this.btnW * 0.26, cIn), cy = lerp(-780, -350, cIn);
    const click = Math.sin(Math.PI * clamp((t - B(60)) / 0.16));
    this.cursor.position.set(cx, cy, 0);
    this.cursor.scale.setScalar(1 - 0.18 * click);
    this.cursor.visible = t > B(58.9) && t < B(62.6);
    // ripple do clique
    const rr = clamp((t - B(60)) / 0.5);
    this.ripple.visible = rr > 0 && rr < 1;
    this.ripple.position.set(cx, cy, 0);
    this.ripple.scale.setScalar(20 + 160 * ease.outCubic(rr));
    this.ripple.material.opacity = 1 - rr;
    // balão de DM enviado
    const bp = spring(t - B(60.3), 2.6, 0.5);
    this.bubble.visible = t > B(60.3) && t < B(63.4);
    this.bubble.scale.setScalar(Math.max(0.001, bp));
    this.bubble.position.set(215, -175 + 22 * ease.outCubic(clamp((t - B(60.3)) / 1)), 0);
    this.bubble.material.uniforms.uOpacity.value = 1 - clamp((t - B(62.8)) / 0.3);

    // saída: tudo some no flash final
    const out = clamp((t - B(63.5)) / B(0.5));
    if (out > 0) {
      [this.k1, this.k2].forEach((g) => setOpacity(g, 1 - out));
      this.btnMesh.material.uniforms.uOpacity.value = 1 - out;
      this.sub.opacity = 1 - out;
    } else this.btnMesh.material.uniforms.uOpacity.value = 1;

    // ── FX ──
    fx.punch += 0.4 * hit(t, T0, 0.005, 6) + 0.2 * hit(t, B(58), 0.005, 8) + 0.12 * hit(t, B(60), 0.005, 10);
    fx.flashTo(0.3 * pulse(t, T0, 10), [0.8, 1, 0.75]);
    fx.chroma += 0.004 * pulse(t, T0, 6);
    fx.bloom += 0.15 * beat;
    // emenda do loop: flash branco nos últimos frames (o vídeo recomeça com o "slam" do gancho)
    fx.flashTo(ease.inQuad(clamp((t - B(63.55)) / B(0.45))) * 0.92, [1, 1, 1]);
    fx.zoomBlur += 0.25 * ease.inExpo(out);
  }
}

function rayTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 256);
  const h = g.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, 32, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buttonTexture(label) {
  const ss = 2;
  const ctx0 = document.createElement('canvas').getContext('2d');
  ctx0.font = `900 54px "${F.heroC}"`;
  const tw = ctx0.measureText(label).width;
  const w = Math.ceil(tw + 170), h = 124;
  const c = document.createElement('canvas');
  c.width = w * ss;
  c.height = h * ss;
  const ctx = c.getContext('2d');
  ctx.scale(ss, ss);
  ctx.shadowColor = 'rgba(57,255,20,0.75)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = C.green;
  ctx.beginPath();
  ctx.roundRect(14, 14, w - 28, h - 28, (h - 28) / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#031006';
  ctx.font = `900 54px "${F.heroC}"`;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 52, h / 2 + 3);
  // seta
  ctx.beginPath();
  const ax = w - 78, ay = h / 2;
  ctx.moveTo(ax - 14, ay - 15);
  ctx.lineTo(ax + 6, ay);
  ctx.lineTo(ax - 14, ay + 15);
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#031006';
  ctx.stroke();
  return { tex: canvasTexture(c), w, h };
}

function ringTexture(w, h) {
  const ss = 2;
  const c = document.createElement('canvas');
  c.width = w * ss;
  c.height = h * ss;
  const ctx = c.getContext('2d');
  ctx.scale(ss, ss);
  ctx.strokeStyle = C.green;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(14, 14, w - 28, h - 28, (h - 28) / 2);
  ctx.stroke();
  return canvasTexture(c);
}

function cursorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ctx.translate(10, 8);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 40);
  ctx.lineTo(10, 31);
  ctx.lineTo(17, 46);
  ctx.lineTo(24, 43);
  ctx.lineTo(17, 28);
  ctx.lineTo(30, 28);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  return canvasTexture(c);
}

function bubbleTexture(text) {
  const ss = 2;
  const w = 330, h = 112;
  const c = document.createElement('canvas');
  c.width = w * ss;
  c.height = h * ss;
  const ctx = c.getContext('2d');
  ctx.scale(ss, ss);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#5bff3a');
  g.addColorStop(1, '#1fc80a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 28, 34);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w - 60, h - 24);
  ctx.lineTo(w - 26, h - 6);
  ctx.lineTo(w - 36, h - 30);
  ctx.fill();
  ctx.fillStyle = '#031006';
  ctx.font = `900 40px "${F.heroC}"`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 36, (h - 20) / 2 + 6);
  ctx.font = `700 22px "${F.mono}"`;
  ctx.fillText('✓✓', w - 82, (h - 20) / 2 + 6);
  return { tex: canvasTexture(c), w, h };
}
