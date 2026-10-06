import * as THREE from 'three';
import { Stage } from '../../engine/stage.js';
import { loadFonts } from '../../engine/core/fonts.js';
import { startPlayer } from '../../engine/player.js';
import { ShotSheet } from './shots/s1-sheet.js';
import { ShotSystem } from './shots/s2-system.js';
import { ShotCity } from './shots/s3-city.js';
import { ShotServices } from './shots/s4-services.js';
import { ShotTerminal } from './shots/s5-terminal.js';
import { ShotCTA } from './shots/s6-cta.js';
import { Overlay } from './shots/overlay.js';

const FONT = '../../assets/fonts/';

async function main() {
  const fonts = await loadFonts([
    { family: 'Archivo XC', weight: 900, url: FONT + 'Archivo-ExtraCondensedBlack.ttf', three: 'hero' },
    { family: 'Archivo C', weight: 900, url: FONT + 'Archivo-CondensedBlack.ttf', three: 'heroC' },
    { family: 'Archivo', weight: 900, url: FONT + 'Archivo-Black.ttf' },
    { family: 'Archivo', weight: 800, url: FONT + 'Archivo-ExtraBold.ttf' },
    { family: 'Archivo', weight: 600, url: FONT + 'Archivo-SemiBold.ttf' },
    { family: 'Archivo X', weight: 900, url: FONT + 'Archivo-ExpandedBlack.ttf', three: 'wide' },
    { family: 'JetBrains Mono', weight: 500, url: FONT + 'JetBrainsMono-Medium.ttf' },
    { family: 'JetBrains Mono', weight: 700, url: FONT + 'JetBrainsMono-Bold.ttf', three: 'mono' },
  ]);
  const params = new URLSearchParams(location.search);
  const stage = new Stage({
    width: 1080,
    height: 1920,
    fps: +(params.get('fps') || 60),
    duration: 30,
    msaa: +(params.get('msaa') || 4),
    canvas: document.querySelector('canvas'),
  });
  stage.add(new ShotSheet(stage, fonts));
  stage.add(new ShotSystem(stage, fonts));
  stage.add(new ShotCity(stage, fonts));
  stage.add(new ShotServices(stage, fonts));
  stage.add(new ShotTerminal(stage, fonts));
  stage.add(new ShotCTA(stage, fonts));
  stage.addOverlay(new Overlay(stage));
  // aquece shaders/texturas
  stage.renderAt(0.01);
  startPlayer(stage, { audioUrl: 'audio/soundtrack.wav', title: '@gouserodev — planilha → sistema' });
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55">${e.stack || e}</pre>`);
  window.__reelError = String(e.stack || e);
});
