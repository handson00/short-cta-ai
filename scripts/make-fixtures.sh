#!/usr/bin/env bash
# Gera vídeos de teste para os casos da seção 13: sem fala, sem CTA, OCR difícil,
# legenda confundível com gancho e marca d'água.
set -euo pipefail

OUT="${1:-tests/fixtures}"
mkdir -p "$OUT"

FONT="${FIXTURE_FONT:-}"
if [ -z "$FONT" ]; then
  for candidate in \
    /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
    /usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf \
    /System/Library/Fonts/Supplemental/Arial\ Bold.ttf; do
    [ -f "$candidate" ] && FONT="$candidate" && break
  done
fi
if [ -z "$FONT" ]; then
  echo "Nenhuma fonte encontrada para drawtext. Defina FIXTURE_FONT=/caminho/para/fonte.ttf" >&2
  exit 1
fi

SIZE="608x1080"
say() { echo "  -> $1"; }

say "sem fala, sem texto"
ffmpeg -y -v error -f lavfi -i "color=c=0x16213e:s=$SIZE:d=6,noise=alls=8:allf=t" \
  -c:v libx264 -crf 34 -preset veryfast -pix_fmt yuv420p -r 24 "$OUT/sem_fala_sem_cta.mp4"

say "gancho no terço superior"
ffmpeg -y -v error -f lavfi -i "color=c=0x101820:s=$SIZE:d=6" \
  -vf "drawtext=fontfile=$FONT:text='A DECISAO PARECIA CRUEL':fontcolor=white:fontsize=46:x=(w-tw)/2:y=h*0.12:box=1:boxcolor=black@0.4:boxborderw=12,\
drawtext=fontfile=$FONT:text='MAS SALVOU VIDAS':fontcolor=white:fontsize=46:x=(w-tw)/2:y=h*0.12+60:box=1:boxcolor=black@0.4:boxborderw=12" \
  -c:v libx264 -pix_fmt yuv420p -r 24 "$OUT/gancho_topo.mp4"

say "legenda embaixo + marca d'agua"
ffmpeg -y -v error -f lavfi -i "color=c=0x1a1a2e:s=$SIZE:d=6" \
  -vf "drawtext=fontfile=$FONT:text='- Nao faca isso agora':fontcolor=white:fontsize=34:x=(w-tw)/2:y=h*0.86,\
drawtext=fontfile=$FONT:text='@cortesdofilme':fontcolor=white@0.7:fontsize=22:x=w-tw-20:y=30" \
  -c:v libx264 -pix_fmt yuv420p -r 24 "$OUT/legenda_marca.mp4"

say "OCR dificil: baixo contraste"
ffmpeg -y -v error -f lavfi -i "color=c=0x3a3a3a:s=$SIZE:d=6" \
  -vf "drawtext=fontfile=$FONT:text='ELE NAO ESPERAVA ESSA RESPOSTA':fontcolor=0x4a4a4a:fontsize=30:x=(w-tw)/2:y=h*0.15" \
  -c:v libx264 -pix_fmt yuv420p -r 24 "$OUT/ocr_dificil.mp4"

say "gancho que aparece so depois de 2s (animacao)"
ffmpeg -y -v error -f lavfi -i "color=c=0x0f3460:s=$SIZE:d=8" \
  -vf "drawtext=fontfile=$FONT:text='O QUE ELE FEZ DEPOIS MUDOU TUDO':fontcolor=white:fontsize=40:x=(w-tw)/2:y=h*0.1:enable='gte(t,2)':box=1:boxcolor=black@0.35:boxborderw=10" \
  -c:v libx264 -pix_fmt yuv420p -r 24 "$OUT/gancho_atrasado.mp4"

say "com trilha de audio silenciosa"
ffmpeg -y -v error -f lavfi -i "color=c=0x222831:s=$SIZE:d=6" -f lavfi -i "anullsrc=r=16000:cl=mono" \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -r 24 "$OUT/audio_silencioso.mp4"

echo "Fixtures em $OUT"
