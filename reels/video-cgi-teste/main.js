import * as THREE from 'three';
import { loadFonts } from '../../engine/core/fonts.js';
import { FPS, FRAMES, makeTrack, T } from './timeline.js';
import { computeState } from './state.js';
import { Captions } from './captions.js';
import { VERT, COMMON, COMP, FINAL, BLOOM_PRE, BLOOM_DOWN, BLOOM_UP } from './shaders.js';
import { WORLD } from './world.js';

const params = new URLSearchParams(location.search);
const W = +(params.get('w') || 1080);
const H = Math.round((W * 16) / 9);
const WORK = params.get('work') || '/work';
const FONT = '../../assets/fonts/';

const pad = (n) => String(n).padStart(5, '0');
async function loadBitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return createImageBitmap(await r.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

async function main() {
  await loadFonts([
    { family: 'Archivo C', weight: 900, url: FONT + 'Archivo-CondensedBlack.ttf' },
    { family: 'Archivo XC', weight: 900, url: FONT + 'Archivo-ExtraCondensedBlack.ttf' },
    { family: 'Archivo X', weight: 900, url: FONT + 'Archivo-ExpandedBlack.ttf' },
    { family: 'JetBrains Mono', weight: 700, url: FONT + 'JetBrainsMono-Bold.ttf' },
  ]);
  const track = makeTrack(await (await fetch('./data/track.json')).json());
  const wordsData = await (await fetch('./data/words.json')).json();

  const canvas = document.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const gl = renderer.getContext();

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(scene, cam); };
  const mkRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const fsMat = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  const U = (v) => ({ value: v });
  const V2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);

  // ── texturas por quadro ──
  const mkTex = () => { const t = new THREE.Texture(); t.flipY = false; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; return t; };
  const footTex = mkTex(), matteTex = mkTex();
  const captions = new Captions(W, H, wordsData.words);

  // ── passes ──
  const rtWorld = mkRT(W, H), rtComp = mkRT(W, H);
  const mWorld = fsMat(WORLD, {
    uRes: U(V2(W, H)), uT: U(0), uPortal: U(V4()), uWarp: U(0), uCam: U(V4(0, 0, 0, 1)), uBH: U(V4(0.5, 0.7, 1000, 0)), uBH2: U(V4(0, -1, 0, 0)),
    uSN: U(V4(0.7, 0.7, -1, 0)), uSN2: U(V4()), uPl: U(V4(0.2, 0.8, 0.08, 0)),
  });
  const mComp = fsMat(COMP, {
    tFoot: U(footTex), tMatte: U(matteTex), tWorld: U(rtWorld.texture), tCap: U(captions.tex), tFg: U(null),
    uRes: U(V2(W, H)), uT: U(0),
    uLightA: U(V4()), uLightB: U(V4()), uTintA: U(V3()), uTintB: U(V3()),
    uRelight: U(0), uRimCol: U(V3()), uRimDir: U(V2(0, 1)), uRimAmt: U(0), uFgGain: U(1), uExposure: U(1), uMatte: U(V2(0.3, 0.8)), uCapOcc: U(0.55),
  });
  const mFinal = fsMat(FINAL, {
    tComp: U(rtComp.texture), tBloom: U(null), uRes: U(V2(W, H)), uSeed: U(0), uBloom: U(0.5), uChroma: U(0), uShake: U(V2()), uRipple: U(V4()), uZoom: U(V4(0.5, 0.5, 0, 1)),
    uFlash: U(V3(1, 1, 1)), uFlashAmt: U(0), uVignette: U(0.1), uGrain: U(0.02), uSat: U(1), uContrast: U(1), uLift: U(V3()), uGain: U(V3(1, 1, 1)), uFade: U(0),
  });
  // bloom
  const levels = [];
  { let lw = Math.round(W / 2), lh = Math.round(H / 2); for (let i = 0; i < 6; i++) { levels.push({ rt: mkRT(lw, lh), up: mkRT(lw, lh), w: lw, h: lh }); lw = Math.max(1, Math.round(lw / 2)); lh = Math.max(1, Math.round(lh / 2)); } }
  const mPre = fsMat(BLOOM_PRE, { tSrc: U(null), uTexel: U(V2()), uThreshold: U(1), uKnee: U(0.5) });
  const mDown = fsMat(BLOOM_DOWN, { tSrc: U(null), uHalf: U(V2()) });
  const mUp = fsMat(BLOOM_UP, { tLow: U(null), tCur: U(null), uHalf: U(V2()), uScatter: U(0.85) });
  const bloom = (src, S) => {
    const L = levels;
    mPre.uniforms.tSrc.value = src; mPre.uniforms.uTexel.value.set(0.5 / L[0].w, 0.5 / L[0].h);
    mPre.uniforms.uThreshold.value = S.threshold; mPre.uniforms.uKnee.value = S.knee;
    pass(mPre, L[0].rt);
    for (let i = 1; i < L.length; i++) { mDown.uniforms.tSrc.value = L[i - 1].rt.texture; mDown.uniforms.uHalf.value.set(0.5 / L[i - 1].w, 0.5 / L[i - 1].h); pass(mDown, L[i].rt); }
    let low = L[L.length - 1].rt.texture;
    for (let i = L.length - 2; i >= 0; i--) {
      mUp.uniforms.tLow.value = low; mUp.uniforms.tCur.value = L[i].rt.texture;
      mUp.uniforms.uHalf.value.set(0.5 / L[i + 1].w, 0.5 / L[i + 1].h); mUp.uniforms.uScatter.value = S.scatter;
      pass(mUp, L[i].up); low = L[i].up.texture;
    }
    return low;
  };

  // canvas de efeitos aditivos (mágica) — preenchido por fg.js quando existir
  let fg = null;
  try { const m = await import('./fg.js'); fg = new m.FgLayer(W, H, track); mComp.uniforms.tFg.value = fg.tex; } catch (e) { console.log('fg.js indisponível:', e.message); }

  // ── render de um quadro ──
  const pixels = new Uint8Array(W * H * 4);
  let ws = null;
  async function renderFrame(i) {
    const t = i / FPS;
    const [fb, mb] = await Promise.all([loadBitmap(`${WORK}/footage/${pad(i + 1)}.jpg`), loadBitmap(`${WORK}/matte/${pad(i + 1)}.png`).catch(() => null)]);
    footTex.image?.close?.(); matteTex.image?.close?.();
    footTex.image = fb; footTex.needsUpdate = true;
    if (mb) { matteTex.image = mb; matteTex.needsUpdate = true; }
    const S = computeState(t, track, i);
    captions.draw(t, S.capHead);
    await captions.commit();
    if (fg) { fg.draw(t, S); await fg.commit(); }

    // mundo (espaço / buraco negro / supernova)
    const wu = mWorld.uniforms; wu.uT.value = t; S.world && Object.entries(S.world).forEach(([k, v]) => wu[k] && (Array.isArray(v) ? wu[k].value.set(...v) : (wu[k].value = v)));
    pass(mWorld, rtWorld);

    const cu = mComp.uniforms;
    cu.uT.value = t; cu.uExposure.value = S.exposure;
    cu.uLightA.value.set(...S.lightA); cu.uLightB.value.set(...S.lightB); cu.uTintA.value.set(...S.tintA); cu.uTintB.value.set(...S.tintB);
    cu.uRelight.value = S.relight; cu.uRimCol.value.set(...S.rimCol); cu.uRimDir.value.set(...S.rimDir); cu.uRimAmt.value = S.rimAmt; cu.uFgGain.value = S.fgGain;
    pass(mComp, rtComp);

    const bl = bloom(rtComp.texture, S);
    const fu = mFinal.uniforms;
    fu.tBloom.value = bl; fu.uSeed.value = (i % 9973) + 1; fu.uBloom.value = S.bloom / 5;
    fu.uChroma.value = S.chroma; fu.uShake.value.set(...S.shake); fu.uRipple.value.set(...S.ripple); fu.uZoom.value.set(...S.zoom);
    fu.uFlash.value.set(...S.flashCol); fu.uFlashAmt.value = S.flash; fu.uVignette.value = S.vignette; fu.uGrain.value = S.grain; fu.uSat.value = S.sat; fu.uContrast.value = S.contrast;
    fu.uLift.value.set(...S.lift); fu.uGain.value.set(...S.gain); fu.uFade.value = S.fade;
    pass(mFinal, null);

    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (ws) { const ack = new Promise((r) => (ws.onmessage = () => r())); ws.send(pixels); await ack; }
    return true;
  }

  window.__vfx = {
    width: W, height: H, fps: FPS, frames: FRAMES,
    connect(port) { return new Promise((res, rej) => { ws = new WebSocket(`ws://127.0.0.1:${port}`); ws.binaryType = 'arraybuffer'; ws.onopen = () => res(true); ws.onerror = (e) => rej(String(e)); }); },
    renderFrame,
    // depuração: lê um pixel (x,y em px, y p/ cima) de um buffer HDR ('world' | 'comp')
    probe(which, x, y) {
      const rt = which === 'world' ? rtWorld : rtComp;
      const buf = new Uint16Array(4);
      renderer.readRenderTargetPixels(rt, x, y, 1, 1, buf);
      const h2f = (h) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 5.96e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024); };
      return Array.from(buf).map(h2f);
    },
    ready: true,
  };
}

main().catch((e) => { console.error(e); window.__vfxError = String(e.stack || e); });
