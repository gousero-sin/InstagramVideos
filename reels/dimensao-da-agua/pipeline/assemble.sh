#!/usr/bin/env bash
# Montagem final: composição 4K + vinheta + áudio → masters em out/
#   pipeline/assemble.sh WORKDIR
set -euo pipefail
W="$1"; HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; OUT="$HERE/out"; mkdir -p "$OUT"
X264="-c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709"
# vinheta: 72 fps → 24 fps com motion blur (média de 3 sub-quadros), ampliada para 4K; entra a partir do flash branco
ffmpeg -v error -y -framerate 72 -start_number 20 -i "$W/vin/v_%04d.png" \
  -vf "tmix=frames=3:weights='1 1 1',framestep=3,scale=2160:3840:flags=lanczos,fade=t=in:st=0:d=0.25:color=white,fade=t=out:st=3.35:d=0.3" \
  -r 24 $X264 -crf 10 "$W/vin4k.mp4"
VD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/vin4k.mp4")
MD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/main4k.mp4")
# áudio: mix do vídeo + trilha da vinheta (final da trilha original do canal), normalizado em -14 LUFS / -1 dBTP
ffmpeg -v error -y -i "$W/mix.wav" -ss 26.298 -t "$VD" -i "$ROOT/reels/planilha-para-sistema/audio/soundtrack.wav" -filter_complex \
  "[0:a]apad=whole_dur=$MD,atrim=0:$MD[a0];[1:a]volume=0.7,afade=t=in:d=0.04,afade=t=out:st=3.3:d=0.4[a1];[a0][a1]concat=n=2:v=0:a=1,loudnorm=I=-14:TP=-1:LRA=9,aresample=48000[a]" \
  -map "[a]" "$W/final.wav"
printf "file '%s'\nfile '%s'\n" "$W/main4k.mp4" "$W/vin4k.mp4" > "$W/final.txt"
ffmpeg -v error -y -f concat -safe 0 -i "$W/final.txt" -i "$W/final.wav" -map 0:v -map 1:a $X264 -crf 19 -maxrate 10.5M -bufsize 21M \
  -g 48 -movflags +faststart -c:a aac -b:a 256k -shortest "$OUT/dimensao-da-agua-4k.mp4"
ffmpeg -v error -y -f concat -safe 0 -i "$W/final.txt" -i "$W/final.wav" -map 0:v -map 1:a -vf "scale=1080:1920:flags=lanczos" $X264 -crf 18 -maxrate 7M -bufsize 14M \
  -g 48 -movflags +faststart -c:a aac -b:a 256k -shortest "$OUT/dimensao-da-agua-1080p.mp4"
ffmpeg -v error -y -ss 41.5 -i "$OUT/dimensao-da-agua-4k.mp4" -frames:v 1 -vf "scale=1080:1920:flags=lanczos" -q:v 2 "$OUT/capa.jpg"
ffmpeg -v error -y -i "$OUT/dimensao-da-agua-1080p.mp4" -vf "select='eq(n,40)+eq(n,165)+eq(n,255)+eq(n,440)+eq(n,520)+eq(n,700)+eq(n,772)+eq(n,880)+eq(n,935)+eq(n,996)+eq(n,1104)+eq(n,1150)+eq(n,1215)+eq(n,1640)',scale=270:480,tile=7x2" -frames:v 1 -q:v 3 "$OUT/storyboard.jpg"
ls -la "$OUT"
