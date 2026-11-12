#!/usr/bin/env python3
"""Compositor do reel "Dimensão da Água" — filmagem real + matte + CGI procedural.

    python3 edit.py --src IMG_8928.MOV --work WORKDIR --scale 2 --out out.mp4 [--from 0 --to 66] [--procs 4]
    python3 edit.py ... --stills 17.9,30.2,40      (grava PNGs de revisão em WORKDIR/stills; tempos de SAÍDA)

Tudo é função fechada do tempo (sem estado entre quadros) → dá para renderizar em paralelo/por trechos.
Coordenadas normalizadas (x∈0..1 da largura, y∈0..1 da altura). R = largura/1080.
"""
import argparse, json, math, os, subprocess, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', '..', '..', 'assets', 'fonts')
FPS = 24
# ── montagem (tempos da FONTE, em s) ────────────────────────────────────────────
CUT_A, CUT_B = 1112, 1308          # "você corta quando entrar no portal e volta pra cá": remove 46,33 → 54,50 s
SRC_END = 1784                     # 74,33 s → entra a vinheta
N_OUT = CUT_A + (SRC_END - CUT_B)
T_STUDIO = 17.80                   # "…um ESTÚDIO"
T_FORM, T_WALL = 27.95, 38.50      # água nasce na mão / bate na parede (abre o portal)
T_SUCK = 45.80                     # começa a ser puxado pelo portal (corte em 46,33)
T_WATER, T_BACK = CUT_B / FPS, 59.72

def out2src(n): return n if n < CUT_A else n + (CUT_B - CUT_A)

# ── utilidades ─────────────────────────────────────────────────────────────────
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def lerp(a, b, t): return a + (b - a) * t
def sstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1); return t * t * (3 - 2 * t)
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_in(x): x = clamp(x); return x ** 3
def ease_io(x): x = clamp(x); return x * x * (3 - 2 * x)
def ease_back(x, s=1.70158): x = clamp(x) - 1; return x * x * ((s + 1) * x + s) + 1
def hexc(h):  # '#rrggbb' → BGR float
    h = h.lstrip('#'); return np.array([int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)], np.float32) / 255
WHITE, GREEN, CYAN, ORANGE = hexc('#f4f7f5'), hexc('#39ff14'), hexc('#3fe0ff'), hexc('#e8825a')
def rnd(seed, n=1): return np.random.default_rng(seed).random(n)
def pnoise(h, w, gh, gw, seed):
    """ruído suave e periódico (tileable)"""
    g = np.random.default_rng(seed).random((gh, gw)).astype(np.float32)
    g = np.pad(g, ((1, 2), (1, 2)), mode='wrap')
    big = cv2.resize(g, ((gw + 3) * (w // gw + 1), (gh + 3) * (h // gh + 1)), interpolation=cv2.INTER_CUBIC)
    sy, sx = big.shape[0] / (gh + 3), big.shape[1] / (gw + 3)
    out = big[int(sy):int(sy) + int(sy * gh), int(sx):int(sx) + int(sx * gw)]
    return np.clip(cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR), 0, 1)
def rmap(img, mx, my, interp=cv2.INTER_LINEAR, **kw):
    return cv2.remap(np.ascontiguousarray(img, np.float32), np.asarray(mx, np.float32), np.asarray(my, np.float32), interp, **kw)
def blur(img, s):
    if s < 0.3: return img
    if s > 12:  # borrão grande: reduz, borra, amplia (rápido em 4K)
        f = min(8, int(s // 4)); h, w = img.shape[:2]
        sm = cv2.resize(img, (max(1, w // f), max(1, h // f)), interpolation=cv2.INTER_AREA)
        sm = cv2.GaussianBlur(sm, (0, 0), s / f)
        return cv2.resize(sm, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.GaussianBlur(img, (0, 0), s)


class Ctx:
    def __init__(s, a):
        s.R = a.scale; s.W = int(1080 * s.R); s.H = int(1920 * s.R); s.work = a.work; s.src = a.src
        W, H = s.W, s.H
        s.plate = cv2.resize(cv2.imread(os.path.join(a.work, 'plate.png')), (W, H), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
        st = cv2.imread(os.path.join(a.work, 'studio.png')).astype(np.float32) / 255
        st = cv2.resize(st, (W, H), interpolation=cv2.INTER_AREA)
        st = blur(st, 2.6 * s.R)                                    # profundidade de campo: fundo levemente fora de foco
        glow = blur(np.maximum(st - 0.62, 0), 34 * s.R)
        s.studio = np.clip(st * 0.94 + glow * 1.5, 0, 1.5)
        d = np.load(os.path.join(a.work, 'hands.npz'))
        s.hA, s.hB, s.head, s.sh = d['A'], d['B'], d['head'], d['sh']
        s.track = json.load(open(os.path.join(a.work, 'track.json')))
        s.env = np.load(os.path.join(a.work, 'env.npy'))
        s.msmall = np.load(os.path.join(a.work, 'matte_small.npy'))  # (N,240,135) uint8
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        s.xx, s.yy = xx, yy
        s.vig = (1 - 0.34 * sstep(0.45, 1.05, np.hypot((xx / W - 0.5) * 1.15, (yy / H - 0.52)) * 1.35))[..., None]
        s.captions = build_captions(s)
        s.n_theta = pnoise(256, 1024, 8, 24, 11); s.n_fine = pnoise(256, 1024, 32, 96, 12)
    def tr(s, arr, t):   # amostra uma trilha no tempo da fonte (interp. linear)
        f = clamp(t * FPS, 0, len(arr) - 1.001); i = int(f); k = f - i
        return arr[i] * (1 - k) + arr[i + 1] * k


# ── leitura da fonte ───────────────────────────────────────────────────────────
class Reader:
    def __init__(s, C, n0, n1):
        s.C = C; W, H = C.W, C.H; n = n1 - n0
        ss = max(0, n0 / 24.0011 - 0.004)
        s.v = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', f'{ss:.5f}', '-i', C.src, '-map', '0:v:0', '-frames:v', str(n),
                                '-vf', f'scale={W}:{H}:flags=bicubic', '-pix_fmt', 'bgr24', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE, bufsize=W * H * 3)
        s.m = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', f'{max(0, n0 / 24 - 0.004):.5f}', '-i', os.path.join(C.work, 'matte.mkv'), '-frames:v', str(n),
                                '-vf', f'scale={W}:{H}:flags=bicubic', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE, bufsize=W * H)
    def read(s):
        W, H = s.C.W, s.C.H
        f = np.frombuffer(s.v.stdout.read(W * H * 3), np.uint8).reshape(H, W, 3).astype(np.float32) / 255
        a = np.frombuffer(s.m.stdout.read(W * H), np.uint8).reshape(H, W).astype(np.float32) / 255
        return f, a
    def close(s):
        for p in (s.v, s.m): p.stdout.close(); p.kill()


# ── LEGENDAS ───────────────────────────────────────────────────────────────────
# (t_saida_do_bloco, [linhas]); cada palavra = (texto, t_inicio, cor de ênfase | None)
def caption_script(words):
    w = {i: x for i, x in enumerate(words)}
    def W_(txt, i, col=None): return (txt, w[i], col)
    G, C_, O = 'G', 'C', 'O'
    B = []
    B.append((2.25, [[W_('OLÁ,', 0, G)], [W_('ESSE', 1), W_('É', 2), W_('UM', 3)], [W_('VÍDEO', 4), W_('GRAVADO', 5, G)]]))
    B.append((5.25, [[W_('E', 6), W_('NELE', 7)]]))
    B.append((8.36, [[W_('USAREMOS', 8), W_('TODAS', 9, G), W_('AS', 10)], [W_('TÉCNICAS', 11, G)], [W_('DE', 12), W_('EDIÇÕES', 13), W_('POSSÍVEIS', 14)]]))
    B.append((11.75, [[W_('AQUI,', 15), W_('DIRETAMENTE', 16)], [W_('NO', 17), W_('AMBIENTE', 18), W_('DO', 19)], [W_('CLAUDE.', 20, O)]]))
    B.append((15.6, [[W_('PARA', 21), W_('ESSE', 22), W_('VÍDEO,', 23)], [W_('VAMOS', 24), W_('COMEÇAR', 25, G)], [W_('DA', 26), W_('SEGUINTE', 27), W_('FORMA.', 28)]]))
    B.append((18.36, [[W_('VAMOS', 29), W_('PARA', 30), W_('UM', 31)], [W_('ESTÚDIO,', 32, G)]]))
    B.append((20.80, [[W_('ALGUM', 33), W_('LUGAR', 34)], [W_('MAIS', 35), W_('TRANQUILO,', 36, G)]]))
    B.append((22.75, [[W_('UM', 37), W_('LUGAR', 38), W_('MAIS', 39)], [W_('BONITO', 40, G), W_('E', 41), W_('TAL.', 42)]]))
    B.append((26.62, [[W_('E', 43), W_('VAMOS', 44), W_('COMEÇAR', 45)], [W_('COM', 46), W_('UMA', 47), W_('COISA', 48)], [W_('MAIS', 49), W_('LEVE.', 50, G)]]))
    B.append((29.82, [[W_('OLHA,', 51), W_('AQUI', 52), W_('EU', 53)], [W_('CONSIGO', 54), W_('CONTROLAR', 55)], [W_('A', 56), W_('ÁGUA', 57, C_)]]))
    B.append((33.05, [[W_('E', 58), W_('PASSAR', 59, C_)], [W_('DE', 60), W_('UMA', 61), W_('MÃO', 62)], [W_('PARA', 63), W_('A', 64), W_('OUTRA.', 65, C_)]]))
    B.append((42.9, [[W_('AGORA,', 66), W_('UM', 67)], [W_('PORTAL', 68, C_)], [W_('COM', 69), W_('ESSA', 70), W_('ÁGUA', 71, C_)], [W_('NESSA', 72), W_('PAREDE.', 73)]]))
    B.append((45.95, [[W_('E', 74), W_('EU', 75), W_('VOU', 76)], [W_('ENTRAR', 77, C_)], [W_('NESSE', 78), W_('PORTAL.', 79, C_)]]))
    # 80–91: "Nessa hora, você corta quando entrar no portal e volta para cá." → instrução de edição (executada, não legendada)
    B.append((58.9, [[W_('AQUI', 92), W_('É', 93), W_('A', 94)], [W_('DIMENSÃO', 95, C_)], [W_('DA', 96), W_('ÁGUA.', 97, C_)]]))
    B.append((62.42, [[W_('AGORA,', 98), W_('ESSE', 99), W_('FOI', 100)], [W_('UM', 101), W_('VÍDEO', 102)], [W_('BEM', 103), W_('RÁPIDO', 104, G)]]))
    B.append((68.3, [[W_('PARA', 105), W_('TESTAR', 106), W_('APENAS', 107)], [W_('O', 108), W_('MOTION', 109, G), W_('E', 110), W_('O', 111), W_('CGI', 112, G)], [W_('DO', 113), W_('PRÓPRIO', 114)], [W_('CLAUDE.', 115, O)]]))
    B.append((71.95, [[W_('FIQUEM', 116), W_('COM', 117), W_('A', 118)], [W_('VINHETA.', 119, G)]]))
    B.append((73.75, [[W_('ATÉ', 120), W_('A', 121)], [W_('PRÓXIMA.', 122, G)]]))
    return B

_fcache = {}
def font(size):
    if size not in _fcache: _fcache[size] = ImageFont.truetype(os.path.join(FONTS, 'Archivo-ExtraCondensedBlack.ttf'), size)
    return _fcache[size]

class Block:
    pass

def build_captions(C):
    R, W, H = C.R, C.W, C.H
    words = json.load(open(os.path.join(C.work, 'words.json')))
    blocks = []
    for bi, (t_out, lines) in enumerate(caption_script(words)):
        b = Block(); b.i = bi; b.t0 = lines[0][0][1]; b.t1 = t_out; b.words = []
        portal_era = T_WALL - 1 < b.t0 < T_WATER      # deixa o portal livre: bloco estreito à esquerda
        maxw = (0.56 if portal_era else 0.77) * W; pad = int(60 * R); y = pad; bw = 0; b.portal_era = portal_era
        rows = []
        for line in lines:
            txt = ' '.join(x[0] for x in line)
            f0 = font(200); w200 = f0.getlength(txt)
            size = int(np.clip(200 * maxw / w200, 96 * R, 285 * R))
            f = font(size); asc = int(size * 0.74)   # altura de maiúscula ≈ 0,70·size
            rows.append((line, f, size, f.getlength(txt), y)); bw = max(bw, f.getlength(txt)); y += int(size * 0.80)
        b.bw = int(bw) + 2 * pad; b.bh = y + int(20 * R) + pad
        for line, f, size, lw, ly in rows:
            x = pad + (bw - lw) / 2
            for (txt, tw, col) in line:
                wpx = f.getlength(txt); m = int(size * 0.22)
                im = Image.new('L', (int(wpx) + 2 * m, int(size * 1.25) + 2 * m), 0)
                ImageDraw.Draw(im).text((m, m), txt, font=f, fill=255)
                spr = np.asarray(im, np.float32) / 255
                b.words.append(dict(spr=spr, x=int(x) - m, y=ly - m - int(size * 0.17), t=tw, col=col, size=size))
                x += wpx + f.getlength(' ')
        # máscara de "tinta" do bloco inteiro (para posicionar atrás do corpo com legibilidade)
        ink = np.zeros((b.bh, b.bw), np.float32)
        for wd in b.words: paste_max(ink, wd['spr'], wd['x'], wd['y'])
        b.ink = ink
        place_block(C, b)
        b.side = 1 if bi % 2 == 0 else -1
        blocks.append(b)
    return blocks

def paste_max(dst, spr, x, y, a=1.0):
    h, w = spr.shape[:2]; H, W = dst.shape[:2]
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0: return
    s = spr[y0 - y:y1 - y, x0 - x:x1 - x] * a
    np.maximum(dst[y0:y1, x0:x1], s, out=dst[y0:y1, x0:x1])

def place_block(C, b):
    """Escolhe a altura do bloco: o mais baixo possível (para passar ATRÁS da cabeça/ombros),
    mas com no máx. ~16% da tinta coberta pela união das silhuetas durante a frase (legibilidade)."""
    W, H = C.W, C.H
    f0, f1 = int(b.t0 * FPS), int(min(b.t1 + 0.2, 74) * FPS)
    occ = (C.msmall[f0:f1:3].max(0) > 110).astype(np.float32)          # união da silhueta (135×240)
    occ = cv2.resize(occ, (W // 8, H // 8), interpolation=cv2.INTER_AREA)
    ink = cv2.resize(b.ink, (b.bw // 8, b.bh // 8), interpolation=cv2.INTER_AREA); tot = ink.sum() + 1e-6
    hx = float(np.mean(C.head[f0:f1, 0]))
    cx = 0.385 if b.portal_era else np.clip(0.5 + (0.5 - hx) * 0.10, 0.47, 0.53)
    x0 = int((cx * W - b.bw / 2) / 8); best = None
    for top in np.arange(0.60, 0.085, -0.01):
        y0 = int(top * H / 8); h, w = ink.shape
        if y0 + h > H // 8 or x0 < 0 or x0 + w > W // 8: continue
        o = occ[y0:y0 + h, x0:x0 + w]; cov = float((ink * o).sum() / tot); wmax = 0
        for wd in b.words:
            ys, xs = slice(max(0, wd['y'] // 8), (wd['y'] + wd['spr'].shape[0]) // 8), slice(max(0, wd['x'] // 8), (wd['x'] + wd['spr'].shape[1]) // 8)
            wi = ink[ys, xs]; wmax = max(wmax, float((wi * o[ys, xs]).sum() / (wi.sum() + 1e-6)))
        if cov <= 0.16 and wmax <= 0.42: best = (top, cov); break
    if best is None: best = (0.10, 1.0)
    b.cx, b.top, b.cov = cx, best[0], best[1]

def render_captions(C, t):
    """→ (rgb premult, alpha) em quadro cheio, já com perspectiva; None se nada visível"""
    R, W, H = C.R, C.W, C.H
    out_rgb = None; out_a = None
    for b in C.captions:
        if t < b.t0 - 0.02 or t > b.t1 + 0.34: continue
        era_water = T_WATER <= t < T_BACK + 0.3
        can = np.zeros((b.bh, b.bw, 4), np.float32)
        env = float(C.tr(C.env, t))
        for wi, wd in enumerate(b.words):
            a = (t - wd['t']) / 0.20
            if a <= 0: continue
            col = WHITE if wd['col'] is None else {'G': GREEN, 'C': CYAN, 'O': ORANGE}[wd['col']]
            if era_water and wd['col'] == 'G': col = CYAN
            emph = wd['col'] is not None
            spr = wd['spr']; x, y = wd['x'], wd['y']; al = 1.0
            if a < 1:
                e = ease_back(a, 2.2 if emph else 1.2); al = min(1, a * 2.2)
                sc = 1 + (0.55 if emph else 0.28) * (1 - e)
                dirx = (1 if wi % 2 == 0 else -1) * b.side
                dx = dirx * (1 - ease_out(a)) * (150 if emph else 90) * R
                k = int((1 - a) ** 2 * 46 * R) | 1
                h0, w0 = spr.shape
                spr = cv2.resize(spr, (max(2, int(w0 * sc)), max(2, int(h0 * sc))), interpolation=cv2.INTER_LINEAR)
                if k > 2: spr = cv2.blur(spr, (k, 1))
                x = int(x - (spr.shape[1] - w0) / 2 + dx); y = int(y - (spr.shape[0] - h0) / 2)
            # flash de ênfase + pulso com a voz
            fl = math.exp(-max(0, t - wd['t'] - 0.1) / 0.22) if emph else 0
            c = col * (1 - 0.6 * fl) + 0.6 * fl
            h, w = spr.shape; Hc, Wc = can.shape[:2]
            x0, y0 = max(0, x), max(0, y); x1, y1 = min(Wc, x + w), min(Hc, y + h)
            if x1 <= x0 or y1 <= y0: continue
            s = spr[y0 - y:y1 - y, x0 - x:x1 - x] * al
            # leve degradê vertical (luz vinda de cima)
            g = np.linspace(1.04, 0.86, h, dtype=np.float32)[y0 - y:y1 - y, None]
            reg = can[y0:y1, x0:x1]
            reg[..., :3] = reg[..., :3] * (1 - s[..., None]) + (c[None, None] * g[..., None]) * s[..., None]
            reg[..., 3] = reg[..., 3] * (1 - s) + s
        # saída do bloco: recua em profundidade, desliza e some
        te = clamp((t - b.t1) / 0.30); life = clamp((t - b.t0) / max(0.5, b.t1 - b.t0))
        if te > 0:
            can *= (1 - te) ** 1.5
            k = int(te * 70 * R) | 1
            if k > 2: can = cv2.blur(can, (k, 1))
        # perspectiva 3D: bloco gira no eixo Y/X com deriva lenta (parallax)
        ry = math.radians(b.side * lerp(13, 6, life)) ; rx = math.radians(lerp(-5, -2, life))
        sc = (1 + 0.012 * env) * lerp(0.985, 1.03, life) * (1 - 0.10 * ease_in(te))
        dx = -b.side * ease_in(te) * 160 * R; dy = 0
        if era_water: dy = math.sin(t * 1.7 + b.i) * 9 * R; ry += math.radians(math.sin(t * 1.1) * 3)
        cx, cy = b.cx * W + dx, b.top * H + b.bh / 2 + dy
        f = 1.9 * W
        src = np.array([[0, 0], [b.bw, 0], [b.bw, b.bh], [0, b.bh]], np.float32); dst = []
        for (px, py) in src:
            X, Y = (px - b.bw / 2) * sc, (py - b.bh / 2) * sc
            X2, Z = X * math.cos(ry), -X * math.sin(ry)
            Y2, Z2 = Y * math.cos(rx) - Z * math.sin(rx), Y * math.sin(rx) + Z * math.cos(rx)
            k = f / (f + Z2); dst.append([cx + X2 * k, cy + Y2 * k])
        M = cv2.getPerspectiveTransform(src, np.array(dst, np.float32))
        full = cv2.warpPerspective(can, M, (W, H), flags=cv2.INTER_LINEAR)
        if out_rgb is None: out_rgb, out_a = full[..., :3].copy(), full[..., 3].copy()
        else:
            out_rgb = out_rgb * (1 - full[..., 3:4]) + full[..., :3]; out_a = out_a * (1 - full[..., 3]) + full[..., 3]
    return out_rgb, out_a


# ── FUNDO: dimensão da água ────────────────────────────────────────────────────
def caustics(t, w, h, scale=7.0):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    px, py = x / w * scale * (w / h), y / h * scale
    for i in range(3):
        nx = px + 0.55 * np.sin(py * 1.6 + t * 0.9 + i * 1.7)
        ny = py + 0.55 * np.cos(px * 1.4 - t * 0.7 + i * 2.3)
        px, py = nx, ny
    c = 0.5 + 0.5 * np.sin(px * 2.0) * np.sin(py * 2.0)
    return np.power(np.clip(c, 0, 1), 5.0)

def water_bg(C, t, burst=0.0):
    W, H, R = C.W, C.H, C.R; w, h = 270, 480
    y, x = np.mgrid[0:h, 0:w].astype(np.float32); u, v = x / w, y / h
    top, mid, deep = hexc('#3fd6e8'), hexc('#0a6f9c'), hexc('#031a36')
    g = np.clip(v * 1.05, 0, 1)[..., None]
    col = np.where(g < 0.45, top + (mid - top) * (g / 0.45), mid + (deep - mid) * ((g - 0.45) / 0.55))
    # raios de luz (god rays) vindos de cima-esquerda
    ang = np.arctan2(u - 0.22, v + 0.45)
    rays = np.zeros_like(u)
    for k, (fq, sp, ph) in enumerate([(23, 0.30, 0.0), (41, -0.22, 1.3), (67, 0.17, 2.1)]):
        rays += (0.5 + 0.5 * np.sin(ang * fq + t * sp + ph)) / 3
    rays = np.power(rays, 3.2) * np.exp(-v * 1.9) * 2.4
    col = col + rays[..., None] * hexc('#b8fff4') * 0.75
    ca = caustics(t, w, h, 5.0) * np.exp(-v * 3.0) * 0.5
    col = col + ca[..., None] * hexc('#e0ffff')
    bg = cv2.resize(col.astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    # cardume ao fundo
    for i in range(26):
        r = rnd(900 + i, 5)
        sp = 0.055 + 0.03 * r[0]; fx = (1.25 - ((t - T_WATER) * sp + r[1] * 0.9) % 1.5); fy = 0.30 + 0.25 * r[2] + 0.012 * math.sin(t * 2 + i)
        L = (16 + 14 * r[3]) * R; px, py = fx * W, fy * H
        wag = math.sin(t * 9 + i * 2.1) * 0.25
        body = np.array([[px - L, py], [px - L * 0.2, py - L * 0.28], [px + L * 0.55, py], [px - L * 0.2, py + L * 0.28]], np.int32)
        tail = np.array([[px + L * 0.5, py], [px + L * 1.0, py - L * 0.3 + wag * L], [px + L * 1.0, py + L * 0.3 + wag * L]], np.int32)
        c = (hexc('#06304e') * (0.7 + 0.5 * r[4])).tolist()
        cv2.fillConvexPoly(bg, body, c, cv2.LINE_AA); cv2.fillConvexPoly(bg, tail, c, cv2.LINE_AA)
    bg = blur(bg, 2.2 * R)
    # neve marinha
    for i in range(110):
        r = rnd(300 + i, 5)
        px = ((r[0] + 0.012 * math.sin(t * 0.6 + i)) % 1) * W; py = ((r[1] - t * (0.008 + 0.02 * r[2])) % 1) * H
        disc(bg, px, py, (1.2 + 2.6 * r[3]) * R, hexc('#d8ffff'), 0.10 + 0.35 * r[4], soft=0.9)
    return bg

def disc(img, cx, cy, r, col, a, soft=0.35, ring=0.0, add=False):
    """disco/bolha antialiased dentro de um ROI; ring>0 → bolha (borda brilhante + reflexo)"""
    H, W = img.shape[:2]; m = int(r * (1 + soft) + 2)
    x0, x1, y0, y1 = int(cx - m), int(cx + m + 1), int(cy - m), int(cy + m + 1)
    if x1 <= 0 or y1 <= 0 or x0 >= W or y0 >= H: return
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    yy, xx = np.mgrid[Y0:Y1, X0:X1].astype(np.float32)
    d = np.hypot(xx - cx, yy - cy) / max(r, 0.5)
    if ring > 0:
        body = (1 - sstep(1 - 0.12, 1.0, d)) * 0.10
        rim = np.exp(-((d - 0.88) / 0.10) ** 2) * (0.55 + 0.45 * (-(yy - cy) / max(r, .5)).clip(-1, 1))
        hl = np.exp(-(((xx - cx) / r + 0.38) ** 2 + ((yy - cy) / r + 0.42) ** 2) / 0.035)
        al = np.clip(body + rim * 0.75 + hl, 0, 1) * a
    else:
        al = (1 - sstep(1 - soft, 1 + soft * 0.2, d)) * a
    reg = img[Y0:Y1, X0:X1]
    if add: reg += al[..., None] * col
    else: reg[:] = reg * (1 - al[..., None]) + al[..., None] * col

def bubbles(C, img, t, layer, burst_t=None):
    """bolhas subindo; layer 0 = atrás (pequenas), 1 = na frente (grandes, desfocadas)"""
    W, H, R = C.W, C.H, C.R
    n = 46 if layer == 0 else 16
    for i in range(n):
        r = rnd(5000 + layer * 1000 + i, 6)
        sp = (0.10 + 0.16 * r[0]) * (1.0 if layer == 0 else 1.9)
        rad = ((3 + 9 * r[1]) if layer == 0 else (16 + 30 * r[1])) * R
        py = (1.15 - ((t * sp + r[2] * 1.3) % 1.3)) * H
        px = (r[3] + 0.018 * math.sin(t * (2 + 3 * r[4]) + i)) * W
        disc(img, px, py, rad, hexc('#eaffff'), 0.75 if layer == 0 else 0.5, ring=1)
    if burst_t is not None and 0 <= burst_t < 1.6:   # explosão de bolhas ao chegar
        for i in range(90):
            r = rnd(7000 + i, 6)
            py = (1.05 - burst_t * (0.7 + 1.5 * r[0]) + 0.15 * r[1]) * H
            px = (r[2] + 0.03 * math.sin(burst_t * 9 + i)) * W
            disc(img, px, py, (5 + 26 * r[3] ** 2) * R, hexc('#eaffff'), 0.8 * (1 - burst_t / 1.6), ring=1)


# ── PORTAL (plano da parede → tela) ────────────────────────────────────────────
CAM_Y, TV, TH = 1.35, math.tan(math.radians(38)), math.tan(math.radians(38)) * 9 / 16
WALL_P1, WALL_D = np.array([0.5, -0.75]), np.array([-0.4937, -0.8696])
PORTAL_U, PORTAL_Y, PORTAL_R = 0.504, 1.09, 0.34
def wall2screen(C, u, y):
    p = WALL_P1 + u * WALL_D
    return np.array([(0.5 + (p[0] / -p[1]) / (2 * TH)) * C.W, (0.5 - ((y - CAM_Y) / -p[1]) / (2 * TV)) * C.H], np.float32)
def portal_center(C): return wall2screen(C, PORTAL_U, PORTAL_Y)

def portal_tex(C, t, S):
    """textura quadrada (S×S, RGBA premult) do portal de água no plano da parede"""
    age = t - T_WALL
    op = ease_back(age / 0.65, 2.4) if age < 0.65 else 1 + 0.025 * math.sin(age * 3.1)
    suck = clamp((t - T_SUCK) / 0.5)
    op *= 1 + 0.25 * suck
    E = 1.45
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    u, v = (x / S * 2 - 1) * E, (y / S * 2 - 1) * E
    rho = np.hypot(u, v) / max(op, 1e-3); th = np.arctan2(v, u)
    spin = t * (1.4 + 3.5 * suck)
    thp = th + 2.6 * np.power(np.clip(1 - rho, 0, 1), 1.4) + spin
    # corrente em espiral sendo puxada para o centro
    n1 = rmap(C.n_theta, ((thp / (2 * math.pi)) % 1 * 1023).astype(np.float32), ((rho * 0.7 + t * 0.35) % 1 * 255).astype(np.float32), cv2.INTER_LINEAR)
    n2 = rmap(C.n_fine, (((th + spin * 0.6) / (2 * math.pi)) % 1 * 1023).astype(np.float32), ((rho * 0.45 - t * 0.2) % 1 * 255).astype(np.float32), cv2.INTER_LINEAR)
    arms = 0.5 + 0.5 * np.sin(3 * thp + 7 * np.sqrt(np.clip(rho, 0, 2)) - t * 2.0)
    deep, mid, lite = hexc('#02132e'), hexc('#0a7fb0'), hexc('#aef6ff')
    k = np.clip(0.25 + 0.55 * arms * n1 + 0.5 * (n1 - 0.5), 0, 1)[..., None]
    inner = deep + (mid - deep) * k + (lite - mid) * np.clip(k * 2 - 1.1, 0, 1)
    core = np.exp(-(rho / 0.42) ** 2)[..., None]
    inner = inner + core * hexc('#d6ffff') * (0.55 + 0.6 * suck)
    inner *= (0.55 + 0.45 * np.clip(rho, 0, 1) ** 0.5)[..., None] * 0 + 1
    inner = inner * (0.75 + 0.25 * sstep(1.0, 0.55, rho))[..., None]      # sombra interna da borda (profundidade)
    edge = 1.0 + 0.045 * (n2 - 0.5) * 2 + 0.03 * np.sin(5 * th + t * 4)
    a_in = 1 - sstep(edge - 0.035, edge + 0.01, rho)
    rim = np.exp(-((rho - edge) / 0.06) ** 2) * (0.55 + 0.9 * n2)
    wisp = np.exp(-((rho - edge - 0.10) / 0.10) ** 2) * np.power(n2, 2.5) * 1.6
    foam = np.clip(rim + wisp, 0, 1.6)[..., None]
    rgb = inner * a_in[..., None] + foam * hexc('#e6ffff')
    a = np.clip(a_in + foam[..., 0] * 0.9, 0, 1)
    return np.dstack([rgb, a]).astype(np.float32)

def draw_portal(C, bg, t):
    """compõe o portal no fundo; devolve mapa de brilho (para iluminar a cena)"""
    W, H, R = C.W, C.H, C.R
    S = int(420 * R); E = 1.45 * PORTAL_R
    tex = portal_tex(C, t, S)
    src = np.array([[0, 0], [S, 0], [S, S], [0, S]], np.float32)
    dst = np.array([wall2screen(C, PORTAL_U + E, PORTAL_Y + E), wall2screen(C, PORTAL_U - E, PORTAL_Y + E),
                    wall2screen(C, PORTAL_U - E, PORTAL_Y - E), wall2screen(C, PORTAL_U + E, PORTAL_Y - E)], np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    full = cv2.warpPerspective(tex, M, (W, H), flags=cv2.INTER_LINEAR)
    a = full[..., 3]
    age = t - T_WALL; fl = 0.85 + 0.15 * math.sin(t * 7.3) * math.sin(t * 3.1)
    glow = blur(a, 90 * R) * fl
    # ondas na parede ao abrir (anel de refração que se expande)
    if age < 1.4:
        c = portal_center(C); d = np.hypot((C.xx - c[0]) / 0.72, C.yy - c[1])
        rr = (0.15 + age * 1.1) * 520 * R
        amp = 16 * R * (1 - age / 1.4) ** 2 * np.exp(-((d - rr) / (60 * R)) ** 2)
        nx, ny = (C.xx - c[0]) / (d + 1), (C.yy - c[1]) / (d + 1)
        bg[:] = rmap(bg, C.xx + nx * amp, C.yy + ny * amp, cv2.INTER_LINEAR)
    bg *= (1 - 0.30 * blur(a, 18 * R))[..., None]                 # oclusão/umidade em volta
    bg[:] = bg * (1 - a[..., None]) + full[..., :3]
    bg += glow[..., None] * hexc('#35c8ff') * 0.55
    # respingos do impacto
    if 0 <= age < 0.9:
        c = portal_center(C)
        for i in range(80):
            r = rnd(8100 + i, 5); an = r[0] * 2 * math.pi; sp = (500 + 1400 * r[1]) * R
            px = c[0] + math.cos(an) * sp * age * 0.72; py = c[1] + math.sin(an) * sp * age * 0.9 + 1700 * R * age * age
            disc(bg, px, py, (2.5 + 7 * r[2]) * R * (1 - age / 0.9), hexc('#e8ffff'), 0.9 * (1 - age / 0.9), soft=0.5)
    return glow


# ── ESFERA DE ÁGUA ─────────────────────────────────────────────────────────────
HOLD = np.array([0.0, -0.074])
def _hover(C, hand, t): return C.tr(hand, t) + HOLD + np.array([0.004 * math.sin(t * 3.1), 0.006 * math.sin(t * 4.3)])
def _arc(p0, p1, k, lift):
    p = p0 + (p1 - p0) * k; p[1] -= lift * 4 * k * (1 - k); return p
FLIGHTS = [  # (t_solta, t_pega, de, para, altura do arco)
    (31.86, 32.46, 'A', 'B', 0.40), (33.02, 33.90, 'B', 'A', 0.46), (34.08, 34.60, 'A', 'B', 0.38), (34.80, 35.34, 'B', 'A', 0.40)]
def ball_state(C, t):
    """→ (pos normalizada, raio normalizado à largura, vel) ou None"""
    if t < T_FORM or t > T_WALL: return None
    A, B = C.hA, C.hB; r0 = 0.072
    def pos(t):
        if t >= 37.80:   # arremesso para a parede
            k = (t - 37.80) / (T_WALL - 37.80)
            p0 = np.array([0.24, 0.50]); p1 = np.array([0.50, 0.42]); p2 = np.array(portal_center(C) / [C.W, C.H])
            k2 = k ** 1.5
            return (1 - k2) ** 2 * p0 + 2 * k2 * (1 - k2) * p1 + k2 ** 2 * p2
        if t >= 35.85:   # junta as duas mãos acima da cabeça
            m = (C.tr(A, t) + C.tr(B, t)) / 2 + np.array([0, -0.035]); k = ease_io((t - 35.85) / 0.42)
            p = _hover(C, A, t) * (1 - k) + m * k
            if t > 37.45: k2 = ease_io((t - 37.45) / 0.35); p = p * (1 - k2) + np.array([0.24, 0.50]) * k2
            return p
        holder = 'A'
        for (ts, tc, a, b, lift) in FLIGHTS:
            if ts <= t < tc:
                k = (t - ts) / (tc - ts)
                return _arc(_hover(C, A if a == 'A' else B, ts), _hover(C, A if b == 'A' else B, tc), k, lift)
            if t >= tc: holder = b
        return _hover(C, A if holder == 'A' else B, t)
    p = pos(t); v = (pos(t + 0.02) - pos(t - 0.02)) / 0.04
    r = r0 * ease_back((t - T_FORM) / 0.7, 1.5)
    if t > 35.9: r *= 1 + 0.75 * ease_io((t - 35.9) / 1.2)
    if t > 38.25: r *= 1 - 0.45 * clamp((t - 38.25) / (T_WALL - 38.25))    # afasta-se rumo à parede
    return p, r, v

def draw_water_ball(C, img, cpx, rad, t, vel=(0, 0), a=1.0):
    """esfera refrativa: lê o que está atrás (img) e devolve lente + brilho + especular"""
    H, W = img.shape[:2]
    sp = math.hypot(vel[0], vel[1]); st = min(0.55, sp / (rad * 28 + 1e-6))   # estica na direção do movimento
    ang = math.atan2(vel[1], vel[0]) if sp > 1e-3 else 0
    m = int(rad * (1.45 + st)) + 3
    x0, y0 = int(cpx[0]) - m, int(cpx[1]) - m; X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x0 + 2 * m), min(H, y0 + 2 * m)
    if X1 - X0 < 4 or Y1 - Y0 < 4: return
    yy, xx = np.mgrid[Y0:Y1, X0:X1].astype(np.float32)
    dx, dy = (xx - cpx[0]) / rad, (yy - cpx[1]) / rad
    ca, sa = math.cos(ang), math.sin(ang)
    u = (dx * ca + dy * sa) / (1 + st); v = (-dx * sa + dy * ca) * (1 + st * 0.35)
    th = np.arctan2(v, u)
    wob = 1 + 0.035 * np.sin(2 * th + t * 4.1) + 0.022 * np.sin(3 * th - t * 5.3) + 0.012 * np.sin(5 * th + t * 7)
    rho = np.hypot(u, v) / wob
    mask = (1 - sstep(0.965, 1.0, rho)) * a
    # refração: imagem invertida/comprimida no miolo, contínua na borda
    f = -0.55 + 1.55 * np.clip(rho, 0, 1) ** 3
    mapx = (cpx[0] + dx * rad * f).astype(np.float32); mapy = (cpx[1] + dy * rad * f).astype(np.float32)
    refr = rmap(img, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    z = np.sqrt(np.clip(1 - rho ** 2, 0, 1))
    body = hexc('#8be4ff') + (hexc('#0a5fa8') - hexc('#8be4ff')) * np.clip(v * 0.5 + 0.5, 0, 1)[..., None]   # água: ciano em cima, azul fundo embaixo
    col = refr * hexc('#9fdcff') * (0.45 + 0.20 * z[..., None]) + body * (0.50 + 0.22 * (1 - z[..., None]))
    cau = caustics(t * 1.6, xx.shape[1], xx.shape[0], 3.0) * (0.25 + 0.5 * z)
    col += cau[..., None] * hexc('#dfffff') * 0.55
    fres = np.clip(rho, 0, 1) ** 6
    col += fres[..., None] * hexc('#c8f6ff') * 0.30 + (np.exp(-((rho - 0.955) / 0.03) ** 2) * 0.55)[..., None] * hexc('#eaffff')
    col *= (1 - 0.16 * np.exp(-((rho - 0.84) / 0.08) ** 2))[..., None]            # anel escuro interno → volume
    hl = np.exp(-(((u + 0.36) / 0.20) ** 2 + ((v + 0.44) / 0.11) ** 2)) * 1.1 + np.exp(-(((u - 0.42) ** 2 + (v - 0.48) ** 2) / 0.012)) * 0.6
    hl += np.exp(-(((u + 0.05) / 0.5) ** 2 + ((v - 0.80) / 0.06) ** 2)) * 0.35     # luz de borda inferior
    col += hl[..., None] * mask[..., None]
    reg = img[Y0:Y1, X0:X1]
    halo = np.exp(-np.clip(rho - 1, 0, 9) ** 2 / 0.12) * (1 - mask) * 0.16 * a       # luz emitida no entorno
    reg[:] = reg * (1 - mask[..., None]) + col * mask[..., None] + halo[..., None] * hexc('#59d4ff')

def water_fx(C, img, t):
    st = ball_state(C, t)
    if st is None: return
    W, H, R = C.W, C.H, C.R
    p, r, v = st; cp = p * [W, H]; rad = r * W; vel = v * [W, H] / FPS
    # gotas convergindo para formar a esfera
    if t < T_FORM + 0.9:
        for i in range(46):
            q = rnd(4000 + i, 5); ta = T_FORM + 0.05 + 0.7 * q[0]; k = (t - (ta - 0.55)) / 0.55
            if 0 < k < 1:
                an = q[1] * 6.283; d0 = (0.16 + 0.22 * q[2]) * W
                e = ease_in(k); px = cp[0] + math.cos(an + (1 - e) * 1.4) * d0 * (1 - e); py = cp[1] + math.sin(an + (1 - e) * 1.4) * d0 * (1 - e) * 1.2
                draw_water_ball(C, img, (px, py), (5 + 9 * q[3]) * R * (0.5 + 0.5 * k), t + i, a=min(1, k * 3))
    # gotas que escapam durante os arremessos (rastro com gravidade)
    evs = [(ts, tc) for (ts, tc, *_x) in FLIGHTS] + [(37.80, T_WALL)]
    for ei, (ts, tc) in enumerate(evs):
        if ts - 0.05 < t < tc + 0.7:
            for i in range(16):
                q = rnd(4500 + ei * 50 + i, 5); te = ts + (tc - ts) * (0.05 + 0.85 * q[0]); age = t - te
                if 0 < age < 0.6:
                    s0 = ball_state(C, te)
                    if s0 is None: continue
                    p0 = s0[0] * [W, H]; v0 = s0[2] * [W, H]
                    px = p0[0] + v0[0] * 0.25 * age + (q[1] - 0.5) * 260 * R * age
                    py = p0[1] + v0[1] * 0.25 * age + (q[2] - 0.7) * 200 * R * age + 1500 * R * age * age
                    draw_water_ball(C, img, (px, py), (4 + 9 * q[3]) * R * (1 - age / 0.6), t + i, a=1)
    # satélites orbitando
    if t > T_FORM + 0.5:
        for i in range(5):
            q = rnd(4800 + i, 4); an = t * (2.2 + 1.5 * q[0]) * (1 if i % 2 else -1) + i * 1.3
            ox, oy = math.cos(an) * rad * (1.35 + 0.3 * q[1]), math.sin(an) * rad * 0.5 * (1 + q[2]) + math.cos(an * 0.7) * rad * 0.3
            draw_water_ball(C, img, (cp[0] + ox, cp[1] + oy), rad * (0.09 + 0.07 * q[3]), t * 2 + i)
    # esfera principal (3 sub-amostras quando rápida → motion blur)
    spd = math.hypot(*vel)
    if spd > rad * 0.35:
        acc = None; base = img.copy()
        for k in (-0.33, 0.0, 0.33):
            tmp = base.copy(); s2 = ball_state(C, t + k / FPS) or st
            draw_water_ball(C, tmp, s2[0] * [W, H], s2[1] * W, t, s2[2] * [W, H] / FPS)
            acc = tmp if acc is None else acc + tmp
        img[:] = acc / 3
    else:
        draw_water_ball(C, img, cp, rad, t, vel)


# ── HUD "técnicas de edição" (rastreamento real da pose/mãos + contorno do matte) ──
_mono = {}
def mono(size):
    if size not in _mono: _mono[size] = ImageFont.truetype(os.path.join(FONTS, 'JetBrainsMono-Bold.ttf'), size)
    return _mono[size]
def label(img, txt, x, y, size, col, a=1.0):
    f = mono(int(size)); w = int(f.getlength(txt)) + 4; h = int(size * 1.4)
    im = Image.new('L', (w, h), 0); ImageDraw.Draw(im).text((2, 0), txt, font=f, fill=255)
    s = np.asarray(im, np.float32) / 255 * a; H, W = img.shape[:2]; x, y = int(x), int(y)
    if x < 0 or y < 0 or x + w > W or y + h > H: return
    reg = img[y:y + h, x:x + w]; reg[:] = reg * (1 - s[..., None]) + col * s[..., None]

def hud_tracking(C, img, alpha, t, n_src):
    """5,4–8,4 s: 'usaremos todas as técnicas de edição' → mostra as técnicas em uso de verdade"""
    k = sstep(5.35, 5.7, t) * (1 - sstep(8.25, 8.5, t))
    if k <= 0: return
    W, H, R = C.W, C.H, C.R; g = GREEN
    # contorno do matte com linha de varredura
    e = cv2.morphologyEx(alpha, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    e = np.clip(blur(e, 1.2 * R) * 2.2, 0, 1)
    ys = ((t - 5.4) * 0.55 % 1.0) * H
    scan = np.exp(-((C.yy - ys) / (90 * R)) ** 2)
    img += (e * (0.30 + 1.2 * scan) * k)[..., None] * g
    img += (np.exp(-((C.yy - ys) / (2.0 * R)) ** 2) * 0.22 * k * (1 - alpha * 0.6))[..., None] * g
    # esqueleto rastreado
    po = C.track[n_src]['pose']
    if po:
        P = np.array(po)[:, :2] * [W, H]
        for a_, b_ in [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24)]:
            if P[a_][1] < H * 1.05 and P[b_][1] < H * 1.05:
                cv2.line(img, tuple(P[a_].astype(int)), tuple(P[b_].astype(int)), (g * 0.8 * k).tolist(), max(1, int(1.6 * R)), cv2.LINE_AA)
        for j in (11, 12, 13, 14, 15, 16):
            disc(img, P[j][0], P[j][1], 6 * R, g, k, soft=0.3)
        # caixa de rosto + etiquetas
        fx = [P[i][0] for i in (0, 7, 8)]; cx, cy = P[0]; s = abs(P[7][0] - P[8][0]) * 0.9 + 10 * R
        x0, y0, x1, y1 = int(cx - s), int(cy - s * 1.25), int(cx + s), int(cy + s * 1.05); L = int(s * 0.32); th = max(2, int(3 * R))
        for (xa, ya, sx, sy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)]:
            cv2.line(img, (xa, ya), (xa + sx * L, ya), (g * k).tolist(), th, cv2.LINE_AA); cv2.line(img, (xa, ya), (xa, ya + sy * L), (g * k).tolist(), th, cv2.LINE_AA)
        label(img, 'FACE TRACK · ID LOCK', x0, y1 + 8 * R, 26 * R, g, k)
        label(img, f'ROTO MATTE  {n_src:04d}/1808', 40 * R, 0.845 * H, 26 * R, g, k)
        label(img, 'POSE · 33 PTS   HANDS · 21 PTS', 40 * R, 0.845 * H + 40 * R, 26 * R, g, k)
    for h in C.track[n_src]['hands']:
        P = np.array(h['pts']) * [W, H]
        for a_, b_ in [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (17, 18), (18, 19), (19, 20), (0, 17)]:
            cv2.line(img, tuple(P[a_].astype(int)), tuple(P[b_].astype(int)), (g * k).tolist(), max(1, int(1.6 * R)), cv2.LINE_AA)
        for q in P: disc(img, q[0], q[1], 3.5 * R, WHITE, k, soft=0.3)

def hud_rec(C, img, t):
    """0–2,3 s: 'esse é um vídeo gravado' → moldura REC"""
    k = sstep(0.1, 0.35, t) * (1 - sstep(2.1, 2.35, t))
    if k <= 0: return
    W, H, R = C.W, C.H, C.R; c = (WHITE * k).tolist(); th = max(2, int(3 * R)); L = int(70 * R)
    x0, y0, x1, y1 = int(0.06 * W), int(0.115 * H), int(0.94 * W), int(0.80 * H)
    for (xa, ya, sx, sy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)]:
        cv2.line(img, (xa, ya), (xa + sx * L, ya), c, th, cv2.LINE_AA); cv2.line(img, (xa, ya), (xa, ya + sy * L), c, th, cv2.LINE_AA)
    if int(t * 2.5) % 2 == 0: disc(img, x0 + 34 * R, y0 + 44 * R, 11 * R, hexc('#ff2a3c'), k)
    label(img, 'REC', x0 + 56 * R, y0 + 24 * R, 30 * R, WHITE, k)
    fr = int(t * FPS); label(img, f'00:00:{int(t):02d}:{fr % 24:02d}', x1 - 250 * R, y0 + 24 * R, 30 * R, WHITE, k)
    label(img, '4K · 24 FPS', x0 + 6 * R, y1 - 56 * R, 24 * R, WHITE, k * 0.8)


# ── quadro ─────────────────────────────────────────────────────────────────────
ZOOMS = [(0.0, 1.0), (5.38, 1.09), (8.42, 1.0), (12.2, 1.07), (16.76, 1.0), (23.16, 1.06), (26.66, 1.0), (62.48, 1.07), (69.70, 1.0)]
IMPACTS = [(T_STUDIO, 1.0), (T_WALL, 0.9), (T_WATER, 0.8), (T_BACK + 0.25, 0.5)]

def grade(img, era):
    # curva filmica suave + separação de cor (sombras frias / altas quentes)
    x = np.clip(img, 0, 1)
    x = x * x * (3 - 2 * x) * 0.55 + x * 0.45
    l = x.mean(-1, keepdims=True)
    x = l + (x - l) * 1.10
    x[..., 0] += 0.018 * (1 - l[..., 0]); x[..., 2] += 0.015 * l[..., 0]
    return x

def render_frame(C, n_out, F, A):
    W, H, R = C.W, C.H, C.R
    n = out2src(n_out); t = n / FPS
    a = np.clip((A - 0.04) / 0.92, 0, 1)
    ae = a[..., None]
    water = T_WATER <= t < T_BACK + 0.75
    studio = (t >= T_STUDIO and not (T_WATER <= t < T_BACK))
    head = C.tr(C.head, t) * [W, H]

    # ── 1. fundo ──
    glow = None
    if t < T_STUDIO + 1.0 and t < T_WATER:
        bath = F * 0.80; lum = bath.mean(-1, keepdims=True); bath = lum + (bath - lum) * 0.82      # banheiro: fundo mais discreto
        bath[..., 0] *= 1.03
    if t < T_STUDIO: bg = bath
    elif t < T_WATER or t >= T_BACK:
        z = 1.0 + 0.012 * math.sin(t * 0.21)
        bg = C.studio * (0.96 + 0.04 * math.sin(t * 1.3))
        if t < T_STUDIO + 1.0:      # transição: onda radial a partir de trás da cabeça
            k = clamp((t - T_STUDIO) / 0.85); c = C.tr(C.head, T_STUDIO) * [W, H]
            d = np.hypot(C.xx - c[0], C.yy - c[1]); rr = ease_out(k) * 1.25 * H
            m = 1 - sstep(rr - 50 * R, rr + 10 * R, d)
            ring = np.exp(-((d - rr) / (34 * R)) ** 2) * (1 - k) ** 0.6
            amp = ring * 46 * R; nx, ny = (C.xx - c[0]) / (d + 1), (C.yy - c[1]) / (d + 1)
            bath = rmap(bath, C.xx - nx * amp, C.yy - ny * amp, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            bg = bath * (1 - m[..., None]) + bg * m[..., None]
            bg += ring[..., None] * (GREEN * 0.9 + 0.5)
            bg += (np.exp(-(d / (0.5 * H)) ** 2) * 0.5 * (1 - k) ** 2)[..., None]
        else: bg = bg.copy()
    if water:
        wb = water_bg(C, t)
        bubbles(C, wb, t, 0, burst_t=t - T_WATER)
        if t < T_BACK: bg = wb
        else:
            # volta ao estúdio: cortina de bolhas subindo
            k = (t - T_BACK) / 0.7; yf = lerp(1.12, -0.15, ease_io(k)) * H + np.sin(C.xx / W * 9 + t * 6) * 26 * R
            m = sstep(-30 * R, 30 * R, C.yy - yf)[..., None]
            bg = wb * (1 - m) + C.studio * m
            bg += (np.exp(-((C.yy - yf) / (70 * R)) ** 2) * 0.55)[..., None] * hexc('#aef6ff')
    if T_WALL <= t < T_WATER: glow = draw_portal(C, bg, t)

    # ── 2. legendas no espaço (entre o fundo e o corpo) ──
    trgb, ta = render_captions(C, t)
    if trgb is not None:
        sh = blur(np.roll(ta, (int(16 * R), int(12 * R)), (0, 1)), 13 * R)
        if water:   # texto submerso: ondula
            mx = C.xx + np.sin(C.yy / (70 * R) + t * 2.2) * 5 * R; my = C.yy + np.sin(C.xx / (90 * R) + t * 1.7) * 4 * R
            trgb = rmap(trgb, mx, my, cv2.INTER_LINEAR); ta = rmap(ta, mx, my, cv2.INTER_LINEAR)
        light = 1.0
        if studio: trgb = trgb * (0.90 + 0.10 * (1 - C.yy / H))[..., None]
        bg = bg * (1 - 0.50 * sh[..., None]) * (1 - ta[..., None]) + trgb
        bg += blur(trgb, 26 * R) * 0.16                                   # bloom do texto no ambiente

    # ── 3. corpo ──
    if t < T_STUDIO:
        fg = F
    else:
        fg = np.clip((F - (1 - ae) * C.plate) / np.maximum(ae, 0.06), 0, 1)     # "unmix" com o clean plate → borda limpa
        fg = np.where(ae > 0.02, fg, F)
        if t < T_STUDIO + 1.0:
            k = clamp((t - T_STUDIO) / 0.5); fg = F * (1 - k) + fg * k
    if water and t < T_BACK:
        ca = cv2.resize(caustics(t * 1.2, 135, 240, 6.0), (W, H), interpolation=cv2.INTER_CUBIC)
        fg = fg * hexc('#a8e4ff') * 0.92 + hexc('#04304f') * 0.10
        fg = fg * (1 + 0.55 * ca[..., None] * sstep(1.0, 0.45, C.yy / H)[..., None])
    elif studio:
        fg = fg * np.array([0.97, 1.0, 1.045], np.float32)                      # chave quente do estúdio
    a2 = a
    # sucção para dentro do portal
    if T_SUCK <= t < T_WATER:
        p = clamp((t - T_SUCK) / (CUT_A / FPS - T_SUCK)); c = portal_center(C)
        s = 1 - 0.90 * p ** 1.8; M = cv2.getRotationMatrix2D((float(c[0]), float(c[1])), 55 * p ** 2, s)
        a_s = a * (1 - sstep(H * (1 - 0.34 * min(1.0, p * 4) - 0.01), H * 0.995, C.yy))      # some pela base (sem borda dura ao encolher)
        pm = cv2.warpAffine(np.dstack([fg * a_s[..., None], a_s]), M, (W, H), flags=cv2.INTER_LINEAR)
        a2 = pm[..., 3] * (1 - p ** 3); fg = pm[..., :3] / np.maximum(pm[..., 3:4], 0.05)
        fg = fg * (1 - 0.8 * p) + hexc('#c8f8ff') * 0.8 * p
    ae2 = a2[..., None]
    comp = bg * (1 - ae2) + fg * ae2
    # integração de luz: light wrap + contraluz do portal/água
    if t >= T_STUDIO:
        edge = np.clip(blur(a2, 9 * R) - 0.0, 0, 1); edge = (a2 * (1 - edge))[..., None]
        comp += blur(bg, 30 * R) * edge * (1.5 if water else 1.0)
        if glow is not None:
            comp += (glow * a2)[..., None] * hexc('#35c8ff') * 0.50 + (blur(glow, 40 * R) * edge[..., 0])[..., None] * hexc('#9fefff') * 1.4

    # ── 4. efeitos à frente ──
    hud_rec(C, comp, t); hud_tracking(C, comp, a, t, n)
    water_fx(C, comp, t)
    if water and t < T_BACK + 0.7:
        fr = np.zeros_like(comp); bubbles(C, fr, t, 1); fr = blur(fr, 5 * R)
        k = 1.0 if t < T_BACK else 1 - clamp((t - T_BACK) / 0.6)
        comp = comp * (1 - 0.0) + fr * 0.8 * k
        comp = comp * (1 - 0.10 * k) + hexc('#0b5d86') * 0.10 * k                 # véu de água
    if studio and t < T_WATER or t >= T_BACK + 0.7:   # poeira em contraluz (bokeh)
        for i in range(34):
            q = rnd(2000 + i, 6); px = ((q[0] + t * 0.006 * (q[1] - 0.5) * 3) % 1) * W; py = ((q[2] - t * (0.004 + 0.01 * q[3])) % 1) * H
            disc(comp, px, py, (3 + 12 * q[4] ** 2) * R, hexc('#ffe2b8'), 0.05 + 0.10 * q[5] * (0.6 + 0.4 * math.sin(t * 1.3 + i)), soft=0.8, add=True)

    # ── 5. câmera virtual, flashes, acabamento ──
    z = 1.0; zt = 0.0
    for (tz, zz) in ZOOMS:
        if t >= tz: z, zt = zz, tz
    z *= 1 + 0.004 * (t - zt)                                    # push-in lento contínuo
    sx = sy = 0.0; ca_amt = 0.0
    for (ti, amp) in IMPACTS:
        d = t - ti
        if 0 <= d < 0.6:
            e = (1 - d / 0.6) ** 2 * amp
            sx += math.sin(d * 71) * 14 * R * e; sy += math.cos(d * 63) * 18 * R * e; z *= 1 + 0.035 * e; ca_amt += e
    if T_SUCK <= t < T_WATER:
        p = clamp((t - T_SUCK) / (CUT_A / FPS - T_SUCK)); z *= 1 + 1.6 * p ** 4; zc = portal_center(C) * p + head * (1 - p)
    else:
        zc = np.array([lerp(float(np.clip(head[0], 0.35 * W, 0.65 * W)), 0.5 * W, 0.65), head[1] - 0.10 * H])
    if t >= T_WATER and t < T_WATER + 0.6: z *= 1 + 0.18 * (1 - ease_out((t - T_WATER) / 0.6))
    if abs(z - 1) > 1e-4 or sx or sy:
        M = np.array([[z, 0, zc[0] - z * zc[0] + sx], [0, z, zc[1] - z * zc[1] + sy]], np.float32)
        comp = cv2.warpAffine(comp, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    if ca_amt > 0.02:    # aberração cromática nos impactos
        s = 1 + 0.006 * ca_amt
        for ch, sc in ((0, 1 / s), (2, s)):
            M = np.array([[sc, 0, W / 2 * (1 - sc)], [0, sc, H / 2 * (1 - sc)]], np.float32)
            comp[..., ch] = cv2.warpAffine(comp[..., ch], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    comp = grade(comp, 0) * C.vig
    fl = 0.0
    if T_STUDIO <= t < T_STUDIO + 0.3: fl = 0.22 * (1 - (t - T_STUDIO) / 0.3)
    if T_WALL <= t < T_WALL + 0.25: fl = 0.30 * (1 - (t - T_WALL) / 0.25)
    if T_SUCK <= t < T_WATER: fl = clamp((t - (CUT_A / FPS - 0.25)) / 0.25) ** 2
    if T_WATER <= t < T_WATER + 0.45: fl = (1 - (t - T_WATER) / 0.45) ** 2
    if n_out >= N_OUT - 5: fl = ((n_out - (N_OUT - 6)) / 5) ** 2          # flash para a vinheta
    if fl > 0: comp = comp * (1 - fl) + (hexc('#eaffff') if t > 30 and n_out < N_OUT - 6 else 1.0) * fl
    g = np.random.default_rng(n_out).standard_normal((H // 2, W // 2)).astype(np.float32)
    comp += cv2.resize(g, (W, H), interpolation=cv2.INTER_LINEAR)[..., None] * 0.012
    return (np.clip(comp, 0, 1) * 255 + 0.5).astype(np.uint8)


def render_range(a, n0, n1, out):
    C = Ctx(a)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{C.W}x{C.H}', '-r', str(FPS), '-i', '-',
                            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', out], stdin=subprocess.PIPE)
    n = n0
    while n < n1:
        seg_end = min(n1, CUT_A) if n < CUT_A else n1
        rd = Reader(C, out2src(n), out2src(n) + (seg_end - n))
        for k in range(n, seg_end):
            F, A = rd.read(); enc.stdin.write(render_frame(C, k, F, A).tobytes())
            if (k - n0) % 24 == 0: print(f'[{n0}] {k - n0}/{n1 - n0}', flush=True)
        rd.close(); n = seg_end
    enc.stdin.close(); enc.wait()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True); ap.add_argument('--work', required=True); ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--out'); ap.add_argument('--from', dest='t0', type=float, default=0); ap.add_argument('--to', dest='t1', type=float, default=N_OUT / FPS)
    ap.add_argument('--stills'); ap.add_argument('--procs', type=int, default=4); ap.add_argument('--chunk', default=None)
    a = ap.parse_args()
    if a.stills:
        C = Ctx(a); os.makedirs(os.path.join(a.work, 'stills'), exist_ok=True)
        for ts in a.stills.split(','):
            n = int(round(float(ts) * FPS)); rd = Reader(C, out2src(n), out2src(n) + 1); F, A = rd.read(); rd.close()
            cv2.imwrite(os.path.join(a.work, 'stills', f's_{float(ts):06.2f}.jpg'), render_frame(C, n, F, A), [cv2.IMWRITE_JPEG_QUALITY, 90])
        return
    n0, n1 = int(round(a.t0 * FPS)), min(N_OUT, int(round(a.t1 * FPS)))
    if a.chunk:
        c0, c1 = map(int, a.chunk.split(':')); render_range(a, c0, c1, a.out); return
    step = math.ceil((n1 - n0) / a.procs); parts = []; procs = []
    for i in range(a.procs):
        c0, c1 = n0 + i * step, min(n1, n0 + (i + 1) * step)
        if c0 >= c1: break
        p = f'{a.out}.part{i}.mp4'; parts.append(p)
        procs.append(subprocess.Popen([sys.executable, __file__, '--src', a.src, '--work', a.work, '--scale', str(a.scale), '--out', p, '--chunk', f'{c0}:{c1}']))
    for p in procs: p.wait()
    lst = a.out + '.txt'; open(lst, 'w').write('\n'.join(f"file '{p}'" for p in parts))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', a.out], check=True)
    for p in parts: os.remove(p)
    os.remove(lst)

if __name__ == '__main__': main()
