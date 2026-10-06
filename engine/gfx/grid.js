import * as THREE from 'three';

// Piso de grade infinito (anti-aliasing analítico via fwidth) com anel de choque.
const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBase;
uniform float uCell;
uniform float uMajor;
uniform float uFade;
uniform float uMinorI;
uniform float uMajorI;
uniform vec3 uRingC;
uniform float uRingR;
uniform float uRingW;
uniform vec3 uRingColor;
uniform float uScroll;
uniform vec3 uFogColor;
uniform float uAxis;
varying vec3 vWorld;
float line(vec2 p) {
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4));
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  vec2 w2 = uAxis < 0.5 ? vWorld.xz : vWorld.xy;
  vec2 p = w2 / uCell + vec2(0.0, uScroll);
  float minor = line(p);
  float major = line(p / uMajor);
  float d = uAxis < 0.5 ? length(vWorld.xz - cameraPosition.xz) : length(vWorld - cameraPosition);
  float fade = exp(-d * uFade);
  vec3 col = uBase + uColor * (minor * uMinorI + major * uMajorI);
  float r = length(vWorld.xz - uRingC.xz);
  col += uRingColor * exp(-pow((r - uRingR) / uRingW, 2.0));
  col = mix(uFogColor, col, fade);
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeGrid({ size = 400, color = '#39ff14', cell = 1, major = 5, fade = 0.035, minor = 0.18, majorI = 0.6, base = '#020403', vertical = false } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBase: { value: new THREE.Color(base) },
      uCell: { value: cell },
      uMajor: { value: major },
      uFade: { value: fade },
      uMinorI: { value: minor },
      uMajorI: { value: majorI },
      uRingC: { value: new THREE.Vector3() },
      uRingR: { value: -100 },
      uRingW: { value: 0.6 },
      uRingColor: { value: new THREE.Color(0, 0, 0) },
      uScroll: { value: 0 },
      uFogColor: { value: new THREE.Color('#020304') },
      uAxis: { value: vertical ? 1 : 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    extensions: { derivatives: true },
  });
  const geo = new THREE.PlaneGeometry(size, size);
  if (!vertical) geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}
