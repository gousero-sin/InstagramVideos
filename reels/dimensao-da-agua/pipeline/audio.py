#!/usr/bin/env python3
"""Trilha + sound design sintetizados (numpy) e mixagem com a voz original.

    python3 audio.py --src IMG_8928.MOV --work WORKDIR --out mix.wav

A voz é a original (só limpeza leve: passa-alta, redução de ruído, compressão). Música e efeitos ficam
abaixo dela com ducking (sidechain) — a fala sempre na frente.
"""
import argparse, json, os, subprocess, sys, wave
import numpy as np
from scipy import signal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edit as E

SR = 48000
CUT_A, CUT_B, END = E.CUT_A / E.FPS, E.CUT_B / E.FPS, E.SRC_END / E.FPS
DUR = CUT_A + (END - CUT_B)
N = int(DUR * SR)
rng = np.random.default_rng(7)
def o(t): return t if t < CUT_A else t - (CUT_B - CUT_A)       # tempo da fonte → tempo de saída

def env_adsr(n, a=0.01, d=0.1, s=0.6, r=0.2):
    e = np.ones(n) * s; na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na, nd, nr = min(na, n), min(nd, max(0, n - na)), min(nr, n)
    e[:na] = np.linspace(0, 1, na); e[na:na + nd] = np.linspace(1, s, nd); e[n - nr:] *= np.linspace(1, 0, nr); return e
def filt(x, f, kind='low', order=2):
    sos = signal.butter(order, np.clip(f, 20, SR / 2 - 100), kind, fs=SR, output='sos'); return signal.sosfilt(sos, x, axis=0)
def noise(n): return rng.standard_normal(n)
def pan(x, p):   # p∈[-1,1]
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], 1)
class Mix:
    def __init__(s): s.b = np.zeros((N + SR * 6, 2))
    def add(s, t, x, g=1.0, p=0.0):
        if x.ndim == 1: x = pan(x, p)
        i = int(max(0, t) * SR); x = x[:len(s.b) - i]; s.b[i:i + len(x)] += x * g
def sweep_noise(dur, f0, f1, q_low=True, shape=2.0):
    """ruído com filtro varrendo (risers / whooshes) — por blocos com crossfade"""
    n = int(dur * SR); x = noise(n); out = np.zeros(n); B = 2048; win = np.hanning(B * 2)
    for i in range(0, n - B * 2, B):
        k = (i / n) ** shape; f = f0 * (f1 / f0) ** k
        seg = x[i:i + B * 2]
        sos = signal.butter(2, [max(30, f * 0.6), min(SR / 2 - 200, f * 1.6)], 'band', fs=SR, output='sos')
        out[i:i + B * 2] += signal.sosfilt(sos, seg) * win
    return out
def whoosh(dur=0.45, f0=300, f1=2500, up=True):
    x = sweep_noise(dur, f0 if up else f1, f1 if up else f0, shape=1.0); n = len(x)
    return x * np.sin(np.linspace(0, np.pi, n)) ** 1.5
def water_swish(dur=0.5):
    x = whoosh(dur, 500, 3200); n = len(x); t = np.arange(n) / SR
    bl = np.zeros(n)
    for i in range(14):   # bolhinhas
        t0 = rng.random() * dur * 0.9; f = 500 + 1800 * rng.random(); d = 0.03 + 0.05 * rng.random(); m = (t > t0) & (t < t0 + d)
        tt = t[m] - t0; bl[m] += np.sin(2 * np.pi * (f + f * 2.5 * tt / d) * tt) * np.sin(np.pi * tt / d) ** 2 * 0.35
    return x * 0.8 + bl
def plop(f=320, dur=0.16):
    n = int(dur * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * (f * (1 + 2.2 * t / dur)) * t) * np.exp(-t * 18) * (1 - np.exp(-t * 900))
def boom(dur=1.6, f0=90, f1=34):
    n = int(dur * SR); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t * 9)) / SR
    return np.tanh(np.sin(ph) * 1.8) * np.exp(-t * 3.2) + filt(noise(n), 900) * np.exp(-t * 14) * 0.5
def splash(dur=1.1):
    n = int(dur * SR); t = np.arange(n) / SR
    x = filt(noise(n), 5200) - filt(noise(n), 500) * 0.3
    return filt(x, 350, 'high') * (np.exp(-t * 5.5) + 0.3 * np.exp(-t * 1.8)) * (1 - np.exp(-t * 400))
def shimmer(dur=1.8, base=880):
    n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for k, m in enumerate([1, 1.5, 2, 3, 4]): x += np.sin(2 * np.pi * base * m * t + k) * np.exp(-t * (2.5 + k)) / (k + 1)
    return x * (1 - np.exp(-t * 60))
def bubbles_bed(dur, dens=9, lo=250, hi=1400):
    n = int(dur * SR); x = np.zeros(n)
    for i in range(int(dur * dens)):
        t0 = rng.random() * (dur - 0.2); f = lo + (hi - lo) * rng.random() ** 2; d = 0.04 + 0.09 * rng.random()
        m = int(d * SR); tt = np.arange(m) / SR; i0 = int(t0 * SR)
        x[i0:i0 + m] += np.sin(2 * np.pi * (f + f * 1.8 * tt / d) * tt) * np.sin(np.pi * tt / d) ** 2 * (0.3 + 0.7 * rng.random())
    return x
def reverb(x, secs=2.2, wet=0.3):
    n = int(secs * SR); t = np.arange(n) / SR
    ir = np.stack([noise(n), noise(n)], 1) * np.exp(-t * 3.2)[:, None]; ir = filt(ir, 5000); ir /= np.sqrt((ir ** 2).sum(0))
    w = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in (0, 1)], 1)
    return x + w * wet

# ── música: 96 BPM, Lá menor (Am – F – C – G), grade alinhada à entrada do estúdio ──
BPM = 96; BEAT = 60 / BPM; BAR = 4 * BEAT; GRID0 = E.T_STUDIO % BAR
CH = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def pad_note(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros((n, 2))
    for det, p in ((-0.06, -0.6), (0.0, 0), (0.07, 0.6)):
        f = hz(m + det); s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t + 1) + 0.12 * signal.sawtooth(2 * np.pi * f * t)
        x += pan(s, p)
    return x * env_adsr(n, 0.5, 0.3, 0.8, 0.9)[:, None] / 3
def pluck(m, dur=0.5):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    return (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 9) + 0.25 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 14)) * np.exp(-t * 6) * (1 - np.exp(-t * 500))
def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(46 + 110 * np.exp(-t * 32)) / SR
    return np.sin(ph) * np.exp(-t * 9)
def hat():
    n = int(0.05 * SR); t = np.arange(n) / SR; return filt(noise(n), 7000, 'high') * np.exp(-t * 90)
def rim():
    n = int(0.12 * SR); t = np.arange(n) / SR; return (filt(noise(n), 1800, 'high') * np.exp(-t * 45) + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)) * 0.8
def bass(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m - 24)
    return np.tanh((np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * 1.5) * env_adsr(n, 0.01, 0.1, 0.7, 0.08)

def build_music():
    pads, arp, drums = Mix(), Mix(), Mix()
    t_portal, t_water, t_back = o(E.T_WALL), o(E.T_WATER), o(E.T_BACK); t_studio = E.T_STUDIO
    nb = int((DUR - GRID0) / BAR) + 2
    for b in range(-1, nb):
        t0 = GRID0 + b * BAR; ch = CH[b % 4]
        if t0 + BAR < 0: continue
        for m in ch[:3]: pads.add(max(0, t0), pad_note(m, BAR + 0.9), 0.20)
        pads.add(max(0, t0), pad_note(ch[0] - 12, BAR + 0.9), 0.16)
        for s in range(8):      # arpejo em colcheias
            ts = t0 + s * BEAT / 2
            if ts < 0.2: continue
            in_groove = (t_studio <= ts < t_portal) or ts >= t_back + 0.4
            g = 0.16 if in_groove else (0.11 if ts >= t_water else 0.07)
            if t_portal <= ts < t_water: g = 0.05
            note = ch[[0, 2, 1, 3, 2, 1, 3, 2][s]] + 12
            arp.add(ts, pluck(note, 0.7), g, p=0.5 * np.sin(s * 1.7))
            if in_groove:
                if s in (0, 5): drums.add(ts, kick(), 0.55)
                if s in (2, 6): drums.add(ts, rim(), 0.16, p=0.15)
                drums.add(ts, hat(), 0.06 if s % 2 == 0 else 0.10, p=-0.2)
                if s in (0, 3, 5): drums.add(ts, bass(ch[0], BEAT * 0.7), 0.22)
    p = reverb(pads.b, 2.4, 0.35); a = reverb(arp.b, 2.0, 0.45)
    # dimensão da água: tudo abafado (filtro fecha) entre o mergulho e a volta
    t = np.arange(len(p)) / SR
    wet = np.clip((t - t_water) / 0.05, 0, 1) * np.clip((t_back + 0.5 - t) / 0.5, 0, 1)
    ten = np.clip((t - t_portal) / 0.4, 0, 1) * np.clip((t_water - t) / 0.05, 0, 1)        # trecho do portal: tensão
    full = p + a
    low = filt(full, 700)
    mus = full * (1 - wet[:, None]) + low * wet[:, None] * 1.5
    mus = mus * (1 - 0.35 * ten[:, None]) + drums.b
    return mus

def build_sfx():
    M = Mix(); S = lambda ts: o(ts)
    # legendas: whoosh discreto na entrada de cada bloco + "pop" nas palavras de ênfase
    words = json.load(open(os.path.join(ARGS.work, 'words.json')))
    for bi, (t_out, lines) in enumerate(E.caption_script(words)):
        t0 = lines[0][0][1]
        M.add(S(t0) - 0.08, whoosh(0.32, 600, 3800), 0.035, p=0.5 if bi % 2 else -0.5)
        M.add(S(t_out), whoosh(0.3, 500, 2600, up=False), 0.022, p=-0.5 if bi % 2 else 0.5)
        for line in lines:
            for (txt, tw, col) in line:
                if col: M.add(S(tw), plop(520 if col != 'O' else 392, 0.12), 0.05, p=0.2)
    # REC
    for k in (0.15, 0.32): M.add(k, np.sin(2 * np.pi * 1320 * np.arange(int(0.07 * SR)) / SR) * np.hanning(int(0.07 * SR)), 0.05)
    # HUD de rastreamento (5,4–8,4)
    for k in range(14):
        tt = 5.42 + k * 0.21; n = int(0.045 * SR)
        M.add(tt, np.sin(2 * np.pi * (1500 + 500 * (k % 3)) * np.arange(n) / SR) * np.hanning(n), 0.022, p=np.sin(k))
    M.add(5.36, whoosh(0.5, 900, 5200), 0.05)
    # → estúdio
    M.add(E.T_STUDIO - 0.95, sweep_noise(0.95, 250, 6500, shape=2.2) * np.linspace(0, 1, int(0.95 * SR)) ** 2, 0.16)
    M.add(E.T_STUDIO, boom(1.8), 0.50); M.add(E.T_STUDIO, shimmer(2.2, 660), 0.10); M.add(E.T_STUDIO, whoosh(0.9, 400, 5000, up=False), 0.12)
    # água na mão
    M.add(E.T_FORM - 0.05, bubbles_bed(0.9, 26, 500, 2600) * np.linspace(0.3, 1, int(0.9 * SR)), 0.10, p=0.5)
    M.add(E.T_FORM + 0.62, plop(260, 0.25), 0.22, p=0.5); M.add(E.T_FORM + 0.6, shimmer(1.4, 990), 0.05, p=0.5)
    hold = bubbles_bed(E.T_WALL - E.T_FORM - 0.7, 5, 300, 1500)
    M.add(E.T_FORM + 0.7, hold, 0.035, p=0.2)
    for (ts, tc, a, b, lift) in E.FLIGHTS:
        pa, pb = (0.6, -0.6) if a == 'A' else (-0.6, 0.6)
        M.add(ts - 0.03, water_swish(tc - ts), 0.13, p=(pa + pb) / 2); M.add(tc - 0.01, plop(300 if b == 'A' else 240, 0.2), 0.20, p=pb)
    n = int(1.3 * SR); tt = np.arange(n) / SR      # esfera cresce acima da cabeça
    M.add(35.9, np.sin(2 * np.pi * np.cumsum(180 + 260 * (tt / 1.3) ** 2) / SR) * np.sin(np.pi * tt / 1.3) ** 2 + bubbles_bed(1.3, 18, 400, 2200) * 0.5, 0.07)
    M.add(37.75, water_swish(0.75), 0.20, p=0.4)
    # impacto na parede → portal
    M.add(E.T_WALL, splash(1.3), 0.34, p=0.5); M.add(E.T_WALL, boom(1.5, 80, 38), 0.42, p=0.3); M.add(E.T_WALL + 0.05, shimmer(2.0, 523), 0.08, p=0.5)
    dur = CUT_A - E.T_WALL; n = int(dur * SR); tt = np.arange(n) / SR      # zumbido do portal
    dr = (np.sin(2 * np.pi * 55 * tt) + 0.5 * np.sin(2 * np.pi * 82.5 * tt + np.sin(tt * 2.1))) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.7 * tt))
    sw = filt(noise(n), 900) * (0.5 + 0.5 * np.sin(2 * np.pi * 1.3 * tt)) + filt(filt(noise(n), 2400), 900, 'high') * (0.5 + 0.5 * np.sin(2 * np.pi * 0.9 * tt + 1)) * 0.6
    e = np.clip(tt / 0.6, 0, 1) * np.clip((dur - tt) / 0.03, 0, 1)
    M.add(E.T_WALL, pan(dr * 0.10 * e, 0.35) + np.stack([sw * (0.5 + 0.5 * np.sin(tt * 2.2)), sw * (0.5 + 0.5 * np.cos(tt * 2.2))], 1) * 0.05 * e[:, None])
    # sucção → corte → mergulho
    M.add(E.T_SUCK - 0.35, sweep_noise(CUT_A - E.T_SUCK + 0.35, 200, 9000, shape=2.6) * np.linspace(0, 1, int((CUT_A - E.T_SUCK + 0.35) * SR)) ** 2.5, 0.30, p=0.4)
    tw = o(E.T_WATER)
    M.add(tw, boom(2.2, 70, 30), 0.60); M.add(tw, filt(splash(1.6), 1800), 0.30); M.add(tw + 0.05, bubbles_bed(1.8, 30, 200, 1500) * np.linspace(1, 0.1, int(1.8 * SR)), 0.14)
    # ambiente subaquático
    dur = E.T_BACK - E.T_WATER + 0.5; n = int(dur * SR); tt = np.arange(n) / SR
    amb = filt(np.cumsum(noise(n)) / 60, 260); amb = filt(amb, 30, 'high'); e = np.clip(tt / 0.3, 0, 1) * np.clip((dur - tt) / 0.5, 0, 1)
    M.add(tw, pan(amb * e, 0) * 0.10 + pan(bubbles_bed(dur, 6, 180, 900) * e, 0.3) * 0.05)
    # volta ao estúdio (cortina de bolhas)
    tb = o(E.T_BACK)
    M.add(tb, bubbles_bed(0.9, 40, 500, 3000) * np.sin(np.linspace(0, np.pi, int(0.9 * SR))), 0.12); M.add(tb, whoosh(0.8, 300, 5200), 0.14); M.add(tb + 0.55, shimmer(1.5, 784), 0.06)
    # → vinheta
    M.add(DUR - 0.7, sweep_noise(0.7, 300, 8000, shape=2.2) * np.linspace(0, 1, int(0.7 * SR)) ** 2, 0.22)
    return reverb(M.b, 1.6, 0.22)

def voice():
    """voz original: limpeza leve + corte pedido na fala"""
    af = 'highpass=f=75,afftdn=nr=10:nf=-45,equalizer=f=220:t=q:w=1.0:g=-2.5,equalizer=f=3800:t=q:w=1.2:g=2.5,acompressor=threshold=-22dB:ratio=3:attack=6:release=140:makeup=5'
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', ARGS.src, '-map', '0:a:0', '-af', af, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True)
    x = np.frombuffer(p.stdout, np.float32).reshape(-1, 2).astype(np.float64)
    a, b, e = int(CUT_A * SR), int(CUT_B * SR), int(END * SR); f = int(0.012 * SR)
    A_, B_ = x[:a].copy(), x[b:e].copy(); A_[-f:] *= np.linspace(1, 0, f)[:, None]; B_[:f] *= np.linspace(0, 1, f)[:, None]
    v = np.concatenate([A_, B_])[:N]; v[-int(0.25 * SR):] *= np.linspace(1, 0, int(0.25 * SR))[:, None]
    return np.tanh(v / (np.percentile(np.abs(v), 99.9) + 1e-9) * 0.72 * 1.2) / 1.2

def main():
    global ARGS
    ap = argparse.ArgumentParser(); ap.add_argument('--src', required=True); ap.add_argument('--work', required=True); ap.add_argument('--out', required=True)
    ARGS = ap.parse_args()
    v = voice(); mus = build_music()[:N]; sfx = build_sfx()[:N]
    # sidechain: a música abaixa quando há fala
    env = np.abs(v).max(1); k = int(0.03 * SR); env = np.convolve(env, np.ones(k) / k, 'same')
    env = signal.sosfilt(signal.butter(1, 4, fs=SR, output='sos'), env); env = np.clip(env / 0.12, 0, 1)
    mus = mus * (1 - 0.55 * env)[:, None]
    fade = np.clip(np.arange(N) / (1.2 * SR), 0, 1)[:, None]
    mix = v * 1.0 + mus * 0.42 * fade + sfx * 0.85
    mix = np.tanh(mix * 1.05) / 1.05
    w = wave.open(ARGS.out, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes()); w.close()
    for nm, s in (('voz', v), ('musica', mus * 0.5), ('sfx', sfx * 0.85)):
        print(f'{nm}: rms {20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9):.1f} dB  pico {20 * np.log10(np.abs(s).max() + 1e-9):.1f} dB')

if __name__ == '__main__': main()
