// Player: preview em tempo real (com áudio e scrub) + API determinística de render por frame.
// ?render=1  → modo render (sem UI; o render.mjs chama window.__reel.renderFrame(i))
// ?t=12.5    → abre parado nesse tempo

export function startPlayer(stage, { audioUrl, title = '' } = {}) {
  const params = new URLSearchParams(location.search);
  const renderMode = params.has('render');
  const canvas = stage.renderer.domElement;
  const gl = stage.renderer.getContext();
  const W = stage.w, H = stage.h;
  const total = Math.round(stage.duration * stage.fps);

  // ── modo render ──
  let ws = null;
  const pixels = new Uint8Array(W * H * 4);
  window.__reel = {
    fps: stage.fps,
    duration: stage.duration,
    frames: total,
    width: W,
    height: H,
    connect(port) {
      return new Promise((res, rej) => {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => res(true);
        ws.onerror = (e) => rej(String(e));
      });
    },
    // renderiza o frame i e envia RGBA cru (de baixo para cima) pelo websocket
    async renderFrame(i) {
      const t0 = performance.now();
      stage.renderAt(i / stage.fps);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const t1 = performance.now();
      if (ws) {
        const ack = new Promise((r) => (ws.onmessage = () => r()));
        ws.send(pixels);
        await ack;
      }
      return { render: t1 - t0, total: performance.now() - t0 };
    },
    renderAt(t) {
      stage.renderAt(t);
    },
  };

  if (renderMode) {
    canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;
    window.__reel.ready = true;
    return;
  }

  // ── modo preview ──
  document.body.classList.add('preview');
  const ui = document.createElement('div');
  ui.className = 'ui';
  ui.innerHTML = `
    <button id="play">▶</button>
    <input id="scrub" type="range" min="0" max="${stage.duration}" step="0.001" value="0">
    <span id="tc">0.00s</span>
    <span id="title">${title}</span>`;
  document.body.appendChild(ui);
  const btn = ui.querySelector('#play');
  const scrub = ui.querySelector('#scrub');
  const tc = ui.querySelector('#tc');

  const fit = () => {
    const sh = window.innerHeight - 64, sw = window.innerWidth - 24;
    const s = Math.min(sw / W, sh / H);
    canvas.style.width = `${W * s}px`;
    canvas.style.height = `${H * s}px`;
  };
  window.addEventListener('resize', fit);
  fit();

  const audio = audioUrl ? new Audio(audioUrl) : null;
  let playing = false;
  let t = parseFloat(params.get('t') || '0');
  let startWall = 0, startT = 0;

  const draw = () => {
    stage.renderAt(t);
    scrub.value = t;
    tc.textContent = `${t.toFixed(2)}s · beat ${(t / (60 / 128)).toFixed(1)}`;
  };
  const play = () => {
    playing = true;
    btn.textContent = '❚❚';
    startWall = performance.now();
    startT = t;
    if (audio) {
      audio.currentTime = t;
      audio.play().catch(() => {});
    }
  };
  const pause = () => {
    playing = false;
    btn.textContent = '▶';
    if (audio) audio.pause();
  };
  btn.onclick = () => (playing ? pause() : play());
  scrub.oninput = () => {
    t = parseFloat(scrub.value);
    if (playing) play();
    draw();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? pause() : play();
    }
    if (e.code === 'ArrowRight') { t = Math.min(stage.duration, t + 1 / stage.fps); draw(); }
    if (e.code === 'ArrowLeft') { t = Math.max(0, t - 1 / stage.fps); draw(); }
  });
  const loop = () => {
    if (playing) {
      t = audio && !audio.paused ? audio.currentTime : startT + (performance.now() - startWall) / 1000;
      if (t >= stage.duration) {
        t = 0; // loop, como no Reels
        play();
      }
      draw();
    }
    requestAnimationFrame(loop);
  };
  draw();
  loop();
}
