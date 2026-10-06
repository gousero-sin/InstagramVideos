import * as THREE from 'three';
import { Shot } from '../../../engine/stage.js';
import { ease, clamp, lerp, hit, pulse, spring, smoothstep } from '../../../engine/core/time.js';
import { hash, fbm1 } from '../../../engine/core/random.js';
import { applyPose, cameraBlur } from '../../../engine/camera.js';
import { chromeMaterial } from '../../../engine/gfx/materials.js';
import { makeGrid } from '../../../engine/gfx/grid.js';
import { makeParticles, updatePointScale } from '../../../engine/gfx/particles.js';
import { Text2D } from '../../../engine/gfx/text2d.js';
import { DynamicText } from '../../../engine/anim.js';
import { S, txt } from '../lib/type.js';
import { appLayers, kanbanColumn, dealCard, phoneScreen, toast, uiPlane } from '../lib/ui.js';
import { B, C, F, COPY } from '../config.js';

// SHOT 4 (15 → 22,5 s): O QUE EU CONSTRUO — elevador vertical por 4 pódios.
//  cada troca é um "chicote" para cima no beat (B36, B40, B44), com blur vertical.

const GAP = 30;
const TK = [B(32), B(36), B(40), B(44), B(48)];
const WHIP = 0.34;
const DEG = Math.PI / 180;
const AZ = [-0.42, 0.34, -0.3, 0.38];

function whipK(t, k) {
  return ease.whip(clamp((t - (TK[k] - WHIP / 2)) / WHIP));
}

function poseAt(t) {
  let y = lerp(-6, 0, ease.outExpo(clamp((t - B(32)) / 0.4)));
  let az = AZ[0];
  for (let k = 1; k <= 3; k++) {
    const w = whipK(t, k);
    y += GAP * w;
    az += (AZ[k] - AZ[k - 1]) * w;
  }
  const exit = ease.inExpo(clamp((t - B(47.55)) / B(0.45)));
  y += 34 * exit;
  az += 0.05 * Math.sin((t - B(32)) * 0.9);
  const target = new THREE.Vector3(0, y + 1.25, 0);
  const d = 13.5 - 1.2 * Math.sin(((t - B(32)) / B(4)) * Math.PI) * 0.4;
  const pos = new THREE.Vector3(Math.sin(az) * d, y + 2.2, Math.cos(az) * d);
  pos.x += fbm1(t * 0.8, 41) * 0.12;
  pos.y += fbm1(t * 0.7, 42) * 0.08;
  return { pos, target, roll: 0.02 * Math.sin(t * 1.3), fov: 50, t };
}

export class ShotServices extends Shot {
  constructor(stage, fonts) {
    super(stage, { name: 'services', start: B(32), end: B(48), fov: 50, far: 200 });
    const sc = this.scene;
    sc.fog = new THREE.Fog(C.bg, 18, 52);

    // parede de grade (dá leitura do movimento vertical)
    this.wall = makeGrid({ vertical: true, cell: 1.5, major: 4, fade: 0.03, minor: 0.1, majorI: 0.35 });
    this.wall.position.set(0, 50, -16);
    sc.add(this.wall);
    this.dust = makeParticles({
      count: 1600,
      seed: 21,
      mode: 2,
      a: (i, r) => new THREE.Vector3((r() - 0.5) * 30, r() * 150 - 20, (r() - 0.5) * 24 - 2),
      colorA: '#ffffff',
      colorB: C.green,
      intensity: 0.8,
      size: 0.05,
    });
    this.dust.material.uniforms.uNoise.value = 0.8;
    sc.add(this.dust);

    // pódios
    this.podiums = [];
    const podMat = chromeMaterial({ matcap: 'dark', rim: C.green, rimIntensity: 0.25 });
    const glowTex = radial();
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      const topMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#030604') });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.95, 0.4, 72), [podMat, topMat, podMat]);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.025, 8, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(2), toneMapped: false }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.2;
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(C.green).multiplyScalar(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.position.y = 0.22;
      g.add(base, ring, disc);
      g.position.set(0, k * GAP - 2.4, 0);
      g.userData = { ring, disc };
      sc.add(g);
      this.podiums.push(g);
    }

    this.buildWeb();
    this.buildCRM();
    this.buildAI();
    this.buildApp();

    // ── HUD ──
    const shadow = { blur: 30, color: 'rgba(0,0,0,0.92)' };
    this.kicker = txt(COPY.servicesKicker, S.kicker, { size: 30, align: 'left' });
    this.kicker.position.set(-440, 772, 0);
    this.rule = new THREE.Mesh(new THREE.PlaneGeometry(880, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(0.6), transparent: true, opacity: 0.6 }));
    this.rule.position.set(0, 742, 0);
    this.hud.add(this.kicker, this.rule);
    this.titles = COPY.services.map((sv, k) => {
      const title = txt(sv.title, S.hook, { shadow, pad: 40, size: 128 });
      const sub = txt(sv.sub, S.mono, { size: 36, color: C.greenSoft, shadow, pad: 30 });
      const num = txt(`0${k + 1}/04`, S.kicker, { size: 30, color: '#d8ffcc', align: 'right' });
      this.hud.add(title, sub, num);
      return { title, sub, num };
    });
  }

  // ── 01 SISTEMAS WEB: app "explodido" em camadas ──
  buildWeb() {
    const L = appLayers();
    const g = new THREE.Group();
    const s = 0.0092;
    this.web = L.map((l, i) => {
      const m = uiPlane(l.tex, l.w, l.h, s);
      const off = [[0, 0], [0.62, 0.86], [0.62, -0.78], [1.25, 1.9]][i];
      m.userData = { off, i };
      g.add(m);
      return m;
    });
    g.position.set(0, 1.4, 0);
    g.rotation.set(-0.12, -0.5, 0.02);
    this.webGroup = g;
    this.scene.add(g);
  }

  // ── 02 CRM: kanban com negócios andando até FECHADO ──
  buildCRM() {
    const g = new THREE.Group();
    const s = 0.0092;
    const cols = ['LEADS', 'PROPOSTA', 'FECHADO ✓'].map((t, i) => {
      const c = kanbanColumn(t, i === 2);
      const m = uiPlane(c.tex, c.w, c.h, s);
      m.position.set((i - 1) * 2.3, 0, 0);
      g.add(m);
      return m;
    });
    this.colX = cols.map((c) => c.position.x);
    const deals = [
      ['Clínica Vida', 'R$ 21.300'],
      ['Mercado Silva', 'R$ 12.480'],
      ['Auto Peças JR', 'R$ 8.920'],
      ['Studio Arq', 'R$ 5.640'],
      ['Padaria Sol', 'R$ 3.200'],
      ['Ótica Foco', 'R$ 6.900'],
    ];
    // [coluna inicial, slot inicial, movimentos: [tempo(beat), coluna, slot]]
    const plan = [
      [1, 0, [[36.6, 2, 1]]],
      [0, 0, [[37.1, 1, 0], [38.6, 2, 2]]],
      [1, 1, [[37.6, 2, 3]]],
      [0, 1, [[38.1, 1, 1]]],
      [0, 2, [[38.9, 1, 2]]],
      [2, 0, []],
    ];
    this.deals = deals.map((d, i) => {
      const a = dealCard(d[0], d[1], false);
      const b = dealCard(d[0], d[1], true);
      const m = uiPlane(a.tex, a.w, a.h, s);
      m.userData = { texA: a.tex, texB: b.tex, plan: plan[i] };
      m.position.z = 0.05;
      g.add(m);
      return m;
    });
    this.closed = new DynamicText({
      width: 520,
      height: 90,
      draw: (ctx, st, w, h) => {
        ctx.font = `800 52px "${F.sans}"`;
        ctx.letterSpacing = '-1px';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.green;
        ctx.fillText(st.v, w / 2, h / 2);
      },
    });
    this.closed.material.depthTest = true;
    this.closed.scale.setScalar(0.0105);
    this.closed.position.set(0, 2.85, 0.1);
    g.add(this.closed);
    g.position.set(0, GAP + 1.1, 0);
    g.rotation.set(-0.06, 0.32, 0);
    this.crm = g;
    this.scene.add(g);
  }

  // ── 03 AUTOMAÇÃO + IA: esfera neural com pulsos ──
  buildAI() {
    const g = new THREE.Group();
    const N = 230;
    const pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = ga * i;
      const R = 2.5 * (0.92 + hash(i, 3) * 0.16);
      pts.push(new THREE.Vector3(Math.cos(th) * r * R, y * R, Math.sin(th) * r * R));
    }
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(hash(i, 4) - 0.5, hash(i, 5) - 0.5, hash(i, 6) - 0.5).normalize().multiplyScalar(0.9 + hash(i, 7) * 0.9);
      pts.push(v);
    }
    // arestas: 3 vizinhos mais próximos
    const seg = [];
    const seen = new Set();
    pts.forEach((p, i) => {
      const near = pts.map((q, j) => [j, p.distanceToSquared(q)]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3);
      near.forEach(([j]) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        seg.push([i, j]);
      });
    });
    const pos = new Float32Array(seg.length * 6);
    const at = new Float32Array(seg.length * 2);
    const sd = new Float32Array(seg.length * 2);
    seg.forEach(([i, j], k) => {
      pos.set([pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z], k * 6);
      at.set([0, 1], k * 2);
      const r = hash(k, 8);
      sd.set([r, r], k * 2);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    lg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    this.aiLines = new THREE.LineSegments(
      lg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uGrow: { value: 0 }, uBeat: { value: 0 } },
        vertexShader: `attribute float aT; attribute float aSeed; varying float vT; varying float vS; uniform float uGrow;
          void main(){ vT=aT; vS=aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position*uGrow,1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uBeat; varying float vT; varying float vS;
          void main(){ float p = fract(vT - uTime*(0.8+vS) + vS*7.0); float pul = smoothstep(0.82,1.0,p);
            vec3 c = vec3(0.06,0.45,0.03)*(0.55+uBeat*0.6) + vec3(0.7,2.6,0.4)*pul*step(0.35,vS);
            gl_FragColor = vec4(c,1.0); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    g.add(this.aiLines);
    const pg = new THREE.BufferGeometry().setFromPoints(pts);
    this.aiNodes = new THREE.Points(pg, new THREE.PointsMaterial({ color: new THREE.Color(C.greenSoft).multiplyScalar(2.2), size: 0.11, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(this.aiNodes);
    this.aiCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 3), chromeMaterial({ matcap: 'neon', gradTop: '#eaffd9', gradBot: C.green, gradIntensity: 1.1, gradH: 0.6 }));
    g.add(this.aiCore);
    // anéis + tokens orbitando
    this.aiRings = [];
    this.aiTokens = [];
    const tokens = ['webhook', 'if / else', 'cron 08:00', 'IA ✦', 'API', '=>', 'WhatsApp', 'e-mail'];
    [[3.25, 0.5, 0.2], [3.65, -0.7, 0.9]].forEach(([r, tx, tz], k) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(C.green).multiplyScalar(1.2), transparent: true, opacity: 0.8, depthWrite: false }));
      const holder = new THREE.Group();
      holder.rotation.set(Math.PI / 2 + tx, tz, 0);
      holder.add(ring);
      g.add(holder);
      this.aiRings.push({ holder, r, k });
    });
    tokens.forEach((s, i) => {
      const t2 = new Text2D(s, { family: F.mono, weight: 700, size: 26, color: '#d8ffcc', bg: { color: 'rgba(6,20,8,0.9)', padX: 12, padY: 5, radius: 8, stroke: { width: 2, color: 'rgba(57,255,20,0.7)' } } });
      t2.material.depthTest = true;
      t2.scale.setScalar(0.0105);
      g.add(t2);
      this.aiTokens.push({ m: t2, ring: i % 2, phase: (i / tokens.length) * Math.PI * 2 + hash(i, 2) });
    });
    g.position.set(0, 2 * GAP + 1.3, 0);
    this.ai = g;
    this.scene.add(g);
  }

  // ── 04 SITES & APPS: celular 3D + notificações ──
  buildApp() {
    const g = new THREE.Group();
    const w = 2.3, h = 4.75, r = 0.42;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const body = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 16 });
    body.translate(0, 0, -0.1);
    const phone = new THREE.Mesh(body, [chromeMaterial({ matcap: 'dark', rim: C.green, rimIntensity: 0.35 }), chromeMaterial({ matcap: 'chrome', tint: '#9aa39e', rim: C.green, rimIntensity: 0.4 })]);
    const scr = phoneScreen();
    this.screenTex = scr.tex;
    const sw = w - 0.16, shh = h - 0.18;
    this.screenTex.repeat.set(1, (shh / sw) * (scr.w / scr.h));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, shh), new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: false }));
    screen.position.z = 0.17;
    const island = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.17), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    island.position.set(0, shh / 2 - 0.18, 0.175);
    const pg = new THREE.Group();
    pg.add(phone, screen, island);
    g.add(pg);
    this.phone = pg;
    this.toasts = [
      [toast('Nova venda!', 'R$ 389,90 · Pix', 'R$'), [-1.85, 1.75, 0.9], 45.0],
      [toast('Novo lead', 'Carla M. · via site', '+'), [1.85, 0.35, 1.1], 45.6],
      [toast('Pedido enviado', '#4821 · rastreio ok', '✓'), [-1.75, -1.35, 0.7], 46.2],
    ].map(([tt, p, b]) => {
      const m = uiPlane(tt.tex, tt.w, tt.h, 0.0085);
      m.position.set(...p);
      m.userData = { p, t0: B(b) };
      g.add(m);
      return m;
    });
    g.position.set(0, 3 * GAP + 1.4, 0);
    this.app = g;
    this.scene.add(g);
  }

  update(t, lt, fx) {
    const pose = poseAt(t);
    const beat = pulse(t, B(Math.floor(t / B(1))), 7);
    const whipNow = [1, 2, 3].reduce((a, k) => Math.max(a, 1 - Math.abs(t - TK[k]) / (WHIP / 2)), 0);
    applyPose(this.camera, { ...pose, shake: 0.03 + 0.12 * Math.max(0, whipNow), shakeFreq: 12, shakeSeed: 11 });
    const bl = cameraBlur(poseAt, t, { depth: 13, gain: 0.8 });
    fx.addBlur(bl.x, bl.y);
    updatePointScale(this.dust, this.camera);
    this.dust.material.uniforms.uTime.value = t;

    this.podiums.forEach((p, k) => {
      const { ring, disc } = p.userData;
      ring.material.color.set(C.green).multiplyScalar(1.3 + 1.2 * beat);
      disc.material.color.set(C.green).multiplyScalar(0.05 + 0.05 * beat);
    });

    // 01 web
    {
      const t0 = TK[0];
      const explode = 0.35 + 0.65 * smoothstep(t0 + B(1), t0 + B(2), t) - 0.25 * beat;
      this.web.forEach((m, i) => {
        const p = ease.outExpo(clamp((t - t0 + 0.12 - i * 0.06) / 0.45));
        const [ox, oy] = m.userData.off;
        m.position.set(ox, oy + lerp(-4, 0, p), i * (0.25 + 0.75 * explode));
        m.material.uniforms.uOpacity.value = p > 0 ? 1 : 0;
      });
      this.webGroup.rotation.y = -0.5 + 0.12 * Math.sin((t - t0) * 1.2);
      this.webGroup.visible = t < TK[1] + 0.5;
    }
    // 02 CRM
    {
      const s = 0.0092;
      this.deals.forEach((m) => {
        const [c0, s0, moves] = m.userData.plan;
        let col = c0, slot = s0, z = 0.05, rz = 0, won = c0 === 2;
        let x = this.colX[col], y = 1.55 - slot * 0.8;
        for (const [bt, c1, s1] of moves) {
          const T = B(bt);
          const p = clamp((t - T) / 0.36);
          if (p <= 0) break;
          const e = ease.inOutCubic(p);
          const x1 = this.colX[c1], y1 = 1.55 - s1 * 0.8;
          x = lerp(this.colX[col], x1, e);
          y = lerp(1.55 - slot * 0.8, y1, e) + Math.sin(e * Math.PI) * 0.5;
          z = 0.05 + Math.sin(e * Math.PI) * 1.3;
          rz = Math.sin(e * Math.PI) * -0.18;
          if (p >= 1) {
            col = c1;
            slot = s1;
            x = x1;
            y = y1;
            if (c1 === 2) won = { at: T + 0.36 };
          }
        }
        m.position.set(x, y, z);
        m.rotation.z = rz;
        const isWon = won === true || (won && t >= won.at);
        m.material.uniforms.map.value = isWon ? m.userData.texB : m.userData.texA;
        const pop = won && won.at ? 1 + 0.25 * pulse(t, won.at, 9) : 1;
        m.scale.setScalar(pop);
      });
      // contador soma cada negócio fechado com uma rolagem rápida
      const closes = [[B(36.6) + 0.36, 21300], [B(37.6) + 0.36, 8920], [B(38.6) + 0.36, 12480]];
      const v = closes.reduce((a, [T, amt]) => a + amt * ease.outCubic(clamp((t - T) / 0.4)), 6900);
      this.closed.update({ v: 'R$ ' + Math.round(v).toLocaleString('pt-BR') + ' fechados' });
      this.crm.rotation.y = 0.32 + 0.08 * Math.sin((t - TK[1]) * 1.1);
      this.crm.visible = t > TK[1] - 0.6 && t < TK[2] + 0.6;
    }
    // 03 IA
    {
      const t0 = TK[2];
      const grow = ease.outExpo(clamp((t - t0 + 0.15) / 0.6));
      this.aiLines.material.uniforms.uTime.value = t;
      this.aiLines.material.uniforms.uGrow.value = Math.max(0.001, grow);
      this.aiLines.material.uniforms.uBeat.value = beat;
      this.aiNodes.scale.setScalar(Math.max(0.001, grow));
      this.aiCore.scale.setScalar(Math.max(0.001, grow * (1 + 0.15 * beat)));
      this.ai.rotation.y = (t - t0) * 0.5;
      this.ai.rotation.x = 0.15 * Math.sin(t * 0.7);
      this.aiTokens.forEach((tk) => {
        const R = this.aiRings[tk.ring];
        const a = tk.phase + (t - t0) * (tk.ring ? -0.7 : 0.9);
        const v = new THREE.Vector3(Math.cos(a) * R.r, Math.sin(a) * R.r, 0).applyEuler(R.holder.rotation);
        tk.m.position.copy(v);
        // billboard: anula a rotação do grupo
        tk.m.quaternion.copy(this.ai.quaternion).invert().multiply(this.camera.quaternion);
        tk.m.material.uniforms.uOpacity.value = grow;
      });
      this.ai.visible = t > TK[2] - 0.6 && t < TK[3] + 0.6;
    }
    // 04 app
    {
      const t0 = TK[3];
      const flip = spring(t - t0 + 0.05, 1.6, 0.5);
      this.phone.rotation.set(0.08 * Math.sin(t * 0.9), -Math.PI * 2 * (1 - flip) + 0.32 * Math.sin((t - t0) * 0.8) - 0.2, 0.04);
      const sc = 0.5 + 0.5 * Math.min(1, flip * 1.2);
      this.phone.scale.setScalar(sc);
      const scroll = 0.45 * ease.inOutCubic(clamp((t - B(45)) / 0.45)) + 0.45 * ease.inOutCubic(clamp((t - B(46.5)) / 0.45));
      this.screenTex.offset.y = (1 - this.screenTex.repeat.y) * (1 - scroll);
      this.toasts.forEach((m, i) => {
        const s = spring(t - m.userData.t0, 3.0, 0.5);
        m.scale.setScalar(Math.max(0.001, s));
        m.material.uniforms.uOpacity.value = t > m.userData.t0 ? 1 : 0;
        const [x, y, z] = m.userData.p;
        m.position.set(x, y + 0.08 * Math.sin(t * 2 + i), z);
        m.quaternion.copy(this.camera.quaternion);
      });
      this.app.visible = t > TK[3] - 0.6;
    }

    // ── HUD ──
    this.kicker.visible = t > B(32.1);
    this.kicker.material.uniforms.uOpacity.value = clamp((t - B(32.1)) / 0.15) * (1 - clamp((t - B(47.6)) / 0.2));
    const ru = ease.outExpo(clamp((t - B(32.1)) / 0.6));
    this.rule.scale.set(Math.max(0.001, ru), 1, 1);
    this.rule.material.opacity = 0.6 * (1 - clamp((t - B(47.6)) / 0.2));
    this.titles.forEach(({ title, sub, num }, k) => {
      // a saída termina antes da entrada seguinte (sem sobreposição)
      const tin = TK[k] + (k === 0 ? 0.1 : 0.03);
      const tout = TK[k + 1] - 0.15;
      const pin = ease.outExpo(clamp((t - tin) / 0.42));
      const pout = k === 3 ? ease.inExpo(clamp((t - B(47.6)) / 0.25)) : ease.inCubic(clamp((t - tout) / 0.17));
      const vis = t >= tin && pout < 1;
      [title, sub, num].forEach((m) => (m.visible = vis));
      if (!vis) return;
      const dy = (1 - pin) * 170 - pout * 190;
      title.position.set(0, 652 + dy, 0);
      sub.position.set(0, 552 + dy * 1.15, 0);
      num.position.set(440, 772, 0);
      num.setClip(300, 745, 600, 800);
      num.position.y = 772 + dy * 0.35;
      title.setClip(-600, 560, 600, 745);
      sub.setClip(-600, 505, 600, 600);
      title.blur = 3 * (1 - pin) + 3 * pout;
      sub.blur = 2 * (1 - pin) + 2 * pout;
      num.opacity = 0.9 * pin * (1 - pout);
    });

    // ── FX ──
    for (let k = 1; k <= 3; k++) {
      fx.flashTo(0.1 * pulse(t, TK[k], 16), [0.8, 1, 0.75]);
      fx.chroma += 0.004 * Math.exp(-Math.abs(t - TK[k]) * 12);
    }
    fx.punch += 0.25 * hit(t, B(32), 0.005, 7);
    fx.flashTo(0.18 * smoothstep(B(47.8), B(48), t), [0.85, 1, 0.8]);
  }
}

function radial() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
