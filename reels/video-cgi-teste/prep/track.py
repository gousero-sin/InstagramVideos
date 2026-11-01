"""Rastreamento por quadro com MediaPipe: mãos (21 pts), rosto (478 pts → resumo) e pose (corpo).

uso: python3 -I track.py <video> <models_dir> <saida.json>
Coordenadas normalizadas (0..1) no quadro original; y cresce para baixo.
"""
import sys, json, subprocess, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

video, models, out = sys.argv[1:4]
info = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', video]).decode().strip().split(',')
W, H = int(info[0]), int(info[1])
num, den = info[2].split('/')
FPS = float(num) / float(den)

def mk(cls, optcls, file, **kw):
    return cls.create_from_options(optcls(base_options=mpp.BaseOptions(model_asset_path=f'{models}/{file}'), running_mode=vision.RunningMode.VIDEO, **kw))

hands = mk(vision.HandLandmarker, vision.HandLandmarkerOptions, 'hand_landmarker.task', num_hands=2,
           min_hand_detection_confidence=0.25, min_hand_presence_confidence=0.25, min_tracking_confidence=0.25)
face = mk(vision.FaceLandmarker, vision.FaceLandmarkerOptions, 'face_landmarker.task', num_faces=1,
          min_face_detection_confidence=0.3, min_face_presence_confidence=0.3, min_tracking_confidence=0.3)
pose = mk(vision.PoseLandmarker, vision.PoseLandmarkerOptions, 'pose_landmarker_heavy.task', num_poses=1,
          min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3, min_tracking_confidence=0.3)

p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', video, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
n = W * H * 3
res = []
i = 0
r4 = lambda v: round(float(v), 4)
while True:
    b = p.stdout.read(n)
    if len(b) < n: break
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.frombuffer(b, np.uint8).reshape(H, W, 3).copy())
    ts = int(i * 1000 / FPS)
    fr = {'i': i, 't': r4(i / FPS), 'hands': [], 'face': None, 'pose': None}
    h = hands.detect_for_video(img, ts)
    for lm, hd in zip(h.hand_landmarks, h.handedness):
        fr['hands'].append({'side': hd[0].category_name, 'score': r4(hd[0].score), 'lm': [[r4(q.x), r4(q.y), r4(q.z)] for q in lm]})
    f = face.detect_for_video(img, ts)
    if f.face_landmarks:
        lm = f.face_landmarks[0]
        xs = [q.x for q in lm]; ys = [q.y for q in lm]
        pick = lambda k: [r4(lm[k].x), r4(lm[k].y), r4(lm[k].z)]
        fr['face'] = {'bbox': [r4(min(xs)), r4(min(ys)), r4(max(xs)), r4(max(ys))], 'nose': pick(1), 'forehead': pick(10), 'chin': pick(152),
                      'eyeL': pick(33), 'eyeR': pick(263), 'mouth': pick(13), 'earL': pick(234), 'earR': pick(454)}
    po = pose.detect_for_video(img, ts)
    if po.pose_landmarks:
        lm = po.pose_landmarks[0]
        names = {'nose': 0, 'earL': 7, 'earR': 8, 'shL': 11, 'shR': 12, 'elL': 13, 'elR': 14, 'wrL': 15, 'wrR': 16, 'idxL': 19, 'idxR': 20, 'thL': 21, 'thR': 22}
        fr['pose'] = {k: [r4(lm[v].x), r4(lm[v].y), r4(lm[v].visibility)] for k, v in names.items()}
    res.append(fr)
    i += 1
    if i % 100 == 0: print(i, flush=True)
json.dump({'w': W, 'h': H, 'fps': FPS, 'frames': res}, open(out, 'w'))
print('ok', i, 'quadros; mãos detectadas em', sum(1 for r in res if r['hands']), '; rosto em', sum(1 for r in res if r['face']), '; pose em', sum(1 for r in res if r['pose']))
