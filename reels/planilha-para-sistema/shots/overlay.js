import { Shot } from '../../../engine/stage.js';
import { clamp } from '../../../engine/core/time.js';
import { txt, S } from '../lib/type.js';
import { B, HANDLE } from '../config.js';

// Marca d'água discreta (assinatura nos compartilhamentos), some no CTA.
export class Overlay extends Shot {
  constructor(stage) {
    super(stage, { name: 'overlay', start: 0, end: B(55.6) });
    this.mark = txt(HANDLE, S.kicker, { size: 24, letterSpacing: 4, color: '#ffffff' });
    this.mark.position.set(0, 878, 0);
    this.hud.add(this.mark);
  }
  update(t) {
    this.mark.opacity = 0.42 * clamp((t - 0.4) / 0.3) * (1 - clamp((t - B(55)) / 0.3));
  }
}
