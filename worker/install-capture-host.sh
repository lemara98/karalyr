#!/usr/bin/env bash
# Register worker/capture_host.py as a Chrome native messaging host.
#
# Chrome only starts a native host that is named in a manifest under its own
# config directory, and that manifest has to list the exact extension ID
# allowed to connect. The ID is generated when you load the unpacked extension,
# so this cannot be committed pre-filled — run this after loading it.
#
# Usage: worker/install-capture-host.sh <extension-id> [--browser chrome|chromium|brave]

set -euo pipefail

HOST_NAME="com.karalyr.capture_host"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$SCRIPT_DIR/capture_host.py"

EXT_ID="${1:-}"
BROWSER="chrome"
if [[ "${2:-}" == "--browser" && -n "${3:-}" ]]; then BROWSER="$3"; fi

if [[ -z "$EXT_ID" ]]; then
  cat >&2 <<'USAGE'
Usage: worker/install-capture-host.sh <extension-id> [--browser chrome|chromium|brave]

Find the extension ID at chrome://extensions with Developer mode on, after
"Load unpacked" on the capture-extension/ directory.
USAGE
  exit 1
fi

case "$BROWSER" in
  chrome)   TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
  chromium) TARGET_DIR="$HOME/.config/chromium/NativeMessagingHosts" ;;
  brave)    TARGET_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
  *) echo "Unknown browser: $BROWSER" >&2; exit 1 ;;
esac

if [[ ! -f "$HOST_PATH" ]]; then
  echo "capture_host.py not found at $HOST_PATH" >&2
  exit 1
fi
chmod +x "$HOST_PATH"

mkdir -p "$TARGET_DIR"
cat > "$TARGET_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Karalyr capture host — aligns captured tab audio locally",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "Installed $TARGET_DIR/$HOST_NAME.json"
echo "  host:      $HOST_PATH"
echo "  extension: $EXT_ID"
echo
if [[ -f "$HOME/.config/karalyr-worker.env" ]]; then
  echo "Found ~/.config/karalyr-worker.env — the host will read KARALYR_URL and WORKER_TOKEN from it."
else
  echo "NOTE: ~/.config/karalyr-worker.env is missing. Create it with:"
  echo "  KARALYR_URL=http://localhost:3000"
  echo "  WORKER_TOKEN=<the same value as the server's>"
fi
echo "Restart the browser so it picks up the manifest."
