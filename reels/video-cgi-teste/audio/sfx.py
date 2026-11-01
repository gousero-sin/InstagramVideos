"""Sound design sintetizado (numpy) para o vídeo de teste — sincronizado com a linha do tempo dos efeitos.

uso: python3 -I sfx.py <video_original.mp4> <saida_mix.wav> [saida_sfx.wav]

Camadas:  "bed" (cama: sofre ducking sob a voz) e "hits" (impactos: passam por cima da voz).
A voz original é mantida e só ganha um limitador transparente para não estourar ao somar os efeitos.
"""
import sys, subprocess, wave
import numpy as np

SR = 48000
DUR = 37.5
N = int(DUR * SR)
rng = np.random.default_rng(7)

# ───────────────────────── tempos (mesma linha do tempo do vídeo) ─────────────────────────
T = dict(cap=[5.73, 6.57, 7.38, 8.08, 8.72, 9.54], m1=12.18, m1_out=16.1, pull=16.05, charge=17.75, throw=22.38, impact=22.78,
         warp_end=24.15, bh_in=28.3, bh_full=29.7, bh_out=31.95, sn_pre=32.55, sn_bang=34.5)

t_all = np.arange(N) / SR


def sec(a, b):  # fatia de índices
    return int(a * SR), int(b * SR)


def add(buf, start, sig, gain=1.0, pan=0.0):
    """soma `sig` (mono ou stereo) em buf[2,N] a partir de `start` (s). pan ∈ [-1,1] (ou array por amostra)."""
    i0 = int(start * SR)
    if i0 >= N: return
    n = min(len(sig), N - i0)
    if n <= 0: return
    s = sig[:n] * gain
    if np.ndim(pan) == 0:
        l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
        buf[0, i0:i0 + n] += s * l; buf[1, i0:i0 + n] += s * r
    else:
        p = np.asarray(pan)[:n]
        buf[0, i0:i0 + n] += s * np.sqrt(0.5 * (1 - p)); buf[1, i0:i0 + n] += s * np.sqrt(0.5 * (1 + p))


def tt(d): return np.arange(int(d * SR)) / SR


def adsr(n, a, r, curve=2.0):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na) ** curve
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** curve
    return e


def stft_shape(x, shape, nfft=2048, hop=512):
    """filtra x por uma resposta em frequência que varia no tempo: shape(t_frame[N], freqs[F]) → ganho [N,F]"""
    pad = nfft
    xp = np.concatenate([np.zeros(pad), x, np.zeros(pad)])
    nfr = 1 + (len(xp) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    win = np.hanning(nfft)
    fr = xp[idx] * win
    sp = np.fft.rfft(fr, axis=1)
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    tf = (hop * np.arange(nfr) + nfft / 2 - pad) / SR
    sp *= shape(tf, freqs)
    out = np.zeros(len(xp))
    norm = np.zeros(len(xp))
    y = np.fft.irfft(sp, axis=1) * win
    for k in range(nfr):
        out[hop * k:hop * k + nfft] += y[k]; norm[hop * k:hop * k + nfft] += win ** 2
    out = out / np.maximum(norm, 1e-6)
    return out[pad:pad + len(x)]


def bump(f0_of_t, bw_oct):
    """ganho gaussiano em log-frequência centrado em f0(t)"""
    def shape(tf, freqs):
        f0 = f0_of_t(tf)[:, None]
        lf = np.log2(np.maximum(freqs[None, :], 20.0) / f0)
        return np.exp(-0.5 * (lf / bw_oct) ** 2)
    return shape


def whoosh(dur, f0, f1, bw=1.1, level=1.0, curve=1.0, peak=0.5):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    fo = lambda tf: f0 * (f1 / f0) ** np.clip(tf / dur, 0, 1) ** curve
    y = stft_shape(noise, bump(fo, bw))
    x = np.linspace(0, 1, n)
    e = np.where(x < peak, (x / peak) ** 2, ((1 - x) / (1 - peak)) ** 1.5)
    y = y / (np.abs(y).max() + 1e-9)
    return y * e * level


def lowpass(x, fc, order=2):
    return stft_shape(x, lambda tf, f: 1.0 / (1.0 + (f[None, :] / fc) ** (2 * order)) * np.ones((len(tf), 1)))


def highpass(x, fc, order=2):
    return stft_shape(x, lambda tf, f: 1.0 - 1.0 / (1.0 + (f[None, :] / fc) ** (2 * order)) * np.ones((len(tf), 1)))


# ───────────────────────── blocos sonoros ─────────────────────────
def pop():
    t = tt(0.06)
    f = 380 + 900 * np.exp(-t * 55)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 60)


def chime(dur=2.2):
    t = tt(dur)
    y = np.zeros_like(t)
    for k, (f, dec, a) in enumerate([(1318.5, 2.6, 1.0), (1760, 2.2, 0.8), (2093, 3.0, 0.7), (2637, 3.4, 0.55), (3520, 4.0, 0.4), (4186, 5.0, 0.25)]):
        st = k * 0.045
        ts = np.clip(t - st, 0, None)
        y += a * np.sin(2 * np.pi * f * ts + rng.uniform(0, 6)) * np.exp(-ts * dec) * (t >= st)
    gl = highpass(rng.standard_normal(len(t)), 5000) * np.exp(-t * 6) * 0.25
    return (y + gl) * adsr(len(t), 0.002, 0.1)


def pad(dur, freqs=(392, 587.3, 784, 1175), trem=5.0):
    t = tt(dur)
    y = np.zeros_like(t)
    for i, f in enumerate(freqs):
        y += np.sin(2 * np.pi * f * t + i) * (0.7 + 0.3 * np.sin(2 * np.pi * (trem + i * 0.37) * t))
        y += 0.5 * np.sin(2 * np.pi * f * 1.003 * t + 2 * i) * 0.5
    y /= len(freqs)
    return y * adsr(len(t), 0.4, 0.6)


def riser(dur, f0=140, f1=1900, tremolo=(4, 26)):
    t = tt(dur)
    x = t / dur
    f = f0 * (f1 / f0) ** (x ** 1.4)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)
    tr = tremolo[0] + (tremolo[1] - tremolo[0]) * x ** 2
    y *= 0.65 + 0.35 * np.sin(2 * np.pi * np.cumsum(tr) / SR)
    sh = highpass(rng.standard_normal(len(t)), 3500) * (x ** 3) * 0.7
    return (y * 0.6 + sh) * (x ** 1.8) * adsr(len(t), 0.05, 0.03)


def boom(dur=3.2, sub=34.0, level_noise=1.0):
    t = tt(dur)
    f = sub + 70 * np.exp(-t * 3.2)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.5)
    n = rng.standard_normal(len(t))
    nb = stft_shape(n, lambda tf, fr_: 1.0 / (1.0 + (fr_[None, :] / (2200 * np.exp(-tf[:, None] * 2.2) + 120)) ** 4))
    nb = nb / (np.abs(nb).max() + 1e-9) * np.exp(-t * 2.0) * level_noise
    crack = highpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 90) * 1.2
    tail = lowpass(rng.standard_normal(len(t)), 900) * np.exp(-t * 0.9) * 0.18 * (1 - np.exp(-t * 6))
    return (s * 1.1 + nb * 0.9 + crack + tail) * adsr(len(t), 0.0005, 0.25, 1.0)


def drone(dur):
    t = tt(dur)
    y = np.zeros_like(t)
    for f, a, ph in [(55.0, 1.0, 0), (82.4, 0.6, 1.1), (110.3, 0.45, 2.3), (164.8, 0.2, 0.7)]:
        y += a * np.sin(2 * np.pi * f * t * (1 + 0.002 * np.sin(2 * np.pi * 0.07 * t + ph)) + ph)
    air = lowpass(rng.standard_normal(len(t)), 420) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * t))
    air /= np.abs(air).max() + 1e-9
    return (y / 2.2 + air * 0.55) * adsr(len(t), 1.6, 1.0)


def whine(dur, f0, f1):
    t = tt(dur); x = t / dur
    f = f0 * (f1 / f0) ** (x ** 1.5)
    f = f * (1 + 0.012 * np.sin(2 * np.pi * (6 + 18 * x) * t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * (x ** 1.6)


def thump(level=1.0):
    t = tt(0.35)
    f = 55 + 60 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * level


def crackle(dur, density=40):
    t = tt(dur)
    y = np.zeros_like(t)
    n = int(density * dur)
    for _ in range(n):
        i = rng.integers(0, len(t) - 400)
        L = rng.integers(60, 360)
        y[i:i + L] += rng.standard_normal(L) * np.exp(-np.arange(L) / (L * 0.2)) * rng.uniform(0.2, 1.0)
    return highpass(y, 1500)


# ───────────────────────── montagem ─────────────────────────
def build():
    bed = np.zeros((2, N)); hits = np.zeros((2, N))

    # legenda: "plips" discretos a cada bloco
    for tc in T['cap']:
        add(bed, tc - 0.02, pop(), 0.10, pan=rng.uniform(-0.2, 0.2))

    # mágica 1: ignição cintilante + zumbido harmônico
    add(hits, T['m1'] - 0.03, chime(), 0.20, pan=0.25)
    add(bed, T['m1'] - 0.1, whoosh(0.8, 500, 7000, 1.0, 0.5, peak=0.35), 0.22, pan=0.2)
    add(bed, T['m1'] + 0.1, pad(T['m1_out'] - T['m1'] + 0.2), 0.05, pan=0.0)
    for k in range(5):
        add(bed, T['m1'] + 0.6 + k * 0.7 + rng.uniform(0, 0.3), chime(1.2), 0.035, pan=rng.uniform(-0.7, 0.7))

    # puxar: varrida para a esquerda
    add(bed, T['pull'] - 0.1, whoosh(1.0, 2500, 600, 1.2, 0.6, peak=0.4), 0.30, pan=np.linspace(0.6, -0.7, int(1.0 * SR)))
    # concentrar: riser crescente + faíscas + pulsos
    d = T['throw'] - T['charge']
    add(bed, T['charge'], riser(d, 150, 2100), 0.13)
    add(bed, T['charge'], crackle(d, 55) * np.linspace(0.05, 0.8, int(d * SR)), 0.30, pan=0.0)
    add(bed, T['charge'] + 2.5, pad(d - 2.5, (130.8, 196, 261.6, 392), 6.5), 0.05)
    for k in range(10):
        add(bed, T['charge'] + 1.0 + k * 0.42, whoosh(0.5, 3500, 900, 1.0, 0.4, peak=0.3), 0.04 + 0.03 * k / 10, pan=rng.uniform(-0.8, 0.8))
    # lançamento: whoosh de aproximação + impacto
    add(hits, T['throw'] - 0.05, whoosh(0.55, 400, 9000, 1.3, 1.0, curve=1.8, peak=0.8), 0.45)
    add(hits, T['impact'] - 0.012, boom(3.4, 36), 0.62)
    add(hits, T['impact'], chime(2.6), 0.13, pan=-0.1)

    # teleporte: hiperespaço
    add(hits, T['impact'] + 0.02, whoosh(1.5, 9000, 260, 1.6, 1.0, curve=0.7, peak=0.25), 0.34, pan=np.linspace(-0.4, 0.4, int(1.5 * SR)))
    add(bed, T['impact'] + 0.3, highpass(rng.standard_normal(int(1.2 * SR)), 5000) * adsr(int(1.2 * SR), 0.05, 0.9) * 0.15, 0.30)
    add(bed, 23.4, drone(DUR - 23.4), 0.095, pan=0.0)

    # buraco negro: nascimento (sucção), ronco gravitacional, ondulação, colapso
    add(hits, T['bh_in'] - 0.35, whoosh(0.9, 200, 3500, 1.4, 0.8, curve=1.0, peak=0.9), 0.30, pan=0.0)
    add(hits, T['bh_in'] + 0.45, boom(2.2, 30, 0.5), 0.34)
    L = T['bh_out'] - T['bh_in'] + 0.4
    n = int(L * SR); t = np.arange(n) / SR
    rumble = np.sin(2 * np.pi * 38 * t) + 0.6 * np.sin(2 * np.pi * 57 * t + 1) + 0.3 * np.sin(2 * np.pi * 76 * t)
    rumble *= adsr(n, 0.9, 0.7) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.9 * t))
    rumble += lowpass(rng.standard_normal(n), 160) * adsr(n, 0.9, 0.7) * 3.0
    add(bed, T['bh_in'] - 0.1, rumble, 0.14)
    wob = tt(1.6); f = 260 * np.exp(-wob * 0.9) + 60
    wsig = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.04 * np.sin(2 * np.pi * 5.5 * wob))) / SR) * adsr(len(wob), 0.2, 0.7)
    add(bed, T['bh_in'] + 0.8, wsig, 0.075, pan=0.15)
    add(hits, T['bh_out'] - 0.45, whoosh(0.55, 5200, 180, 1.3, 1.0, curve=0.8, peak=0.7), 0.28)
    add(hits, T['bh_out'] + 0.05, boom(1.8, 40, 0.5), 0.28)

    # supernova: tensão (apito + batimentos) → silêncio → explosão
    dp = T['sn_bang'] - T['sn_pre']
    wh = whine(dp - 0.08, 700, 5600)
    add(bed, T['sn_pre'], wh, 0.06, pan=0.1)
    tk, gap = T['sn_pre'] + 0.25, 0.62
    while tk < T['sn_bang'] - 0.2:
        add(bed, tk, thump(), 0.30)
        tk += gap; gap = max(0.13, gap * 0.82)
    add(bed, T['sn_pre'], whoosh(dp - 0.1, 300, 6000, 1.5, 0.8, curve=2.2, peak=0.98), 0.14)
    add(hits, T['sn_bang'] - 0.004, boom(4.8, 30), 0.80)
    add(hits, T['sn_bang'], highpass(rng.standard_normal(int(0.5 * SR)), 2000) * np.exp(-tt(0.5) * 9), 0.45, pan=0.0)
    add(hits, T['sn_bang'] + 0.05, whoosh(2.8, 11000, 400, 1.7, 1.0, curve=0.6, peak=0.08), 0.30, pan=np.linspace(0.0, 0.0, int(2.8 * SR)))
    add(hits, T['sn_bang'] + 0.2, crackle(2.8, 90) * np.exp(-tt(2.8) * 1.1), 0.30)
    add(hits, T['sn_bang'] + 0.1, chime(3.2), 0.15, pan=0.2)
    return bed, hits


def read_voice(video):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', video, '-vn', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'])
    v = np.frombuffer(raw, np.float32).reshape(-1, 2).T.astype(np.float64)
    out = np.zeros((2, N)); n = min(N, v.shape[1]); out[:, :n] = v[:, :n]
    return out


def smooth_env(x, atk=0.01, rel=0.18):
    """envoltória (RMS ~ 20 ms) com ataque/liberação"""
    m = np.sqrt(np.convolve((x[0] ** 2 + x[1] ** 2) * 0.5, np.ones(960) / 960, mode='same'))
    y = np.zeros_like(m); a = np.exp(-1 / (atk * SR)); r = np.exp(-1 / (rel * SR)); s = 0.0
    step = 48  # processa em blocos de 1 ms (rápido)
    for i in range(0, len(m), step):
        v = m[i:i + step].max()
        s = a * s + (1 - a) * v if v > s else r * s + (1 - r) * v
        y[i:i + step] = s
    return y


def limiter(x, ceiling=0.80, lookahead=0.004, release=0.12):
    """limitador por pico (ganho suavizado, sem distorção harmônica)"""
    pk = np.abs(x).max(axis=0)
    blk = 48
    nb = len(pk) // blk + 1
    pb = np.array([pk[i * blk:(i + 1) * blk].max() if i * blk < len(pk) else 0 for i in range(nb)])
    g = np.minimum(1.0, ceiling / np.maximum(pb, 1e-9))
    la = int(lookahead * SR / blk) + 1
    g = np.minimum.reduce([np.roll(g, -k) for k in range(la)])
    out = np.ones_like(g); cur = 1.0; rel = np.exp(-blk / (release * SR))
    for i in range(nb):
        cur = g[i] if g[i] < cur else rel * cur + (1 - rel) * g[i]
        out[i] = cur
    gain = np.repeat(out, blk)[:len(pk)]
    # suaviza o ataque para não "clicar"
    k = np.hanning(blk * 2 + 1); k /= k.sum()
    gain = np.minimum(gain, np.convolve(gain, k, mode='same') + 1e-9) if False else np.convolve(np.pad(gain, blk, mode='edge'), k, mode='same')[blk:-blk]
    return x * np.minimum(gain, 1.0)


def write_wav(path, x):
    y = np.clip(x.T, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    video, out_mix = sys.argv[1], sys.argv[2]
    out_sfx = sys.argv[3] if len(sys.argv) > 3 else None
    voice = read_voice(video)
    bed, hits = build()
    env = smooth_env(voice)
    duck = 1.0 - 0.55 * np.clip((env - 0.015) / 0.09, 0, 1)
    sfx = bed * duck + hits * (1.0 - 0.35 * np.clip((env - 0.02) / 0.09, 0, 1))
    mix = voice * 0.9 + sfx
    mix = limiter(mix)
    write_wav(out_mix, mix)
    if out_sfx: write_wav(out_sfx, limiter(sfx))
    print('ok', out_mix, 'pico', float(np.abs(mix).max()))
