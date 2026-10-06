import * as THREE from 'three';
import { shake } from './core/random.js';

// Câmera como função pura do tempo: pose(t) → { pos, target, up?, fov?, roll? }.
// O motion blur é derivado da velocidade angular/linear da câmera (obturador virtual).

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _cam = new THREE.PerspectiveCamera();
const _v = new THREE.Vector3();
const _f0 = new THREE.Vector3();
const _f1 = new THREE.Vector3();

export function applyPose(camera, p) {
  camera.position.copy(p.pos);
  camera.up.copy(p.up || new THREE.Vector3(0, 1, 0));
  camera.lookAt(p.target);
  if (p.roll) camera.rotateZ(p.roll);
  if (p.fov && camera.fov !== p.fov) {
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
  }
  if (p.shake) {
    const [sx, sy, sr] = shake(p.t ?? 0, p.shakeFreq ?? 11, p.shakeSeed ?? 3);
    camera.translateX(sx * p.shake);
    camera.translateY(sy * p.shake);
    camera.rotateZ(sr * p.shake * 0.04);
  }
  camera.updateMatrixWorld(true);
}

// Retorna {x, y, zoom} em unidades de UV para o pós (comprimento total do rastro).
export function cameraBlur(poseFn, t, { fps = 60, shutter = 0.5, depth = 10, aspect = 1080 / 1920, gain = 1 } = {}) {
  const dt = 1 / fps;
  const a = poseFn(t - dt);
  const b = poseFn(t);
  _cam.aspect = aspect;
  applyPose(_cam, { ...a, shake: 0 });
  _q0.copy(_cam.quaternion);
  _cam.getWorldDirection(_f0);
  const p0 = _cam.position.clone();
  applyPose(_cam, { ...b, shake: 0 });
  _q1.copy(_cam.quaternion);
  _cam.getWorldDirection(_f1);
  const fovV = THREE.MathUtils.degToRad(b.fov || 50);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
  // rotação relativa no referencial da câmera
  _dq.copy(_q0).invert().multiply(_q1);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(_dq.w)));
  let x = 0, y = 0;
  if (angle > 1e-6) {
    const s = Math.sqrt(1 - _dq.w * _dq.w) || 1;
    const ax = _dq.x / s, ay = _dq.y / s;
    const sign = _dq.w < 0 ? -1 : 1;
    // giro em Y (yaw) move a imagem na horizontal; em X (pitch), na vertical
    x = (-ay * angle * sign) / fovH;
    y = (ax * angle * sign) / fovV;
  }
  // deslocamento lateral também borra (pan/truck)
  _v.copy(_cam.position).sub(p0);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q1);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q1);
  const viewH = 2 * depth * Math.tan(fovV / 2);
  const viewW = viewH * aspect;
  x -= _v.dot(right) / viewW;
  y -= _v.dot(up) / viewH;
  const fwd = _v.dot(_f1);
  const k = shutter * gain;
  return { x: x * k, y: y * k, zoom: (fwd / depth) * k * 1.2 };
}
