#!/usr/bin/env bash
# Backfill a chord chart for an EXISTING karalyr track, in one command:
#
#   worker/chords-backfill.sh "https://youtu.be/dQw4w9WgXcQ"
#
# Downloads the audio with yt-dlp, runs worker/analyze_chords.py on it, and
# uploads the chart to the track that owns that video (identity resolved
# server-side, same as /api/get). Extra args pass straight through to
# analyze_chords.py:
#
#   # spot-check only, no upload
#   worker/chords-backfill.sh "<url>" --print
#   # override identity when the video is not linked to the track
#   worker/chords-backfill.sh "<url>" --track-id 51
#
# Credentials come from ~/.config/karalyr-worker.env (KARALYR_URL,
# WORKER_TOKEN) - the same file the queue worker and backup timer use.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $(basename "$0") <video-url> [analyze_chords.py args...]" >&2
  exit 2
fi

url="$1"; shift

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/.venv/bin"

env_file="$HOME/.config/karalyr-worker.env"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
fi

# --print with no upload identity must stay offline; only add the video-url
# identity when the caller didn't pick one themselves and isn't spot-checking.
identity=(--video-url "$url")
for arg in "$@"; do
  case "$arg" in
    --track-id|--video-key|--video-url|--print) identity=() ;;
  esac
done

tmp="$(mktemp -d --tmpdir chords-backfill-XXXXXX)"
trap 'rm -rf "$tmp"' EXIT

echo "[backfill] downloading audio..."
"$venv/yt-dlp" -x --audio-format mp3 -o "$tmp/audio.%(ext)s" --no-playlist "$url"

"$venv/python" "$here/analyze_chords.py" --audio "$tmp/audio.mp3" "${identity[@]}" "$@"
