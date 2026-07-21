# Karalyr offline aligner

Turn **an audio file you own + plain lyrics** into word-timed karaoke lyrics
with real forced alignment (Demucs vocal separation + torchaudio MMS CTC
alignment). Runs entirely on this machine, CPU-only is fine; the audio never
leaves your computer and separated stems are deleted after each run.

## One-time setup

```bash
sudo apt install -y ffmpeg          # audio decoding for demucs
python3 -m venv worker/.venv
worker/.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
worker/.venv/bin/pip install demucs ctc-forced-aligner
```

The first alignment run downloads the MMS forced-alignment model (~1.2 GB,
cached by torchaudio) and the Demucs model (~80 MB).

## Aligning a song

1. Get the song as a local audio file you legitimately possess (bought MP3,
   Bandcamp download, CD rip, your own recording).
2. Save the lyrics as plain text, one sung line per row (an .lrc also works —
   timestamps are ignored, only text is used).
3. Run:

```bash
worker/.venv/bin/python worker/align.py \
  --audio ~/Music/song.mp3 \
  --lyrics ~/Music/song-lyrics.txt \
  --out /tmp/payload.json
```

Expect a few minutes on CPU (Demucs dominates; ~1-2x song length on a
laptop). Then import the result into Karalyr as an `auto_aligned` revision:

```bash
npx tsx scripts/import-aligned.ts \
  --artist "Artist" --track "Title" --duration 174 \
  --payload /tmp/payload.json
```

Open the printed track URL and press Play — word-level karaoke sweep from
true forced alignment. The revision enters at the `auto_aligned` tier, so
community submissions and signals still outrank/refine it as usual.

Non-Latin/diacritic lyrics (č, ž, đ, ...) are transliterated internally for
the aligner; the stored payload keeps the original spelling.

## Fulfilling a queue request

Requests on `/queue` are demand only — nothing is worked on until you promote a
song in `/admin`. **Nothing here downloads audio**: `queue_worker.py` used to
pass `--youtube` to the aligner and no longer does, so promoting a song can
never trigger a fetch. Two ways to supply the audio.

### You already own the file

```bash
KARALYR_URL=https://karalyr.example.com WORKER_TOKEN=the-shared-secret \
  worker/.venv/bin/python worker/queue_worker.py --audio ~/Music/song.mp3
```

Claims the oldest queued job and aligns it from that file, streaming the
`[align]` log and finishing with `complete — revision #...`. Exits 0 when
nothing was queued, 1 if the server was unreachable. Promote exactly the song
you have audio for — the claim takes whatever is oldest.

Config can live in an env file instead of the command line:

```bash
# ~/.config/karalyr-worker.env
KARALYR_URL=https://karalyr.example.com
WORKER_TOKEN=the-shared-secret-from-the-server
```

Tunables (env vars, defaults in the `queue_worker.py` docstring): `WORKER_ID`
(hostname), `LEASE_SECONDS` (2700), `HEARTBEAT_SECONDS` (300),
`JOB_TIMEOUT_SECONDS` (2400). For testing without burning CPU, `PYTHON_BIN` and
`ALIGN_SCRIPT` point it at any stub honouring `--audio <path> --lyrics <path>
--out <path>` that writes a canned payload.

### Capture it while it plays

For a song you have no file for, [`../capture-extension/`](../capture-extension/README.md)
records it from your own playback and feeds `align.py --audio` via
`worker/capture_host.py` — same aligner, same result, no download. That README
covers the whole setup.

### The systemd unit

`worker/karalyr-worker.service` predates both paths and assumed an unattended
polling daemon. Fulfilment is operator-driven by design now — you decide per
song — so there is nothing to run continuously. The unit is kept for reference
only.

## Notes

- `--youtube <url>` (instead of `--audio`) fetches the audio via yt-dlp into
  the run's temp dir and deletes it afterwards, and pre-fills artist/title/
  duration in the printed import command. **Personal-use, local-machine flag
  only**: downloading from YouTube violates YouTube's ToS — never expose this
  in a hosted flow. Requires ffmpeg.
- `--no-demucs` skips vocal separation (only for a cappella/vocals-only audio).
- Quality: on clean vocal stems, word timings typically land within
  ±50–150 ms — noticeably tighter than the extension's listen-along
  energy-onset estimates. Both feed the same revision system.
- Legal posture: processing audio you possess, locally, publishing only
  timing metadata. Where the audio came from is on you — see the project
  README's deployment/legal notes.
