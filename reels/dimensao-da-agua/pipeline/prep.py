#!/usr/bin/env python3
"""Dados auxiliares: envelope da voz (por quadro), matte em baixa resolução e tempos das palavras ajustados ao áudio.
    python3 prep.py WORKDIR"""
import sys, json, wave, subprocess, numpy as np
work = sys.argv[1]
w = wave.open(f'{work}/audio16k.wav'); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768; sr = w.getframerate()
hop = sr // 100; rms = np.sqrt(np.convolve(x * x, np.ones(hop * 2) / (hop * 2), 'same'))[::hop]      # 100 Hz
thr = max(0.012, np.percentile(rms, 20) * 2.5)
env = np.array([rms[int(i * 100 / 24):int(i * 100 / 24) + 5].mean() for i in range(int(len(rms) * 24 / 100))])
env = np.clip(env / np.percentile(env, 97), 0, 1.3); np.save(f'{work}/env.npy', np.concatenate([env, np.zeros(48)]).astype(np.float32))
T = json.load(open(f'{work}/transcript.json')); words = [q for s in T for q in s['words']]
out = []
for i, q in enumerate(words):
    s = q['s']; lim = min(q['e'] - 0.04, (words[i + 1]['s'] - 0.06) if i + 1 < len(words) else s + 1)
    k = int(s * 100)
    while k < len(rms) - 1 and rms[k] < thr and k / 100 < lim: k += 1       # início caiu em silêncio → avança até a voz
    s2 = max(s, k / 100 - 0.03)
    out.append(round(s2, 3)); print(f"{i:3d} {q['w']:>14s} {q['s']:6.2f} -> {s2:6.2f}" + ('  *' if s2 - s > 0.12 else ''))
json.dump(out, open(f'{work}/words.json', 'w'))
p = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{work}/matte.mkv', '-vf', 'scale=135:240:flags=area', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], capture_output=True)
m = np.frombuffer(p.stdout, np.uint8).reshape(-1, 240, 135); np.save(f'{work}/matte_small.npy', m); print('matte_small', m.shape)
