"""Recorte da pessoa (alpha matte) com Robust Video Matting (ONNX, recorrente).

uso: python3 -I matte.py <video> <modelo.onnx> <saida_dir> [downsample_ratio] [max_frames]
Gera <saida_dir>/%05d.png em tons de cinza, já ampliado para 1080x1920 (bicúbico).
"""
import sys, os, subprocess, numpy as np, cv2, onnxruntime as ort, time

video, model, out = sys.argv[1:4]
ratio = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
maxf = int(sys.argv[5]) if len(sys.argv) > 5 else 10**9
os.makedirs(out, exist_ok=True)

info = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video]).decode().strip().split(',')
W, H = int(info[0]), int(info[1])

def frames():
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', video, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)

sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'], sess_options=ort.SessionOptions())
names = [i.name for i in sess.get_inputs()]
print('inputs', names, [o.name for o in sess.get_outputs()])
rec = [np.zeros((1, 1, 1, 1), np.float32) for _ in range(4)]
dsr = np.array([ratio], np.float32)

def run(img):
    global rec
    src = (img.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    o = sess.run(None, {'src': src, 'r1i': rec[0], 'r2i': rec[1], 'r3i': rec[2], 'r4i': rec[3], 'downsample_ratio': dsr})
    rec = list(o[2:6])
    return o[1][0, 0]

# aquece o estado recorrente nos primeiros quadros (evita "fantasma" no frame 0)
warm = []
for i, f in enumerate(frames()):
    warm.append(f)
    if i >= 23: break
for f in warm: run(f)
t0 = time.time()
for i, f in enumerate(frames()):
    if i >= maxf: break
    a = run(f)
    a = cv2.resize(a, (1080, 1920), interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(out, f'{i+1:05d}.png'), np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    if i % 25 == 0: print(f'{i} {(time.time()-t0)/(i+1):.2f}s/quadro', flush=True)
print('ok', i + 1)
