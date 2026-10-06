import * as THREE from 'three';
import { Shot } from '../../../engine/stage.js';
import { ease, invLerp, clamp, lerp, hit, pulse } from '../../../engine/core/time.js';
import { hash, fbm1 } from '../../../engine/core/random.js';
import { applyPose, cameraBlur } from '../../../engine/camera.js';
import { makeParticles, updatePointScale } from '../../../engine/gfx/particles.js';
import { Text2D } from '../../../engine/gfx/text2d.js';
import { DynamicText, riseGlyphs, setBlur } from '../../../engine/anim.js';
import { S, glyphs, GlitchText } from '../lib/type.js';
import { card } from '../lib/ui.js';
import { B, C, F, COPY } from '../config.js';

// SHOT 5 (22,5 → 26,25 s): o deploy.
//  terminal de vidro digitando o "build" da empresa → ✔ SISTEMA NO AR
//  B53 "DO CAOS" (vermelho, riscado) → B54 "AO CONTROLE." → zoom ATRAVÉS do "O" para o CTA

const CMD = 'npx criar-sistema';
const STEPS = ['planilhas importadas', 'banco de dados', 'DRE + fluxo de caixa', 'CRM + automações', 'dashboard ao vivo', 'deploy na nuvem'];
const T_CMD = B(48.1);
const T_STEP0 = B(49.1);
const STEP_DT = B(0.5);
const T_DONE = B(52.25);

function poseAt(t) {
  const a = ease.outCubic(clamp(invLerp(B(48), B(52.25), t)));
  const az = lerp(-0.62, 0.0, a);
  const el = lerp(-0.18, 0.03, a);
  const d = lerp(8.4, 10.6, ease.inOutSine(clamp(invLerp(B(48), B(53), t)))) - 0.9 * pulse(t, T_DONE, 4);
  const push = ease.inQuad(clamp(invLerp(B(53), B(56), t)));
  const target = new THREE.Vector3(0, 0.5, 0);
  const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d + 4 * push).add(target);
  pos.x += fbm1(t * 0.7, 51) * 0.1;
  pos.y += fbm1(t * 0.6, 52) * 0.06;
  return { pos, target, roll: lerp(0.1, -0.01, a), fov: lerp(58, 46, a), t };
}

export class ShotTerminal extends Shot {
  constructor(stage) {
    super(stage, { name: 'terminal', start: B(48), end: B(56), fov: 50, far: 120 });
    const sc = this.scene;

    // código "chovendo" ao fundo em camadas (parallax)
    this.rain = [];
    const snippets = ['const caixa = await db.fluxo.sum()', 'if (saldo < meta) alertar(gestor)', 'export async function gerarDRE(mes)', 'await whatsapp.enviar(lead, proposta)', 'SELECT SUM(valor) FROM vendas', 'cron("0 8 * * *", relatorioDiario)', 'return dashboard.render(kpis)', 'await pix.conciliar(extrato)', 'estoque.repor(produto, minimo)', 'api.post("/pedidos", pedido)'];
    for (let i = 0; i < 26; i++) {
      const s = snippets[i % snippets.length];
      const m = new Text2D(s, { family: F.mono, weight: 500, size: 30, color: i % 5 === 0 ? '#39ff14' : '#2f5a35' });
      m.material.depthTest = true;
      const z = -6 - hash(i, 2) * 14;
      m.scale.setScalar(0.012);
      m.userData = { x: (hash(i, 3) - 0.5) * 16, y0: (hash(i, 4) - 0.5) * 22, z, sp: 0.4 + hash(i, 5) * 0.8 };
      sc.add(m);
      this.rain.push(m);
    }
    this.dust = makeParticles({ count: 900, seed: 31, mode: 2, a: (i, r) => new THREE.Vector3((r() - 0.5) * 20, (r() - 0.5) * 16, -r() * 14 + 2), colorA: '#ffffff', colorB: C.green, intensity: 0.7, size: 0.035 });
    this.dust.material.uniforms.uNoise.value = 0.5;
    sc.add(this.dust);

    // janela do terminal
    const W = 860, H = 800;
    this.term = new DynamicText({
      width: W,
      height: H,
      ss: 1.5,
      draw: (ctx, st, w, h) => this.drawTerminal(ctx, st, w, h),
    });
    this.term.material.depthTest = true;
    this.term.scale.setScalar(0.0049);
    this.termGroup = new THREE.Group();
    this.termGroup.add(this.term);
    sc.add(this.termGroup);
    // halo verde atrás da janela
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(11, 10), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(C.green).multiplyScalar(0.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.position.z = -1.5;
    this.termGroup.add(this.halo);

    // ── HUD ──
    const shadow = { blur: 34, color: 'rgba(0,0,0,0.95)' };
    this.caos = new GlitchText(COPY.control[0], { ...S.giant, size: 210, shadow, pad: 50, color: C.red }, { seed: 77, ghost1: '#ffffff', ghost2: C.cyan });
    this.caos.position.set(0, 300, 0);
    this.strike = new THREE.Mesh(new THREE.PlaneGeometry(1, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff') }));
    this.strike.position.set(0, 300, 0);
    this.ctrl = glyphs(COPY.control[1], { ...S.giant, size: 210, shadow, pad: 50, color: C.green });
    const fit = Math.min(1, 940 / this.ctrl.w);
    this.ctrlFit = fit;
    this.ctrl.scale.setScalar(fit);
    this.ctrl.position.set(0, 60, 0);
    // centro do "O" de CONTROLE (glifo 4: A,O,C,O → usa o primeiro O de CONTROLE)
    this.oGlyph = this.ctrl.glyphs.find((gg, i) => gg.userData.char === 'O' && i > 1) || this.ctrl.glyphs[1];
    // legenda do processo (responde a objeção "meus dados estão todos em planilha")
    const lshadow = { blur: 30, color: 'rgba(0,0,0,0.92)' };
    this.d1 = glyphs(COPY.deploy[0], S.hook, { shadow: lshadow, pad: 40, size: 104 });
    this.d2 = glyphs(COPY.deploy[1], S.hook, { shadow: lshadow, pad: 40, size: 104, color: C.green });
    const dfit = Math.min(1, 930 / Math.max(this.d1.w, this.d2.w));
    this.d1.scale.setScalar(dfit);
    this.d2.scale.setScalar(dfit);
    this.d1.position.set(0, 700, 0);
    this.d2.position.set(0, 596, 0);
    this.hud.add(this.caos, this.strike, this.ctrl, this.d1, this.d2);
  }

  drawTerminal(ctx, st, w, h) {
    card(ctx, w, h, { radius: 24, top: 'rgba(10,16,13,0.95)', bottom: 'rgba(4,7,6,0.96)', border: 'rgba(57,255,20,0.5)' });
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.beginPath();
    ctx.roundRect(3, 3, w - 6, 58, [24, 24, 0, 0]);
    ctx.fill();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(34 + i * 28, 32, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = `500 22px "${F.mono}"`;
    ctx.fillStyle = '#7f9a8a';
    ctx.textAlign = 'center';
    ctx.fillText('gousero@dev ~ sua-empresa', w / 2 + 40, 40);
    ctx.textAlign = 'left';
    const x0 = 44;
    let y = 132;
    const LH = 64;
    ctx.font = `700 36px "${F.mono}"`;
    ctx.fillStyle = C.green;
    ctx.fillText('$', x0, y);
    ctx.fillStyle = '#f1f7f3';
    const cmd = CMD.slice(0, st.cmd);
    ctx.fillText(cmd, x0 + 38, y);
    if (st.cursor !== 1) {
      const cw = ctx.measureText(cmd).width;
      ctx.fillStyle = C.green;
      if (st.cursor === 0 || st.cursor === 2) ctx.fillRect(x0 + 46 + cw, y - 30, 18, 38);
    }
    y += LH + 10;
    ctx.font = `500 33px "${F.mono}"`;
    for (let i = 0; i < st.steps; i++) {
      const a = STEPS[i];
      const p = st.prog[i];
      ctx.fillStyle = '#5f7568';
      ctx.fillText('›', x0, y);
      ctx.fillStyle = '#d9e8df';
      ctx.fillText(a, x0 + 34, y);
      const aw = ctx.measureText(a).width;
      const maxDots = Math.max(0, Math.floor((w - x0 - 120 - (x0 + 34 + aw)) / 20));
      ctx.fillStyle = '#3c5546';
      ctx.fillText(' ' + '.'.repeat(Math.floor(maxDots * p)), x0 + 34 + aw, y);
      if (p >= 1) {
        ctx.fillStyle = C.green;
        ctx.font = `800 36px "${F.sans}"`;
        ctx.fillText('✓', w - x0 - 40, y);
        ctx.font = `500 33px "${F.mono}"`;
      }
      y += LH;
    }
    // barra de progresso
    const by = h - 150;
    const bw = w - 2 * x0 - 120;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(x0, by, bw, 26, 13);
    ctx.fill();
    const pw = bw * st.bar;
    if (pw > 2) {
      const gr = ctx.createLinearGradient(x0, 0, x0 + pw, 0);
      gr.addColorStop(0, '#1f8f0c');
      gr.addColorStop(1, C.green);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.roundRect(x0, by, pw, 26, 13);
      ctx.fill();
    }
    ctx.fillStyle = '#f1f7f3';
    ctx.font = `700 30px "${F.mono}"`;
    ctx.fillText(Math.round(st.bar * 100) + '%', w - x0 - 100, by + 24);
    if (st.done) {
      ctx.font = `900 52px "${F.heroC}"`;
      ctx.fillStyle = C.green;
      ctx.fillText('✔ SISTEMA NO AR', x0, h - 46);
    }
  }

  update(t, lt, fx) {
    const pose = poseAt(t);
    const beat = pulse(t, B(Math.floor(t / B(1))), 7);
    applyPose(this.camera, { ...pose, shake: 0.02 + 0.2 * pulse(t, T_DONE, 6) + 0.15 * pulse(t, B(48), 7), shakeFreq: 10, shakeSeed: 13 });
    const bl = cameraBlur(poseAt, t, { depth: 9, gain: 0.7 });
    fx.addBlur(bl.x, bl.y);
    updatePointScale(this.dust, this.camera);
    this.dust.material.uniforms.uTime.value = t;

    // chuva de código
    this.rain.forEach((m) => {
      const u = m.userData;
      const y = ((u.y0 + (t - B(48)) * u.sp * 2.2 + 11) % 22) - 11;
      m.position.set(u.x, y, u.z);
      m.quaternion.copy(this.camera.quaternion);
      m.material.uniforms.uOpacity.value = 0.32;
    });

    // estado do terminal
    const cmd = Math.floor(clamp((t - T_CMD) / 0.55) * CMD.length);
    let steps = 0;
    const prog = [];
    STEPS.forEach((_, i) => {
      const ts = T_STEP0 + i * STEP_DT;
      if (t >= ts) {
        steps = i + 1;
        prog.push(clamp((t - ts) / (STEP_DT * 0.7)));
      }
    });
    const bar = ease.inOutSine(clamp((t - T_STEP0) / (T_DONE - T_STEP0)));
    const done = t >= T_DONE;
    const cursor = t < T_STEP0 ? 0 : 1;
    this.term.update({ cmd, steps, prog: prog.map((p) => Math.round(p * 20) / 20), bar: Math.round(bar * 100) / 100, done, cursor: cursor && Math.floor(t * 4) % 2 ? 2 : cursor });
    // entrada da janela + recuo final
    const inP = ease.outExpo(clamp((t - B(48)) / 0.5));
    const away = ease.inOutCubic(clamp((t - B(52.6)) / B(1.0)));
    this.termGroup.position.set(0, lerp(-3, 0, inP) + 0.6 * away, lerp(-6, 0, inP) - 6 * away);
    this.termGroup.rotation.set(lerp(0.5, 0, inP), 0, 0);
    const dim = 1 - 0.8 * away;
    this.term.material.uniforms.uColor.value.setScalar(dim * (1 + 0.25 * pulse(t, T_DONE, 5)));
    this.halo.material.color.set(C.green).multiplyScalar((0.05 + 0.16 * pulse(t, T_DONE, 4) + 0.02 * beat) * dim);
    // some no início da transição pelo "O" (o CTA já está sendo desenhado por baixo)
    const hide = t >= B(55.5);
    this.scene.visible = !hide;

    // ── HUD: legenda do deploy ──
    riseGlyphs(this.d1, t, B(48.5), { dur: 0.42, stagger: 0.016 });
    riseGlyphs(this.d2, t, B(49.5), { dur: 0.42, stagger: 0.018 });
    if (t >= B(52.85)) {
      const p = ease.inExpo(clamp((t - B(52.85)) / 0.12));
      [this.d1, this.d2].forEach((g) => g.glyphs.forEach((gl) => (gl.opacity = 1 - p)));
      if (p >= 1) this.d1.visible = this.d2.visible = false;
    }

    // ── HUD: DO CAOS → AO CONTROLE. ──
    const c0 = B(53);
    const caosOn = t >= c0 && t < B(55.5);
    this.caos.visible = caosOn;
    if (caosOn) {
      const p = ease.outExpo(clamp((t - c0) / 0.24));
      const s = lerp(1.8, 1, p);
      this.caos.scale.set(s, s, 1);
      this.caos.glitch(t, 0.3 + 0.7 * pulse(t, c0, 7), clamp((t - c0) / 0.05));
      this.caos.setBlur(3 * (1 - p));
      // risco atravessando "DO CAOS"
      const sp = ease.outExpo(clamp((t - c0 - B(0.5)) / 0.3));
      this.strike.visible = sp > 0;
      this.strike.scale.set(Math.max(0.001, this.caos.w * 1.06 * sp), 1, 1);
      this.strike.position.set((-this.caos.w * 1.06 * (1 - sp)) / 2, 285, 0);
      this.caos.position.y = 300 + 40 * ease.inExpo(clamp((t - B(55)) / B(0.5)));
    } else this.strike.visible = false;
    const k0 = B(54);
    riseGlyphs(this.ctrl, t, k0, { dur: 0.36, stagger: 0.018 });
    // zoom através do "O"
    const z = clamp((t - B(55.35)) / (B(56) - B(55.35)));
    if (z > 0) {
      const e = ease.inExpo(z);
      const sc = this.ctrlFit * Math.exp(Math.log(60) * e);
      // o centro do "O" desliza para o centro da tela enquanto escala 60×
      this.ctrl.scale.setScalar(sc);
      this.ctrl.position.x = -this.oGlyph.position.x * sc * e;
      this.ctrl.position.y = 60 * (1 - e);
      setBlur(this.ctrl, 2.5 * e);
    } else {
      this.ctrl.scale.setScalar(this.ctrlFit);
      this.ctrl.position.set(0, 60, 0);
    }

    // ── FX ──
    fx.flashTo(0.2 * pulse(t, B(48), 18), [0.85, 1, 0.8]);
    fx.flashTo(0.22 * pulse(t, T_DONE, 10), [0.6, 1, 0.5]);
    fx.punch += 0.3 * hit(t, T_DONE, 0.005, 6) + 0.35 * hit(t, c0, 0.005, 7) + 0.45 * hit(t, k0, 0.005, 6);
    fx.glitch += 0.55 * pulse(t, c0, 9);
    fx.chroma += 0.006 * pulse(t, c0, 6);
    fx.zoomBlur += 0.25 * ease.inExpo(z);
    fx.exposure *= 1 - 0.35 * ease.inCubic(clamp((t - B(53)) / B(1)));
  }
}
