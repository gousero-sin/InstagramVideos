import * as THREE from 'three';

// Partículas na GPU, movimento em forma fechada (determinístico, sem integração):
//  modo 0 — explosão: parte de A na direção B com arrasto exponencial
//  modo 1 — morph: viaja de A até B por uma curva com desvio aleatório (stagger)
//  modo 2 — poeira: flutua em torno de A

const VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aRnd;
uniform float uTime;
uniform float uT0;
uniform float uMode;
uniform float uMorph;
uniform float uStagger;
uniform float uDrag;
uniform float uSpeed;
uniform float uSize;
uniform float uLife;
uniform vec3 uGravity;
uniform float uNoise;
uniform float uWobble;
uniform float uPx;
varying float vAlpha;
varying float vTone;
void main() {
  vec3 p;
  vAlpha = 1.0;
  vTone = aRnd.y;
  if (uMode < 0.5) {
    float lt = max(0.0, uTime - uT0 - aRnd.w * uStagger);
    float k = uDrag;
    vec3 v = aB * uSpeed * (0.35 + aRnd.x);
    p = aA + v * (1.0 - exp(-k * lt)) / k + uGravity * lt * lt * 0.5;
    float life = uLife * (0.45 + 0.55 * aRnd.y);
    vAlpha = step(0.0001, uTime - uT0 - aRnd.w * uStagger) * (1.0 - smoothstep(life * 0.5, life, lt));
  } else if (uMode < 1.5) {
    float m = clamp((uMorph - aRnd.w * uStagger) / max(1e-3, 1.0 - uStagger), 0.0, 1.0);
    float e = m < 0.5 ? 4.0 * m * m * m : 1.0 - pow(-2.0 * m + 2.0, 3.0) / 2.0;
    vec3 mid = mix(aA, aB, 0.5) + (aRnd.xyz - 0.5) * uNoise;
    p = mix(mix(aA, mid, e), mix(mid, aB, e), e);
  } else {
    p = aA + vec3(sin(uTime * 0.31 + aRnd.x * 40.0), sin(uTime * 0.23 + aRnd.y * 40.0), sin(uTime * 0.27 + aRnd.z * 40.0)) * uNoise;
    p.y += mod(uTime * (0.1 + aRnd.x * 0.25) + aRnd.z * 20.0, 20.0) - 10.0;
  }
  p += sin(vec3(uTime * 1.7 + aRnd.x * 31.0, uTime * 1.3 + aRnd.y * 17.0, uTime * 1.1 + aRnd.z * 11.0)) * uWobble;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(1.0, uSize * (0.45 + aRnd.z) * uPx / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;
varying float vAlpha;
varying float vTone;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  vec3 c = mix(uColorA, uColorB, vTone);
  gl_FragColor = vec4(c * a * vAlpha * uOpacity, 0.0);
}`;

export function makeParticles({ count, a, b, mode = 0, colorA = '#ffffff', colorB = '#39ff14', intensity = 2, size = 0.08, seed = 1 }) {
  const g = new THREE.BufferGeometry();
  const A = new Float32Array(count * 3);
  const Bv = new Float32Array(count * 3);
  const R = new Float32Array(count * 4);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const pa = a(i, rnd);
    const pb = b ? b(i, rnd) : pa;
    A.set([pa.x, pa.y, pa.z], i * 3);
    Bv.set([pb.x, pb.y, pb.z], i * 3);
    R.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  g.setAttribute('position', new THREE.BufferAttribute(A, 3));
  g.setAttribute('aA', new THREE.BufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(Bv, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(R, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uT0: { value: 0 },
      uMode: { value: mode },
      uMorph: { value: 0 },
      uStagger: { value: 0.3 },
      uDrag: { value: 2.2 },
      uSpeed: { value: 12 },
      uSize: { value: size },
      uLife: { value: 1.6 },
      uGravity: { value: new THREE.Vector3(0, -1.5, 0) },
      uNoise: { value: 2 },
      uWobble: { value: 0 },
      uPx: { value: 1000 },
      uColorA: { value: new THREE.Color(colorA).multiplyScalar(intensity) },
      uColorB: { value: new THREE.Color(colorB).multiplyScalar(intensity) },
      uOpacity: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// atualiza o fator de escala dos pontos para a câmera atual (tamanho em unidades de mundo)
export function updatePointScale(points, camera, heightPx = 1920) {
  points.material.uniforms.uPx.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
