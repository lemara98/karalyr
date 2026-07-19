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

## Queue worker daemon

`worker/queue_worker.py` turns this machine into a pull-worker for the hosted
word-sync queue: it polls the karalyr app over HTTPS, claims one job at a
time, runs `align.py` on it, and posts the resulting payload back. The daemon
itself is pure Python stdlib — the venv from the one-time setup above (plus
`yt-dlp`) is all it needs. `worker/requirements.txt` mirrors those setup
commands if you prefer `pip install -r` (torch/torchaudio still come from the
CPU wheel index — see the comment in that file).

Config lives in an env file:

```bash
# ~/.config/karalyr-worker.env
KARALYR_URL=https://karalyr.example.com
WORKER_TOKEN=the-shared-secret-from-the-server
```

Install as a user systemd unit so it survives reboots and needs no login
session:

```bash
cp worker/karalyr-worker.service ~/.config/systemd/user/
# edit the copy if this repo doesn't live at
# /home/milanknezevic/Desktop/karaoke/karalyr — ExecStart wants absolute
# paths to the venv python and queue_worker.py
systemctl --user daemon-reload
systemctl --user enable --now karalyr-worker
loginctl enable-linger $USER   # keep it running after you log out
```

Follow the logs:

```bash
journalctl --user -u karalyr-worker -f
```

Tunables (env vars, defaults in the `queue_worker.py` docstring): `WORKER_ID`
(hostname), `POLL_SECONDS` (30), `LEASE_SECONDS` (2700), `HEARTBEAT_SECONDS`
(300), `JOB_TIMEOUT_SECONDS` (2400). For testing without burning 10 minutes
of CPU per run, `PYTHON_BIN` and `ALIGN_SCRIPT` point the daemon at any stub
that honors align.py's CLI (`--youtube <url> --lyrics <path> --out <path>`)
and writes a canned payload.

### Manual E2E checklist

1. Run karalyr locally with the worker token set:
   `WORKER_TOKEN=devsecret npm run dev`.
2. Enqueue a word-sync job (request word sync on a track, or insert a queue
   row directly).
3. Run one worker cycle against the dev server:

   ```bash
   KARALYR_URL=http://localhost:3000 WORKER_TOKEN=devsecret \
     python3 worker/queue_worker.py --once
   ```

4. Watch it claim the job, stream the `[align]` log (tqdm progress spam is
   filtered out), and finish with `complete — revision #...`.
5. Open the track page: the lyrics play back word-synced (an `auto_aligned`
   revision, same tier as a local import).

`--once` exits 0 whether or not a job was waiting, and 1 if the server was
unreachable — cron-friendly if you'd rather not run the daemon.

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
