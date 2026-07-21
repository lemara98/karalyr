# Karalyr capture worker

An operator-only Chrome extension that turns a promoted queue request into
word-timed lyrics **without downloading anything**. It plays the song in a tab,
records what comes out of your speakers, and hands that recording to the local
aligner.

This is not published and is not part of the Karafilt extension. It runs
unpacked, on your machine, and only when you click the button.

## Why it exists

The queue used to be fulfilled by `align.py --youtube`, which made yt-dlp fetch
the audio. That path is gone from `queue_worker.py`, so promoting a song in
`/admin` can never cause a download. This replaces it: the audio comes from
playback *you* started, and only the timings are ever kept.

Everything downstream is unchanged — same Demucs, same MMS forced alignment,
same `auto_aligned` revision.

## What happens on one run

```
you click "Align next song"
  → host claims the oldest queued job from Karalyr
  → extension opens the job's link in a tab and plays it from 0:00
  → tab audio is recorded (and still played, so you hear it)
  → playback ends → audio goes to the host over native messaging
  → align.py --audio: Demucs separates vocals, MMS aligns them to the lyrics
  → payload posted to /api/worker/jobs/<id>/complete
  → auto_aligned revision created, the request closes itself
```

Recording runs at **1× real time** — a 3-minute song takes 3 minutes to
capture, plus a few minutes for Demucs. That is a feature, not a limit to
engineer around.

## Setup

### 1. The aligner

You need the worker venv and the models from [`../worker/README.md`](../worker/README.md)
("One-time setup"): `ffmpeg`, `torch`/`torchaudio`, `demucs`, `ctc-forced-aligner`.
`yt-dlp` is **not** needed for this path.

Check it works:

```bash
worker/.venv/bin/python worker/align.py --help
```

### 2. Config file

The browser starts the host with an empty environment, so config has to live in
a file:

```bash
cat > ~/.config/karalyr-worker.env <<'EOF'
KARALYR_URL=http://localhost:3000
WORKER_TOKEN=dev-worker-token
EOF
chmod 600 ~/.config/karalyr-worker.env
```

`WORKER_TOKEN` must match the server's. In production point `KARALYR_URL` at
your real host and use a long random token.

### 3. Load the extension

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick this `capture-extension/` directory
3. Copy the **extension ID** it shows

### 4. Register the native host

Chrome only starts a host that is named in its own config directory *and*
whitelists the exact extension ID — which is why this can't be pre-filled:

```bash
worker/install-capture-host.sh <extension-id>
# Chromium or Brave:
worker/install-capture-host.sh <extension-id> --browser chromium
```

Then **restart the browser** so it reads the manifest.

## Using it

1. Someone requests a song (or you do, in the Studio) — it appears on `/queue`
2. In `/admin` → **Wanted songs**, click **Promote to queue** on a song you have
   a lawful way to hear
3. Click the extension icon → **Align next song**
4. A tab opens and plays. Leave it alone; the popup can be closed, the run
   continues in the service worker.
5. When it finishes the log shows the revision number, and the song drops off
   `/queue` automatically

Only ever promote one song at a time, and stay at the machine while it runs.
Turning this into an unattended daemon that grinds through the whole queue is
exactly the automated-extraction pattern the design is avoiding.

## If you already own the file

Skip the extension entirely — this is the simplest path and needs no setup
beyond the venv:

```bash
# claim the oldest queued job and align it from your own audio
KARALYR_URL=http://localhost:3000 WORKER_TOKEN=dev-worker-token \
  worker/.venv/bin/python worker/queue_worker.py --audio ~/Music/song.mp3
```

Or bypass the queue completely with `align.py --audio` plus
`scripts/import-aligned.ts`, as in [`../worker/README.md`](../worker/README.md).

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Native host disconnected" immediately | Manifest missing or wrong extension ID — rerun the install script and restart the browser |
| "KARALYR_URL/WORKER_TOKEN missing" | `~/.config/karalyr-worker.env` absent or unreadable |
| Karalyr rejected WORKER_TOKEN (401) | Token doesn't match the server's `WORKER_TOKEN` |
| "Nothing queued" | Nothing is in `queued` — promote something in `/admin` first |
| Recording is silent | The tab was muted, or another extension grabbed the capture first |
| Aligner reports a word-count mismatch | Characters the aligner can't romanize; check the request's lyrics |

Host-side detail goes to stderr, which Chrome collects — start the browser from
a terminal to watch it:

```bash
google-chrome 2>&1 | grep capture-host
```

## State of this code

The pieces verified so far: the native messaging framing, config loading, an
authenticated claim against a running Karalyr returning a real job with its
lyrics, and `abandon` releasing the job back to `queued`.

**Not yet exercised end to end**: the browser half — `tabCapture`, the
offscreen recorder, playback detection, and a full alignment of captured audio.
That needs a real browser session with the models installed, so expect to shake
out rough edges on the first song. The most likely spots are player quirks in
`playFromStart` (sites other than YouTube) and end-of-playback detection on
pages that autoplay the next track.
