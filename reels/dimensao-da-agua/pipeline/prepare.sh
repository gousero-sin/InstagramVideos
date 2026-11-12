#!/usr/bin/env bash
# Pré-processamento (uma vez por filmagem). Gera em WORKDIR tudo o que o edit.py/audio.py consomem.
#   pipeline/prepare.sh /caminho/IMG_8928.MOV WORKDIR MODELS_DIR
# MODELS_DIR precisa de: rvm_resnet50_fp32.onnx (Robust Video Matting), hand_landmarker.task e pose_landmarker_heavy.task (MediaPipe).
# pip: numpy scipy opencv-python-headless pillow onnxruntime mediapipe openai-whisper
set -euo pipefail
SRC="$1"; W="$2"; M="$3"; P="$(cd "$(dirname "$0")" && pwd)"; mkdir -p "$W"; cd "$W"
ffmpeg -v error -y -i "$SRC" -vf "scale=1080:1920:flags=area" -c:v libx264 -preset veryfast -crf 12 -an proxy.mp4   # proxy p/ análise
ffmpeg -v error -y -i "$SRC" -ac 1 -ar 16000 audio16k.wav
python3 "$P/transcribe.py" audio16k.wav transcript.json          # Whisper large-v3, tempo por palavra
RVM_MODEL="$M/rvm_resnet50_fp32.onnx" python3 "$P/matte.py" "$SRC" matte.mkv 1080 1920   # rotoscopia quadro a quadro
python3 "$P/plate.py"                                            # clean plate (câmera fixa): fundo sem a pessoa
python3 "$P/track.py" "$M"                                       # pose (33 pts) + mãos (21 pts) por quadro
python3 "$P/hands.py" > /dev/null                                # trilhas suavizadas das mãos/cabeça
python3 "$P/prep.py" "$W"                                        # envelope da voz, matte reduzido, palavras ajustadas ao áudio
(cd "$P/../../.." && node reels/dimensao-da-agua/studio/render.mjs "$W/studio.png")      # plate do estúdio 3D (Three.js)
(cd "$P/../../.." && node reels/dimensao-da-agua/pipeline/vinheta.mjs "$W/vin")          # quadros da vinheta
