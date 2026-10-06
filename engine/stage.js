import * as THREE from 'three';
import { Post } from './gfx/post.js';

// Estado de efeitos globais por frame. Cada shot ativo SOMA contribuições.
export class FX {
  reset(t) {
    this.t = t;
    this.exposure = 1;
    this.bloom = 1.0;
    this.hudBloom = 0.55;
    this.threshold = 0.82;
    this.knee = 0.45;
    this.scatter = 0.82;
    this.chroma = 0.0018;
    this.blur = [0, 0];
    this.maxBlur = 0.085;
    this.zoomBlur = 0;
    this.zoomCenter = [0.5, 0.5];
    this.glitch = 0;
    this.flash = 0;
    this.flashColor = [1, 1, 1];
    this.vignette = 0.42;
    this.grain = 0.028;
    this.scan = 0.045;
    this.contrast = 1.06;
    this.saturation = 1.06;
    this.tint = [1, 1, 1];
    this.lift = [0.0, 0.004, 0.006];
    this.punch = 0;
    this.invert = 0;
    this.fade = 0;
    return this;
  }
  addBlur(x, y) {
    this.blur[0] += x;
    this.blur[1] += y;
  }
  flashTo(amount, color = [1, 1, 1]) {
    if (amount > this.flash) {
      this.flash = amount;
      this.flashColor = color;
    }
  }
}

// Um "shot" tem uma cena 3D + uma camada de HUD 2D (px) e vive num intervalo de tempo.
export class Shot {
  constructor(stage, { name, start, end, fov = 50, near = 0.1, far = 600 }) {
    this.stage = stage;
    this.name = name;
    this.start = start;
    this.end = end;
    this.scene = new THREE.Scene();
    this.hud = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, stage.w / stage.h, near, far);
  }
  active(t) {
    return t >= this.start && t < this.end;
  }
  // t global (s), lt local (s)
  update(t, lt, fx) {}
  // desenha a cena 3D em rt3d e o HUD (texto/UI, sem motion blur) em rtHud
  render(renderer, hudCam, rt3d, rtHud) {
    renderer.setRenderTarget(rt3d);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    if (this.hud.children.length) {
      renderer.setRenderTarget(rtHud);
      renderer.clearDepth();
      renderer.render(this.hud, hudCam);
    }
  }
}

export class Stage {
  constructor({ width = 1080, height = 1920, fps = 60, duration = 30, msaa = 4, canvas } = {}) {
    this.w = width;
    this.h = height;
    this.fps = fps;
    this.duration = duration;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: msaa,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rtHud = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.post = new Post(renderer, width, height);
    this.hudCam = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -2000, 2000);
    this.hudCam.position.z = 1000;
    this.shots = [];
    this.overlays = []; // shots globais desenhados por cima de tudo
    this.fx = new FX();
    this.clearColor = new THREE.Color('#020304');
  }
  add(shot) {
    this.shots.push(shot);
    return shot;
  }
  addOverlay(shot) {
    this.overlays.push(shot);
    return shot;
  }
  renderAt(t) {
    const fx = this.fx.reset(t);
    const r = this.renderer;
    r.setRenderTarget(this.rtHud);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.setRenderTarget(this.rt);
    r.setClearColor(this.clearColor, 1);
    r.clear(true, true, false);
    for (const s of [...this.shots, ...this.overlays]) {
      if (!s.active(t)) continue;
      s.update(t, t - s.start, fx);
      s.render(r, this.hudCam, this.rt, this.rtHud);
    }
    const frame = Math.round(t * this.fps);
    this.post.render(this.rt.texture, this.rtHud.texture, fx, (frame % 9973) + 1);
  }
}
