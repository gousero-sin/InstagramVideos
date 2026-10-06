#!/usr/bin/env python3
"""Trilha + sound design do reel "planilha → sistema" (@gouserodev).

Tudo sintetizado do zero com numpy/scipy, sincronizado à grade de 128 BPM
usada pela animação (16 compassos = 30,0 s, emenda perfeita no loop do Reels).

Uso:  python3 soundtrack.py  →  gera soundtrack.wav (48 kHz, estéreo, 16 bits)
"""
import os
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 128
BEAT = 60 / BPM
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(128)


def b(x):
    """beat → segundos"""
    return x * BEAT


def tt(d):
    return np.arange(int(d * SR)) / SR


# ───────────────────────────── barramentos ─────────────────────────────
class Bus:
    def __init__(self):
        self.L = np.zeros(N)
        self.R = np.zeros(N)

    def add(self, sig, t0, gain=1.0, pan=0.0):
        if sig.ndim == 2:
            sl, sr = sig[0], sig[1]
        else:
            sl = sr = sig
        i0 = int(round(t0 * SR))
        if i0 >= N:
            return
        if i0 < 0:
            sl, sr = sl[-i0:], sr[-i0:]
            i0 = 0
        n = min(len(sl), N - i0)
        gl = gain * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
        gr = gain * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
        self.L[i0:i0 + n] += sl[:n] * gl
        self.R[i0:i0 + n] += sr[:n] * gr

    def stereo(self):
        return np.stack([self.L, self.R])


drums, bass, music, sfx, verb_send = Bus(), Bus(), Bus(), Bus(), Bus()


# ───────────────────────────── utilitários DSP ─────────────────────────────
def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def bp(x, f1, f2, order=2):
    sos = signal.butter(order, [f1, min(f2, SR * 0.45)], 'band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def env_exp(n, decay):
    return np.exp(-np.arange(n) / SR / decay)


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na, endpoint=False) if na else e[:na]
    nd2 = min(nd, max(0, n - na))
    e[na:na + nd2] = np.linspace(1, s, nd2, endpoint=False)
    if nr and n > nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def saw(freq, d, phase=0.0):
    t = tt(d)
    if np.isscalar(freq):
        ph = (t * freq + phase) % 1.0
    else:
        ph = (np.cumsum(freq) / SR + phase) % 1.0
    return 2 * ph - 1


def sine(freq, d, phase=0.0):
    t = tt(d)
    if np.isscalar(freq):
        return np.sin(2 * np.pi * (t * freq + phase))
    return np.sin(2 * np.pi * (np.cumsum(freq) / SR + phase))


def square(freq, d):
    return np.sign(sine(freq, d) + 1e-9)


def noise(d):
    return rng.standard_normal(int(d * SR))


def mx(*sigs):
    """soma sinais de tamanhos diferentes"""
    n = max(len(x) for x in sigs)
    out = np.zeros(n)
    for x in sigs:
        out[: len(x)] += x
    return out


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def n2f(name):
    """'A3' → Hz"""
    p, o = name[:-1], int(name[-1])
    return midi(12 * (o + 1) + NOTE[p])


def sweep_noise(d, f0, f1, width=0.35, curve=2.0):
    """ruído com banda que varre f0→f1 (STFT mask) — risers/whooshes"""
    x = noise(d + 0.1)
    f, t, Z = signal.stft(x, fs=SR, nperseg=1024)
    u = np.clip(t / d, 0, 1) ** curve
    fc = f0 * (f1 / f0) ** u
    lf = np.log(np.maximum(f, 1))[:, None]
    mask = np.exp(-((lf - np.log(fc)[None, :]) ** 2) / (2 * width ** 2))
    _, y = signal.istft(Z * mask, fs=SR, nperseg=1024)
    y = y[: int(d * SR)]
    return y / (np.max(np.abs(y)) + 1e-9)


# ───────────────────────────── instrumentos ─────────────────────────────
def kick(punch=1.0, d=0.5):
    t = tt(d)
    f = 45 + 110 * np.exp(-t / 0.035) * punch + 25 * np.exp(-t / 0.2)
    body = sine(f, d) * np.exp(-t / 0.28)
    click = hp(noise(0.012), 2500) * np.linspace(1, 0, int(0.012 * SR)) * 0.5
    body[: len(click)] += click
    return np.tanh(body * 1.6) * 0.9


def clap(d=0.35):
    n = noise(d)
    e = np.zeros(int(d * SR))
    for k, off in enumerate([0, 0.011, 0.022]):
        i = int(off * SR)
        e[i:] += env_exp(len(e) - i, 0.012 if k < 2 else 0.11) * (0.8 if k < 2 else 1.0)
    return bp(n, 900, 6000) * e * 0.8


def snare(d=0.25):
    t = tt(d)
    body = sine(185 * (1 + 0.4 * np.exp(-t / 0.01)), d) * np.exp(-t / 0.06) * 0.6
    nz = bp(noise(d), 1500, 9000) * np.exp(-t / 0.09)
    return body + nz * 0.8


def hat(open_=False, d=None):
    d = d or (0.32 if open_ else 0.05)
    t = tt(d)
    metal = sum(square(f, d) for f in [3140, 4280, 5370, 6520, 7810, 9050]) / 6
    x = hp(metal * 0.5 + noise(d) * 0.6, 7000)
    return x * np.exp(-t / (0.11 if open_ else 0.014)) * 0.55


def crash(d=2.2):
    t = tt(d)
    x = hp(noise(d), 5000) + 0.3 * hp(sum(square(f, d) for f in [3920, 5140, 6870]) / 3, 4000)
    return x * np.exp(-t / 0.9) * 0.4


def impact(size=1.0, d=1.8):
    t = tt(d)
    sub = sine(28 + 70 * np.exp(-t / 0.12), d) * np.exp(-t / (0.5 * size + 0.2))
    thump = lp(noise(d), 300) * np.exp(-t / 0.08) * 2.5
    crack = hp(noise(d), 1200) * np.exp(-t / 0.05) * 0.7
    x = np.tanh((sub * 1.4 + thump + crack) * 1.3)
    return x * 0.9 * size


def whoosh(d=0.6, up=True, f0=300, f1=6000):
    x = sweep_noise(d, f0 if up else f1, f1 if up else f0, width=0.45, curve=1.4)
    n = len(x)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    pan = np.linspace(-0.7, 0.7, n)
    l = x * e * np.cos((pan + 1) * np.pi / 4)
    r = x * e * np.sin((pan + 1) * np.pi / 4)
    return np.stack([l, r]) * 0.6


def riser(d, f0=200, f1=9000):
    x = sweep_noise(d, f0, f1, width=0.3, curve=2.2)
    e = np.linspace(0, 1, len(x)) ** 2.4
    tone = saw(np.geomspace(110, 880, len(x)), d) * 0.12
    tone = lp(tone, 4000)
    return (x * 0.5 + tone) * e


def reverse_suck(d=0.6):
    x = hp(noise(d), 3000) * np.linspace(0, 1, int(d * SR)) ** 3
    return x * 0.5


def blip(freq, d=0.09, wave='sine'):
    t = tt(d)
    w = sine(freq, d) if wave == 'sine' else np.sign(sine(freq, d)) * 0.5
    return w * np.exp(-t / (d / 3)) * 0.5


def chime(freq, d=0.9):
    t = tt(d)
    parts = [(1, 1), (2.76, 0.4), (5.4, 0.2), (8.93, 0.1)]
    x = sum(a * sine(freq * m, d) * np.exp(-t / (0.35 / m ** 0.5)) for m, a in parts)
    return x * 0.35


def tick(d=0.018, f=4000):
    x = bp(noise(d), f * 0.6, f * 1.6)
    return x * np.exp(-tt(d) / 0.004) * 0.7


def error_bonk():
    a = np.sign(sine(659.3, 0.07)) * np.exp(-tt(0.07) / 0.05)
    b2 = np.sign(sine(493.9, 0.11)) * np.exp(-tt(0.11) / 0.06)
    return lp(np.concatenate([a, b2]), 3500) * 0.22


def glitch(d=0.25, seed=0):
    r = np.random.default_rng(seed)
    n = int(d * SR)
    out = np.zeros(n)
    i = 0
    while i < n:
        seg = int(r.uniform(0.008, 0.035) * SR)
        kind = r.integers(0, 3)
        tseg = np.arange(seg) / SR
        if kind == 0:
            s = np.sign(np.sin(2 * np.pi * r.uniform(80, 1800) * tseg))
        elif kind == 1:
            s = np.repeat(r.uniform(-1, 1, seg // 24 + 1), 24)[:seg]
        else:
            s = np.zeros(seg)
        out[i:i + seg] = s[: max(0, min(seg, n - i))]
        i += seg
    return out * 0.35


def supersaw(freqs, d, cutoff=2500, voices=7, detune=0.18):
    x = np.zeros(int(d * SR))
    for f in freqs:
        for v in range(voices):
            dt = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
            fv = f * 2 ** (dt / 12)
            x += saw(fv, d, phase=rng.random())
    x /= voices * len(freqs)
    return lp(x, cutoff, 2)


def pad(freqs, d, cutoff=900):
    x = supersaw(freqs, d, cutoff=cutoff, voices=5, detune=0.25)
    return x * adsr(len(x), a=0.25, d=0.3, s=0.85, r=0.3)


def pluck(freq, d=0.22, cutoff=3200):
    x = saw(freq, d) * 0.6 + saw(freq * 1.005, d) * 0.4
    x = lp(x, cutoff)
    return x * np.exp(-tt(d) / 0.07)


def sub_note(freq, d):
    x = sine(freq, d) + 0.25 * np.tanh(3 * sine(freq * 2, d))
    return x * adsr(len(x), a=0.004, d=0.05, s=0.9, r=0.03) * 0.6


# ───────────────────────────── arranjo ─────────────────────────────
CH = {
    'Am': ['A3', 'C4', 'E4'],
    'F': ['F3', 'A3', 'C4'],
    'C': ['G3', 'C4', 'E4'],
    'G': ['G3', 'B3', 'D4'],
    'Am+': ['A3', 'Bb3', 'E4'],
    'Cmaj9': ['C4', 'E4', 'G4', 'D5'],
}
ROOT = {'Am': 'A1', 'F': 'F1', 'C': 'C2', 'G': 'G1', 'Am+': 'A1'}

kick_times = []  # para o sidechain


def K(beat, punch=1.0, gain=1.0):
    drums.add(kick(punch), b(beat), gain)
    kick_times.append(b(beat))


# ── 0–8: GANCHO ──
sfx.add(impact(1.1), b(0) - 0.004, 0.9)
verb_send.add(impact(1.1), b(0), 0.25)
K(0, 1.3)
sfx.add(impact(0.55, 1.0), b(1), 0.55)
K(1, 1.0, 0.8)
# B2: a palavra brota (pistões por letra) + crane
sfx.add(impact(1.0), b(2.05), 0.85)
K(2, 1.3)
for i in range(9):
    sfx.add(lp(kick(0.6, 0.18), 1200) * 0.5, b(2) + 0.02 + i * 0.045, 0.35, pan=-0.6 + i * 0.15)
sfx.add(whoosh(0.75, up=False, f0=200, f1=5000), b(2) - 0.05, 0.6)
music.add(pad([n2f(n) for n in ['A2', 'E3', 'A3', 'C4']], b(8), cutoff=700), b(0), 0.22)
for k in range(3, 8):
    K(k, 0.9, 0.62)
for k in [5, 7]:
    drums.add(clap(), b(k), 0.32)
    verb_send.add(clap(), b(k), 0.2)
for k in np.arange(2, 8, 0.5):
    drums.add(hat(), b(k), 0.2 if k % 1 else 0.1, pan=0.25)
for k in np.arange(2, 8, 0.5):
    bass.add(lp(saw(n2f('A1'), BEAT * 0.45), 300) * adsr(int(BEAT * 0.45 * SR), 0.003, 0.08, 0.6, 0.05), b(k), 0.34)
# piada digitada (27 chars, 0.026 s)
for i in range(27):
    sfx.add(tick(f=3000 + rng.random() * 3000), b(4) + i * 0.026, 0.4 + 0.2 * rng.random(), pan=(rng.random() - 0.5) * 0.4)
# brilhos nas varreduras de luz
for k in [3.3, 5, 7]:
    sfx.add(hp(sweep_noise(0.5, 4000, 12000, 0.25, 1.0), 3000) * np.sin(np.linspace(0, np.pi, int(0.5 * SR))) * 0.25, b(k), 0.5, pan=0.3)
# subida para o caos
sfx.add(reverse_suck(0.45), b(8) - 0.45, 0.6)

# ── 8–14: CAOS ──
for seg, (s0, s1) in enumerate([(8, 10), (10, 12), (12, 14)]):
    sfx.add(impact(0.9), b(s0), 0.75)
    sfx.add(glitch(0.32, seed=seg + 1), b(s0), 0.75, pan=0.2)
    sfx.add(glitch(0.18, seed=seg + 11), b(s0) + 0.33, 0.45, pan=-0.3)
    drums.add(crash(1.5) if s0 == 8 else hat(True), b(s0), 0.5)
for k in range(8, 14):
    K(k, 1.15)
    if (k - 8) % 2 == 0:
        drums.add(clap(), b(k + 1), 0.5)
for k in np.arange(8, 14, 0.25):
    drums.add(hat(), b(k), 0.12 + 0.1 * rng.random(), pan=0.3 * np.sin(k * 3))
# baixo distorcido (A/Bb alternando)
for k in np.arange(8, 14, 0.5):
    f = n2f('A1') if int(k * 2) % 4 < 3 else n2f('A#1')
    x = np.tanh(4 * saw(f, BEAT * 0.48)) * adsr(int(BEAT * 0.48 * SR), 0.002, 0.05, 0.7, 0.04)
    x = np.round(lp(x, 900) * 8) / 8  # bitcrush
    bass.add(x, b(k), 0.33)
music.add(pad([n2f(n) for n in ['A2', 'A#2', 'E3', 'A3']], b(6), cutoff=1100), b(8), 0.3)
# janelas de erro (B10, B12)
for k in range(4):
    sfx.add(error_bonk(), b(10) + 0.05 + k * 0.075, 0.55, pan=-0.4 + k * 0.25)
for k in range(3):
    sfx.add(error_bonk(), b(12) + 0.05 + k * 0.075, 0.55, pan=0.4 - k * 0.3)
# contador do prejuízo caindo (ticks descendentes)
for i in range(26):
    x = i / 26
    sfx.add(blip(1400 * (1 - 0.6 * x), 0.04, 'sq'), b(12.3) + x * b(1.6), 0.18)

# ── 14–16: VÓRTICE / RISER ──
sfx.add(impact(0.7, 1.2), b(14), 0.6)
sfx.add(impact(0.5, 0.8), b(14.5), 0.45)
sfx.add(riser(b(1.75), 150, 11000), b(14), 0.75)
sfx.add(whoosh(b(1.7), up=True, f0=120, f1=4000), b(14), 0.6)
roll = [(14 + i * 0.5) for i in range(2)] + [(15 + i * 0.25) for i in range(2)] + [(15.5 + i * 0.125) for i in range(2)]
for i, k in enumerate(roll):
    drums.add(snare(), b(k), 0.25 + 0.06 * i)
sfx.add(reverse_suck(b(0.9)), b(15.75) - b(0.9), 0.7)
# (silêncio de B15.75 a B16)

# ── 16–48: DROP + CIDADE + SERVIÇOS (groove principal) ──
prog = [('Am', 16), ('F', 20), ('C', 24), ('G', 28), ('Am', 32), ('F', 36), ('C', 40), ('G', 44)]
sfx.add(impact(1.5, 2.4), b(16) - 0.003, 1.0)
verb_send.add(impact(1.5, 2.4), b(16), 0.3)
drums.add(crash(), b(16), 0.7)
for chord, s0 in prog:
    notes = [n2f(n) for n in CH[chord]]
    music.add(supersaw(notes, b(4), cutoff=2200 if s0 < 24 else 3000) * adsr(int(b(4) * SR), 0.01, 0.2, 0.85, 0.05), b(s0), 0.42)
    verb_send.add(supersaw(notes, b(4), cutoff=1600), b(s0), 0.06)
    # sub-baixo nas colcheias (com oitava)
    for k in np.arange(s0, s0 + 4, 0.5):
        f = n2f(ROOT[chord]) * (2 if (k * 2) % 4 == 3 else 1)
        bass.add(sub_note(f, BEAT * 0.46), b(k), 0.72)
for k in range(16, 48):
    K(k, 1.2)
    if k % 2 == 1:
        drums.add(clap(), b(k), 0.6)
        verb_send.add(clap(), b(k), 0.12)
    drums.add(hat(True), b(k + 0.5), 0.2, pan=-0.2)
    for s in [0.25, 0.75]:
        drums.add(hat(), b(k + s), 0.12, pan=0.35)
for s0 in [24, 32, 40]:
    drums.add(crash(), b(s0), 0.45)
    sfx.add(reverse_suck(0.5), b(s0) - 0.5, 0.35)
# arpejo na cidade e no fim dos serviços
arp_notes = {'C': ['C5', 'E5', 'G5', 'E5'], 'G': ['G4', 'B4', 'D5', 'B4'], 'Am': ['A4', 'C5', 'E5', 'C5'], 'F': ['F4', 'A4', 'C5', 'A4']}
for chord, s0 in prog[2:]:
    for i, k in enumerate(np.arange(s0, s0 + 4, 0.25)):
        nn = arp_notes[chord][i % 4]
        music.add(pluck(n2f(nn) * (2 if (i // 4) % 2 else 1), 0.2), b(k), 0.13, pan=0.4 * np.sin(i * 0.8))
# barras subindo (blips ascendentes)
for i in range(12):
    sfx.add(blip(n2f('A5') * 2 ** (i / 12 * 1.5), 0.08), b(16.6) + i * 0.05, 0.18, pan=-0.6 + i * 0.1)
# legendas
for k in [20, 21, 24.25, 25]:
    sfx.add(hp(whoosh(0.3, True, 800, 6000)[0], 1500), b(k) - 0.15, 0.25)
# mergulho na cidade
sfx.add(whoosh(b(0.85), up=True, f0=150, f1=7000), b(23.2), 0.65)
sfx.add(impact(0.8), b(24), 0.6)
# cidade: whip + ZERO
sfx.add(whoosh(0.5, up=False, f0=300, f1=8000), b(27.7), 0.7)
sfx.add(impact(1.0), b(28), 0.7)
sfx.add(impact(0.5, 0.8), b(28.5), 0.4)
sfx.add(whoosh(b(0.7), up=True, f0=200, f1=9000), b(31.3), 0.6)
# serviços: subida a cada estação + chime de chegada
for i, s0 in enumerate([32, 36, 40, 44]):
    if s0 > 32:
        sfx.add(whoosh(0.42, up=True, f0=250, f1=7000), b(s0) - 0.24, 0.6)
    sfx.add(impact(0.6, 0.9), b(s0), 0.45)
    sfx.add(chime(n2f(['E6', 'G6', 'A6', 'C7'][i]), 1.0), b(s0) + 0.05, 0.3, pan=0.2)
    verb_send.add(chime(n2f(['E6', 'G6', 'A6', 'C7'][i]), 1.0), b(s0) + 0.05, 0.15)
# CRM: cartões voando + "caixa registradora" ao fechar
for k in [36.6, 37.1, 37.6, 38.1, 38.6, 38.9]:
    sfx.add(hp(whoosh(0.3, True, 1000, 7000)[0], 1500), b(k), 0.25, pan=0.3)
for k in [36.6, 37.6, 38.6]:
    sfx.add(chime(n2f('E7'), 0.5) + chime(n2f('B7'), 0.5) * 0.6, b(k) + 0.36, 0.3, pan=0.5)
# IA: faíscas de dados
for i in range(24):
    sfx.add(blip(n2f('A6') * 2 ** (rng.integers(0, 12) / 12), 0.05), b(40.2) + i * b(0.15) + rng.random() * 0.02, 0.1, pan=(rng.random() - 0.5) * 1.4)
# app: notificações
for k in [45.0, 45.6, 46.2]:
    sfx.add(chime(n2f('C6'), 0.4) + chime(n2f('G6'), 0.4) * 0.8, b(k), 0.35, pan=-0.2)
sfx.add(whoosh(b(0.45), up=True, f0=250, f1=8000), b(47.55), 0.6)

# ── 48–56: TERMINAL / DEPLOY ──
sfx.add(impact(0.7), b(48), 0.55)
music.add(pad([n2f(n) for n in ['A2', 'E3', 'A3', 'C4']], b(4.25), cutoff=650), b(48), 0.35)
for k in np.arange(48, 52.25, 0.5):
    drums.add(hat(), b(k + 0.25), 0.16, pan=0.3)
for k in np.arange(48, 52, 1):
    bass.add(sub_note(n2f('A1'), BEAT * 0.9), b(k), 0.45)
for i in range(18):  # comando digitado
    sfx.add(tick(f=3500 + rng.random() * 2500), b(48.1) + i * 0.55 / 18, 0.5, pan=(rng.random() - 0.5) * 0.3)
steps_t0, step_dt = b(49.1), b(0.5)
for i in range(6):
    ts = steps_t0 + i * step_dt
    for j in range(8):  # pontinhos
        sfx.add(tick(0.01, 5000), ts + j * step_dt * 0.7 / 8, 0.2)
    sfx.add(blip(n2f(['C6', 'D6', 'E6', 'G6', 'A6', 'C7'][i]), 0.12), ts + step_dt * 0.7, 0.35)
sfx.add(riser(b(3.0), 180, 6000), b(49.25), 0.35)
# ✔ SISTEMA NO AR
sfx.add(impact(1.0), b(52.25), 0.75)
music.add(supersaw([n2f(n) for n in CH['Cmaj9']], b(0.75), cutoff=4500) * adsr(int(b(0.75) * SR), 0.005, 0.1, 0.8, 0.12), b(52.25), 0.5)
verb_send.add(supersaw([n2f(n) for n in CH['Cmaj9']], b(0.75), cutoff=3000), b(52.25), 0.25)
drums.add(crash(), b(52.25), 0.5)
# DO CAOS → AO CONTROLE.
sfx.add(glitch(0.3, seed=77), b(53), 0.8)
sfx.add(impact(0.8), b(53), 0.6)
K(53, 1.1)
sfx.add(impact(1.2), b(54), 0.85)
K(54, 1.3)
music.add(supersaw([n2f(n) for n in CH['G']], b(1.5), cutoff=3000) * adsr(int(b(1.5) * SR), 0.01, 0.2, 0.8, 0.1), b(54), 0.36)
for i, k in enumerate(np.arange(54, 55.5, 0.25)):
    drums.add(snare(), b(k), 0.2 + 0.05 * i)
sfx.add(riser(b(1.6), 300, 12000), b(54.4), 0.6)
sfx.add(whoosh(b(0.7), up=True, f0=100, f1=10000), b(55.3), 0.85)

# ── 56–64: CTA ──
sfx.add(impact(1.4, 2.2), b(56) - 0.003, 0.95)
verb_send.add(impact(1.4, 2.2), b(56), 0.3)
drums.add(crash(), b(56), 0.7)
cta_prog = [('Am', 56), ('F', 58), ('C', 60), ('G', 62)]
for chord, s0 in cta_prog:
    notes = [n2f(n) for n in CH[chord]]
    music.add(supersaw(notes, b(2), cutoff=3600) * adsr(int(b(2) * SR), 0.01, 0.2, 0.85, 0.05), b(s0), 0.42)
    verb_send.add(supersaw(notes, b(2), cutoff=2000), b(s0), 0.06)
    for k in np.arange(s0, s0 + 2, 0.5):
        f = n2f(ROOT[chord]) * (2 if (k * 2) % 4 == 3 else 1)
        bass.add(sub_note(f, BEAT * 0.46), b(k), 0.72)
    for i, k in enumerate(np.arange(s0, s0 + 2, 0.25)):
        nn = arp_notes[chord][i % 4]
        music.add(pluck(n2f(nn) * 2, 0.2, 4200), b(k), 0.12, pan=0.4 * np.sin(i * 0.9))
for k in range(56, 63):
    K(k, 1.2)
    if k % 2 == 1:
        drums.add(clap(), b(k), 0.6)
    drums.add(hat(True), b(k + 0.5), 0.2, pan=-0.2)
    for s in [0.25, 0.75]:
        drums.add(hat(), b(k + s), 0.12, pan=0.35)
# letras do @ pousando
for i in range(11):
    sfx.add(mx(lp(kick(0.5, 0.12), 2500) * 0.6, tick(0.02, 2500)), b(56) + 0.02 + i * 0.045 + 0.12, 0.3, pan=-0.7 + i * 0.14)
sfx.add(whoosh(0.6, up=True, f0=400, f1=9000), b(57.4), 0.3)
# botão
sfx.add(mx(blip(n2f('E5'), 0.12), blip(n2f('A5'), 0.16)), b(58), 0.6)
# cursor + clique + mensagem enviada
sfx.add(hp(whoosh(b(1.0), True, 2000, 9000)[0], 2500), b(58.9), 0.12)
sfx.add(mx(tick(0.03, 2200) * 1.5, tick(0.02, 5000)), b(60), 0.9)
sfx.add(whoosh(0.35, up=True, f0=800, f1=9000), b(60.25), 0.35)
sfx.add(chime(n2f('A6'), 0.6) + chime(n2f('E7'), 0.6) * 0.7, b(60.3), 0.4)
# emenda do loop
sfx.add(riser(b(1.0), 300, 12000), b(63), 0.55)
sfx.add(reverse_suck(b(0.9)), b(64) - b(0.9), 0.7)

# ───────────────────────────── mix ─────────────────────────────
# sidechain: envelope de ganho puxado por cada bumbo
sc = np.ones(N)
rel = 0.2
for t0 in kick_times:
    i0 = int(t0 * SR)
    n = min(int(0.32 * SR), N - i0)
    if n <= 0:
        continue
    env = 1 - 0.72 * np.exp(-np.arange(n) / SR / (rel / 3))
    sc[i0:i0 + n] = np.minimum(sc[i0:i0 + n], env)

# reverb (IR de ruído com decaimento exponencial, estéreo descorrelacionado)
irn = int(2.4 * SR)
ir_t = np.arange(irn) / SR
irL = lp(rng.standard_normal(irn), 6000) * np.exp(-ir_t / 0.55)
irR = lp(rng.standard_normal(irn), 6000) * np.exp(-ir_t / 0.55)
pre = int(0.025 * SR)
irL = np.concatenate([np.zeros(pre), irL]) / np.sqrt(np.sum(irL ** 2))
irR = np.concatenate([np.zeros(pre), irR]) / np.sqrt(np.sum(irR ** 2))
vL = signal.fftconvolve(verb_send.L, irL)[:N]
vR = signal.fftconvolve(verb_send.R, irR)[:N]

mix = np.zeros((2, N))
mix += drums.stereo() * 0.95
mix += hp(bass.stereo(), 30) * sc * 0.9
mix += music.stereo() * sc * 0.85
mix += sfx.stereo() * 0.8
mix += np.stack([vL, vR]) * 0.55 * (0.55 + 0.45 * sc)

# master: HPF/LPF, saturação suave, normalização por TRUE PEAK (-1 dBTP, 4× oversampling)
mix = hp(mix, 25)
mix = lp(mix, 16500, 4)
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix = lp(mix, 17500, 4)
over = signal.resample_poly(mix, 4, 1, axis=1)
tpk = np.max(np.abs(over))
mix = mix / tpk * 10 ** (-1.0 / 20)
# micro fade nas pontas (sem estalo no loop)
f = int(0.004 * SR)
mix[:, :f] *= np.linspace(0, 1, f)
mix[:, -f:] *= np.linspace(1, 0, f)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'soundtrack.wav')
wavfile.write(out, SR, (mix.T * 32767).astype(np.int16))
print(f'ok → {out}  ({DUR:.1f}s, {SR} Hz, true peak -1.0 dBTP)')
