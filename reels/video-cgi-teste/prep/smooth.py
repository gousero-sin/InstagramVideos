"""Suaviza o rastreamento bruto e cria o arquivo compacto usado pelos efeitos.

uso: python3 -I smooth.py <track.json> <saida.json>
Por quadro:  hand {v, tip, cen, palm, size, open, dir}   head {c, top, size, roll, ok}
(coordenadas normalizadas 0..1 do quadro; y para baixo)
"""
import sys, json, math
import numpy as np

raw = json.load(open(sys.argv[1]))
F = raw['frames']
N = len(F)

def gauss(a, sigma):
    a = np.asarray(a, float)
    if sigma <= 0: return a
    r = int(sigma * 3 + 1)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    p = np.pad(a, ((r, r),) + ((0, 0),) * (a.ndim - 1), mode='edge')
    out = np.zeros_like(a)
    for j, w in enumerate(k):
        out += w * p[j:j + N]
    return out

def fill(a, ok):
    """interpola linearmente onde ok=False"""
    a = np.array(a, float); idx = np.arange(N)
    good = np.where(ok)[0]
    if len(good) == 0: return a
    for c in range(a.shape[1]):
        a[:, c] = np.interp(idx, good, a[good, c])
    return a

# ── mão: escolhe a mais "relevante" (maior × confiança) por quadro ──
tip = np.zeros((N, 2)); cen = np.zeros((N, 2)); palm = np.zeros((N, 2)); size = np.zeros(N); opn = np.zeros(N); dirv = np.zeros((N, 2))
ok = np.zeros(N, bool)
pose_w = np.zeros((N, 2)); pose_ok = np.zeros(N, bool)
for i, f in enumerate(F):
    best = None
    for h in f['hands']:
        lm = np.array(h['lm'])
        s = np.hypot(*(lm[0, :2] - lm[9, :2]))
        sc = h['score'] * (0.5 + s * 4)
        if best is None or sc > best[0]: best = (sc, lm, h['score'], s)
    if best and best[2] > 0.4:
        _, lm, _, s = best
        tips = lm[[4, 8, 12, 16, 20], :2]
        pl = lm[[0, 5, 9, 13, 17], :2].mean(0)
        tip[i] = lm[8, :2]; cen[i] = tips.mean(0); palm[i] = pl; size[i] = s
        opn[i] = np.mean(np.hypot(*(tips - pl).T)) / max(s, 1e-3)
        d = lm[12, :2] - lm[0, :2]; dirv[i] = d / (np.hypot(*d) + 1e-6)
        ok[i] = True
    po = f['pose']
    if po:
        # usa o punho mais visível
        w = max((po['wrL'], po['wrR']), key=lambda q: q[2])
        if w[2] > 0.5: pose_w[i] = w[:2]; pose_ok[i] = True

# vazios curtos (≤ 6 quadros) → interpolação; vazios longos → "invisível"
vis = ok.copy()
i = 0
while i < N:
    if not ok[i]:
        j = i
        while j < N and not ok[j]: j += 1
        if i > 0 and j < N and (j - i) <= 6: vis[i:j] = True
        i = j
    else: i += 1
for arr in (tip, cen, palm, dirv):
    arr[:] = fill(arr, ok)
size[:] = fill(size[:, None], ok)[:, 0]; opn[:] = fill(opn[:, None], ok)[:, 0]
# onde há punho na pose mas não mão (mão fora do quadro / desfocada), mantém posição do punho mas marca visível=0.5
sig = 1.1
tip, cen, palm, dirv = (gauss(a, sig) for a in (tip, cen, palm, dirv))
size = gauss(size, sig); opn = gauss(opn, 2.0)
visf = gauss(vis.astype(float), 1.5)

# ── cabeça ──
hc = np.zeros((N, 2)); htop = np.zeros((N, 2)); hs = np.zeros(N); hr = np.zeros(N); hok = np.zeros(N, bool)
for i, f in enumerate(F):
    fc = f['face']
    if fc:
        b = fc['bbox']
        hc[i] = [(fc['eyeL'][0] + fc['eyeR'][0]) / 2 * 0.5 + (b[0] + b[2]) / 2 * 0.5, (b[1] + b[3]) / 2]
        hs[i] = b[3] - b[1]
        e = np.array(fc['eyeR'][:2]) - np.array(fc['eyeL'][:2])
        hr[i] = math.atan2(e[1], e[0])
        htop[i] = [fc['forehead'][0], fc['forehead'][1] - 0.22 * (fc['chin'][1] - fc['forehead'][1])]
        hok[i] = True
    elif f['pose']:
        n = f['pose']['nose']; hc[i] = n[:2]; hs[i] = 0.2; htop[i] = [n[0], n[1] - 0.12]; hok[i] = True
hc = gauss(fill(hc, hok), 1.5); htop = gauss(fill(htop, hok), 1.5)
hs = gauss(fill(hs[:, None], hok)[:, 0], 2.0); hr = gauss(fill(hr[:, None], hok)[:, 0], 2.0)

R = lambda a, n=4: np.round(a, n).tolist()
out = {'fps': raw['fps'], 'n': N,
       'hand': {'v': R(visf, 3), 'tip': R(tip), 'cen': R(cen), 'palm': R(palm), 'size': R(size), 'open': R(opn, 3), 'dir': R(dirv, 3)},
       'head': {'c': R(hc), 'top': R(htop), 'size': R(hs), 'roll': R(hr)}}
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
print('ok', N, 'quadros; mão visível em', int((visf > 0.5).sum()))
