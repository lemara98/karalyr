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
