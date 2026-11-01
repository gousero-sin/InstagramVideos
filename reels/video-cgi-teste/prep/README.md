# Pré-processamento (vídeo → matte + tracking)

Gera o que o compositor precisa a partir do vídeo gravado:

| Script | Saída | Para quê |
|---|---|---|
| `matte.py` | `matte/%05d.png` (1080×1920, cinza) | recorte da pessoa (alpha) — o texto/efeitos passam **atrás** dela |
| `track.py` → `smooth.py` | `data/track.json` | mão, rosto e pose suavizados — âncora do orbe de mágica e da legenda |

## Dependências

```bash
pip install numpy opencv-python-headless onnxruntime mediapipe
```

## Modelos (baixados à parte, não vão para o repositório)

```bash
mkdir models && cd models
# Robust Video Matting (recorte de vídeo com memória temporal)
curl -LO https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.onnx
# MediaPipe (mão / rosto / pose)
G=https://storage.googleapis.com/mediapipe-models
curl -LO $G/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
curl -LO $G/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
curl -LO $G/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
```

## Quadros do vídeo

O compositor lê `footage/%05d.jpg` (1080×1920). Reduz ruído e amplia com Lanczos:

```bash
ffmpeg -i ../data/original.mp4 -vf "hqdn3d=2.5:2.5:6:6,scale=1080:1920:flags=lanczos,unsharp=5:5:0.45:5:5:0.0" \
       -q:v 2 -start_number 1 footage/%05d.jpg
```

## Observação sobre o MediaPipe em containers

O `mediapipe` carrega `libEGL.so.1` / `libGLESv2.so.2` ao importar, mesmo rodando só em CPU. Em imagens sem essas
bibliotecas (sem GPU), basta uma biblioteca vazia com esses nomes e `LD_LIBRARY_PATH` apontando para ela — a
inferência dos landmarkers não usa OpenGL.
