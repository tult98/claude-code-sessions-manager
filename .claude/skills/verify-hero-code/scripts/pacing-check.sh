#!/bin/sh
# Usage: pacing-check.sh <evidence-dir>
# Rejects a clip shorter than MIN_SEC_PER_ACTION per action, or one with a frozen
# stretch longer than MAX_FREEZE_SEC (dead air). Exits 1 if any clip fails.
MIN_SEC_PER_ACTION=${MIN_SEC_PER_ACTION:-2}
MAX_FREEZE_SEC=${MAX_FREEZE_SEC:-6}
dir="$1"
[ -d "$dir/video" ] || { echo "no $dir/video"; exit 1; }
status=0
for clip in "$dir"/video/*.webm; do
  [ -e "$clip" ] || { echo "no clips"; exit 1; }
  name=$(basename "$clip" .webm)
  actions=$(cat "$dir/video/$name.actions" 2>/dev/null || echo 0)
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")
  # webm from Playwright often carries no container duration; count frames instead.
  case "$dur" in ''|N/A) dur=$(ffprobe -v error -count_packets -select_streams v:0 -show_entries stream=nb_read_packets,r_frame_rate -of csv=p=0 "$clip" | awk -F, '{split($1,r,"/"); printf "%.2f", $2/(r[1]/r[2])}') ;; esac
  longest=$(ffmpeg -hide_banner -nostats -i "$clip" -vf "freezedetect=n=0.001:d=$MAX_FREEZE_SEC" -map 0:v -f null - 2>&1 \
    | awk '/freeze_duration/ {print $NF}' | sort -rn | head -1)
  verdict=PASS
  if [ "$actions" -gt 0 ] && awk -v d="$dur" -v a="$actions" -v m="$MIN_SEC_PER_ACTION" 'BEGIN{exit !(d/a < m)}'; then
    verdict="FAIL (under ${MIN_SEC_PER_ACTION}s per action)"
  fi
  if [ -n "$longest" ]; then
    verdict="FAIL (frozen ${longest}s, limit ${MAX_FREEZE_SEC}s)"
  fi
  echo "$name: ${dur}s for $actions actions, $(awk -v d="$dur" -v a="$actions" 'BEGIN{ if (a>0) printf "%.1f", d/a; else print "n/a" }')s/action, $verdict"
  case "$verdict" in PASS) ;; *) status=1 ;; esac
done
exit $status
