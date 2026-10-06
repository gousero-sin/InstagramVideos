import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';

// Carrega fontes para o canvas 2D (FontFace) e, opcionalmente, para texto 3D (TTF → Font).
// specs: [{ family, weight, url, three?: 'chave' }]
export async function loadFonts(specs) {
  const fonts3d = {};
  const ttf = new TTFLoader();
  await Promise.all(
    specs.map(async (s) => {
      const face = new FontFace(s.family, `url(${s.url})`, { weight: String(s.weight), style: 'normal' });
      await face.load();
      document.fonts.add(face);
      if (s.three) {
        const json = await ttf.loadAsync(s.url);
        fonts3d[s.three] = new Font(json);
      }
    })
  );
  await document.fonts.ready;
  return fonts3d;
}
