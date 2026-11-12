// Estúdio 3D (plate de fundo). Câmera casada com a filmagem: nível, altura 1,35 m, FOV vertical 76°.
// A parede direita reproduz a geometria da parede real (onde o portal é aberto).
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
RectAreaLightUniformsLib.init();
const W = 1080, H = 1920;
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#050607');
scene.fog = new THREE.FogExp2('#0a0d10', 0.045);
const cam = new THREE.PerspectiveCamera(76, W / H, 0.05, 60); cam.position.set(0, 1.35, 0); cam.lookAt(0, 1.35, -1);

function noiseTex(base, amp, w = 512, h = 512, streak = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const id = g.createImageData(w, h); let s = 1234567;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const col = new THREE.Color(base);
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) {
    const n = 1 + (rnd() - 0.5) * amp; const i = (y * w + x) * 4;
    id.data[i] = col.r * 255 * n; id.data[i + 1] = col.g * 255 * n; id.data[i + 2] = col.b * 255 * n; id.data[i + 3] = 255; } }
  g.putImageData(id, 0, 0);
  if (streak > 1) { g.globalAlpha = 0.6; g.filter = `blur(${streak}px)`; g.drawImage(c, 0, 0, w, 1, 0, 0, w, h); g.filter = 'none'; }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const M = (o) => new THREE.MeshStandardMaterial(o);
const box = (w, h, d, m, x, y, z, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.y = ry; b.castShadow = b.receiveShadow = true; scene.add(b); return b; };

// ── piso + teto ──
const floorT = noiseTex('#16181b', 0.25); floorT.repeat.set(8, 8);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), M({ map: floorT, roughness: 0.35, metalness: 0.1 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), M({ color: '#0b0c0e', roughness: 1 })); ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.3; scene.add(ceil);

// ── parede direita (painel acústico escuro) — de P1 (0.45,-0.8) a P2 (-0.15,-3.2), estendida ──
const P1 = new THREE.Vector2(0.5, -0.75), P2 = new THREE.Vector2(-0.1305, -1.8605); // divisória: termina em P2 (quina visível)
const dir = P2.clone().sub(P1).normalize(); const A = P1.clone().addScaledVector(dir, -2.5), Bp = P2.clone();
const len = A.distanceTo(Bp); const mid = A.clone().add(Bp).multiplyScalar(0.5);
const wallAng = Math.atan2(-(Bp.y - A.y), Bp.x - A.x);
const feltT = noiseTex('#2b3036', 0.28); feltT.repeat.set(len * 1.5, 5);
let nrm = new THREE.Vector3(Math.sin(wallAng), 0, Math.cos(wallAng));
if (nrm.dot(new THREE.Vector3(-mid.x, 0, -mid.y)) < 0) nrm.multiplyScalar(-1);
const rw = box(len, 3.3, 0.14, M({ map: feltT, roughness: 0.95 }), mid.x - nrm.x * 0.07, 1.65, mid.y - nrm.z * 0.07, wallAng);
const seamM = M({ color: '#0c0e10', roughness: 0.8 });
for (let i = 0; i <= 6; i++) { const p = A.clone().addScaledVector(dir, (i / 6) * len * 0.985); box(0.018, 3.3, 0.02, seamM, p.x + nrm.x * 0.008, 1.65, p.y + nrm.z * 0.008, wallAng); }
const ledWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.35, 0.7) });
const ledGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 1.9, 0.1) });
{ const b = box(len, 0.02, 0.02, ledWarm, mid.x + nrm.x * 0.07, 3.07, mid.y + nrm.z * 0.03, wallAng); b.castShadow = false; }
box(len, 0.22, 0.1, M({ color: '#08090a', roughness: 0.6 }), mid.x + nrm.x * 0.05, 3.19, mid.y + nrm.z * 0.05, wallAng);

// ── parede do fundo: ripado de madeira com LED quente por trás ──
const ZB = -4.6;
const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.3), M({ color: '#0d0c0b', roughness: 1 })); back.position.set(-4, 1.65, ZB); scene.add(back);
const woodT = noiseTex('#7a4a28', 0.35, 64, 512, 3);
const woodM = M({ map: woodT, roughness: 0.55 });
for (let i = 0; i < 70; i++) { const x = -9 + i * 0.13; box(0.075, 3.3, 0.06, woodM, x, 1.65, ZB + 0.05); }
// faixas de LED entre os painéis do ripado
for (const x of [-3.355, -1.925, -0.495]) { const b = box(0.03, 3.1, 0.02, ledWarm, x, 1.6, ZB + 0.085); b.castShadow = false;
  const l = new THREE.PointLight('#ffb070', 5, 5, 2); l.position.set(x, 1.6, ZB + 0.35); scene.add(l); }
// linha neon da marca (verde) horizontal
{ const b = box(5.2, 0.028, 0.03, ledGreen, -2.3, 2.52, ZB + 0.1); b.castShadow = false;
  const l = new THREE.PointLight('#48ff20', 2.2, 4, 2); l.position.set(-2.0, 2.45, ZB + 0.5); scene.add(l); }

// ── softbox prático (esquerda, fundo) ──
const sbx = -1.75, sbz = -3.7;
box(0.03, 2.1, 0.03, M({ color: '#111', roughness: 0.5 }), sbx, 1.05, sbz - 0.05);
box(0.82, 1.12, 0.1, M({ color: '#0a0a0a', roughness: 0.7 }), sbx, 2.25, sbz - 0.06, 0.5);
{ const p = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 1.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 1.8) }));
  p.position.set(sbx + 0.03, 2.25, sbz); p.rotation.y = 0.5; scene.add(p);
  const ra = new THREE.RectAreaLight('#fff1dc', 9, 0.74, 1.04); ra.position.copy(p.position); ra.rotation.y = 0.5 + Math.PI; ra.lookAt(1.5, 1.2, 0); scene.add(ra); }

// ── trilho de spots no teto ──
box(0.05, 0.05, 5, M({ color: '#050505', roughness: 0.4 }), -0.55, 3.2, -2.4);
for (const z of [-1.0, -2.0, -3.0, -4.0]) {
  box(0.09, 0.14, 0.09, M({ color: '#060606', roughness: 0.4 }), -0.55, 3.1, z);
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.6) })); d.rotation.x = Math.PI / 2; d.position.set(-0.55, 3.028, z); scene.add(d);
  const s = new THREE.SpotLight('#ffd9a8', 26, 9, 0.55, 0.8, 2); s.position.set(-0.55, 3.0, z); s.target.position.set(0.25 - 0.25 * (z + 0.8) / 2.4 * -1 * 0 + (0.45 + (z + 0.8) * 0.25) , 0.9, z - 0.3); scene.add(s, s.target);
}
// grazing frio na parede direita (dá volume e contraste com o quente)
{ const s = new THREE.SpotLight('#9fc4ff', 55, 8, 0.7, 1, 2); s.position.set(-1.6, 3.0, -0.6); s.target.position.set(0.2, 1.2, -1.9); s.castShadow = true; s.shadow.mapSize.set(1024, 1024); scene.add(s, s.target); }
// objetos de cena: tripé com painel de LED à esquerda e uma poltrona baixa
box(0.5, 0.42, 0.5, M({ color: '#1c1d20', roughness: 0.9 }), -2.5, 0.21, -3.6, 0.4);
box(0.5, 0.5, 0.12, M({ color: '#1c1d20', roughness: 0.9 }), -2.6, 0.62, -3.82, 0.4);
scene.add(new THREE.HemisphereLight('#465466', '#161009', 0.9));
// lavagem quente rasante vinda do rodateto
for (let i = 1; i < 6; i++) { const p = A.clone().addScaledVector(dir, (i / 6) * len); const l = new THREE.PointLight('#ffb878', 1.6, 3.2, 2); l.position.set(p.x + nrm.x * 0.3, 2.9, p.y + nrm.z * 0.3); scene.add(l); }

renderer.render(scene, cam);
window.__ready = true;
