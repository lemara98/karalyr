#!/usr/bin/env python3
"""Standalone chord analysis: the backfill tool and the spot-check harness.

Runs worker/chords.py on an audio file YOU supply and either writes/prints the
chart (offline - this is how the model gets spot-checked against your ear) or
uploads it to an EXISTING track via POST /api/worker/chords. Tracks only ever
enter the database through an alignment, so an unknown identity here is an
error, not a create.

Environment (upload mode only, same as queue_worker.py):
  KARALYR_URL    base URL of the karalyr app, no trailing slash
  WORKER_TOKEN   shared bearer token, must match the server
  WORKER_ID      name reported to the server (default: hostname)

Usage:
  # spot-check: eyeball the chart against a trusted source
  analyze_chords.py --audio song.mp3 --print

  # keep the chart for later
  analyze_chords.py --audio song.mp3 --out chart.json

  # backfill an existing track (identity resolved like /api/get)
  analyze_chords.py --audio song.mp3 --video-key yt:dQw4w9WgXcQ
  analyze_chords.py --audio song.mp3 --video-url "https://youtu.be/dQw4w9WgXcQ"
  analyze_chords.py --audio song.mp3 --track-id 42
"""

import argparse
import json
import os
import pathlib
import socket
import sys
import time
import urllib.error
import urllib.request

from chords import analyze

KARALYR_URL = os.environ.get("KARALYR_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID") or socket.gethostname()
HTTP_TIMEOUT = 15

_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
_FLAT_MAJOR_TONICS = {1, 3, 5, 8, 10}  # Db Eb F Ab Bb — the flat-side keys


def api_post(path, body):
    req = urllib.request.Request(
        KARALYR_URL + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {WORKER_TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            data = json.loads(raw) if raw.strip() else None
        except ValueError:
            data = {"error": raw.decode("utf-8", "replace")[:500]}
        return err.code, data


def error_text(data, fallback):
    if isinstance(data, dict):
        if data.get("message"):
            name = data.get("name")
            return f"{name}: {data['message']}" if name else str(data["message"])
        if data.get("error"):
            return str(data["error"])
    return str(data) if data else fallback


def _key_uses_flats(meta):
    """Same circle-of-fifths rule the whole family uses - Bb in F major,
    never A#. Matters here of all places: this printout gets compared against
    trusted charts, which always write the flat spelling."""
    pc = meta.get("key_pc")
    if pc is None:
        return False
    major_pc = (pc + 3) % 12 if meta.get("key_mode") == "min" else pc
    return major_pc in _FLAT_MAJOR_TONICS


def display_symbol(seg, use_flats=False):
    """The symbol a client renders: root + m? + ext + /bass."""
    names = _FLAT if use_flats else _SHARP
    sym = names[seg["root_pc"]] + ("m" if seg["quality"] == 1 else "") + seg.get("ext", "")
    if "bass_pc" in seg:
        sym += "/" + names[seg["bass_pc"]]
    return sym


def print_chart(chart):
    meta = chart["meta"]
    use_flats = _key_uses_flats(meta)
    names = _FLAT if use_flats else _SHARP
    key = (
        f"{names[meta['key_pc']]} {meta['key_mode']}"
        if meta.get("key_pc") is not None else "unknown key"
    )
    print(f"# {meta['model']} ({meta['dict']}) - {key}, "
          f"{len(chart['segments'])} segments, {meta['duration_ms'] / 1000:.0f}s")
    for seg in chart["segments"]:
        t = seg["start_ms"] / 1000
        flag = "" if seg["confidence"] >= 0.5 else "   (low confidence)"
        print(f"{int(t // 60):02d}:{t % 60:05.2f}  {display_symbol(seg, use_flats):10s} "
              f"{seg['confidence']:.2f}{flag}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--audio", type=pathlib.Path, required=True,
                    help="audio file you own for this song")
    ap.add_argument("--backend", help="chord backend (see worker/chords.py BACKENDS)")
    ap.add_argument("--out", type=pathlib.Path, help="write the chart JSON here")
    ap.add_argument("--print", dest="print_chart", action="store_true",
                    help="print a human-readable chart to stdout")
    ident = ap.add_mutually_exclusive_group()
    ident.add_argument("--video-key", help='canonical key, e.g. "yt:dQw4w9WgXcQ"')
    ident.add_argument("--video-url", help="video URL (any form deriveVideoKey accepts)")
    ident.add_argument("--track-id", type=int, help="karalyr track id")
    args = ap.parse_args()

    if not args.audio.exists():
        sys.exit(f"[chords] audio file not found: {args.audio}")
    uploading = args.video_key or args.video_url or args.track_id
    if not (uploading or args.out or args.print_chart):
        sys.exit("[chords] nothing to do: pass --out/--print or an upload identity")
    if uploading:
        if not KARALYR_URL:
            sys.exit("[chords] KARALYR_URL is required to upload")
        if not WORKER_TOKEN:
            sys.exit("[chords] WORKER_TOKEN is required to upload")

    started = time.monotonic()
    print(f"[chords] analyzing {args.audio.name} ...")
    chart = analyze(args.audio, backend=args.backend)
    print(f"[chords] {len(chart['segments'])} segments in {time.monotonic() - started:.1f}s")

    if args.print_chart:
        print_chart(chart)
    if args.out:
        args.out.write_text(json.dumps(chart, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[chords] wrote {args.out}")

    if not uploading:
        return

    body = {"worker_id": WORKER_ID, "payload": chart}
    if args.track_id:
        body["track_id"] = args.track_id
    else:
        # The server derives the canonical key from either form.
        body["video_key"] = args.video_key or args.video_url

    try:
        status, data = api_post("/api/worker/chords", body)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
        sys.exit(f"[chords] upload failed (server unreachable?): {err}")

    if status == 200 and isinstance(data, dict):
        dedup = " (identical chart already stored)" if data.get("deduped") else ""
        print(f"[chords] uploaded: chart #{data.get('chart_id')} "
              f"on track #{data.get('track_id')}{dedup}")
    else:
        sys.exit(f"[chords] upload rejected ({status}): "
                 f"{error_text(data, 'no error body')}")


if __name__ == "__main__":
    main()
