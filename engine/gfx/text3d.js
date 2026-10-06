import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// Texto 3D extrudado, letra a letra (cada letra é um Mesh com pivô no próprio centro),
// para que possam voar, girar e "pousar" individualmente.

export class Text3D extends THREE.Group {
  constructor(font, text, o = {}) {
    super();
    const size = o.size ?? 1;
    const depth = o.depth ?? size * 0.28;
    const spacing = o.letterSpacing ?? 0;
    const bevel = o.bevel ?? true;
    const res = font.data.resolution;
    const scale = size / res;
    const mats = o.materials; // [frente, laterais]
    this.letters = [];
    let x = 0;
    const items = [];
    for (const ch of [...text]) {
      const glyph = font.data.glyphs[ch] || font.data.glyphs['?'];
      const adv = (glyph ? glyph.ha : res * 0.5) * scale;
      if (ch !== ' ') {
        const geo = new TextGeometry(ch, {
          font,
          size,
          depth,
          curveSegments: o.curveSegments ?? 6,
          bevelEnabled: bevel,
          bevelThickness: o.bevelThickness ?? size * 0.035,
          bevelSize: o.bevelSize ?? size * 0.022,
          bevelSegments: o.bevelSegments ?? 3,
        });
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const cx = (bb.min.x + bb.max.x) / 2;
        const cz = (bb.min.z + bb.max.z) / 2;
        geo.translate(-cx, 0, -cz);
        items.push({ ch, geo, x: x + cx, w: bb.max.x - bb.min.x });
      }
      x += adv + spacing;
    }
    const total = x - spacing;
    // altura de versal para centralizar verticalmente (usa 'H' como referência)
    const capGlyph = font.data.glyphs['H'];
    let cap = size * 0.72;
    if (capGlyph && capGlyph.y_max !== undefined) cap = capGlyph.y_max * scale;
    else {
      const g = new TextGeometry('H', { font, size, depth: 0.01, curveSegments: 1, bevelEnabled: false });
      g.computeBoundingBox();
      cap = g.boundingBox.max.y;
      g.dispose();
    }
    this.cap = cap;
    this.width = total;
    const ox = o.align === 'left' ? 0 : o.align === 'right' ? -total : -total / 2;
    for (const it of items) {
      it.geo.translate(0, -cap / 2, 0);
      const mesh = new THREE.Mesh(it.geo, mats);
      mesh.position.set(ox + it.x, 0, 0);
      mesh.userData.base = mesh.position.clone();
      mesh.userData.char = it.ch;
      mesh.userData.index = this.letters.length;
      mesh.userData.w = it.w;
      this.add(mesh);
      this.letters.push(mesh);
    }
  }
}
