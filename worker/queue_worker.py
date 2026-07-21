#!/usr/bin/env python3
"""Karalyr queue worker: align a queued word-sync job from audio you supply.

Claims one job from the hosted app, runs the offline aligner (worker/align.py)
against an audio file YOU point it at, and posts the resulting payload back.
Stdlib only, Python 3.10+.

This worker does not fetch audio. It used to pass --youtube to the aligner,
which made yt-dlp download the track; that path is gone, so promoting a song
in /admin can never cause a download. Get the audio one of two ways:

  * you already own the file    -> this script, with --audio
  * capture it while it plays   -> capture-extension/ + worker/capture_host.py

Environment:
  KARALYR_URL          base URL of the karalyr app, no trailing slash (required)
  WORKER_TOKEN         shared bearer token, must match the server (required)
  WORKER_ID            name reported to the server (default: hostname)
  LEASE_SECONDS        job lease requested on claim/heartbeat (default 2700)
  HEARTBEAT_SECONDS    heartbeat interval while a job runs (default 300)
  JOB_TIMEOUT_SECONDS  kill the aligner after this long (default 2400)
  PYTHON_BIN           python that runs the aligner (default worker/.venv/bin/python)
  ALIGN_SCRIPT         aligner script path (default worker/align.py)

Usage:
  queue_worker.py --audio PATH   claim the oldest queued job and align it from
                                 PATH. Promote exactly the song you have audio
                                 for, then run this. Exits 0 when there was
                                 nothing queued, 1 if the server was unreachable.
"""

import argparse
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import deque

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
KARALYR_URL = os.environ.get("KARALYR_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID") or socket.gethostname()
LEASE_SECONDS = int(os.environ.get("LEASE_SECONDS") or 2700)
HEARTBEAT_SECONDS = int(os.environ.get("HEARTBEAT_SECONDS") or 300)
JOB_TIMEOUT_SECONDS = int(os.environ.get("JOB_TIMEOUT_SECONDS") or 2400)
PYTHON_BIN = os.environ.get("PYTHON_BIN") or str(SCRIPT_DIR / ".venv" / "bin" / "python")
ALIGN_SCRIPT = os.environ.get("ALIGN_SCRIPT") or str(SCRIPT_DIR / "align.py")
HTTP_TIMEOUT = 15
TAIL_LINES = 40

# Aligner errors that retrying can never fix (case-insensitive substrings).
PERMANENT_MARKERS = (
    "aligner returned",
    "no lyric lines",
    "video unavailable",
    "private video",
    "sign in to confirm your age",
    "age-restricted",
    "copyright",
    "account associated with this video has been terminated",
)
NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ConnectionError)

SHUTDOWN = threading.Event()
CURRENT_CHILD = None


def log(msg):
    print(f"[worker] {msg}", flush=True)


def api_post(path, body):
    """POST JSON; returns (status, parsed_body_or_None).

    HTTP error statuses are returned, not raised; network trouble raises
    URLError/TimeoutError for the caller to back off on.
    """
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
    # Karalyr error bodies are apiError-shaped: {code: <int>, name, message}.
    if isinstance(data, dict):
        if data.get("message"):
            name = data.get("name")
            return f"{name}: {data['message']}" if name else str(data["message"])
        if data.get("error"):  # api_post's non-JSON fallback
            return str(data["error"])
    return str(data) if data else fallback


def post_fail(job_id, error, permanent):
    status, _ = api_post(
        f"/api/worker/jobs/{job_id}/fail",
        {"worker_id": WORKER_ID, "error": str(error)[:2000], "permanent": permanent},
    )
    if status == 409:
        log(f"job #{job_id}: lease lost while reporting failure — abandoning")
    else:
        log(f"job #{job_id}: reported failure (permanent={permanent})")


def heartbeat_loop(job_id, stop):
    failures = 0
    while not stop.wait(HEARTBEAT_SECONDS):
        try:
            status, _ = api_post(
                f"/api/worker/jobs/{job_id}/heartbeat",
                {"worker_id": WORKER_ID, "lease_seconds": LEASE_SECONDS},
            )
        except NETWORK_ERRORS as err:
            failures += 1
            log(f"job #{job_id}: heartbeat failed ({failures}/3): {err}")
            if failures >= 3:
                log(f"job #{job_id}: heartbeats keep failing — stopping the run")
                stop.set()
            continue
        failures = 0
        if status == 409:
            log(f"job #{job_id}: lease lost (heartbeat 409) — stopping the run")
            stop.set()
        elif status != 200:
            log(f"job #{job_id}: unexpected heartbeat status {status}")


def kill_child(proc):
    # Kill the whole process group: align.py spawns demucs/yt-dlp children
    # that inherit the stdout pipe — killing only the direct child would leave
    # them running and keep the read loop blocked past EOF.
    try:
        os.killpg(proc.pid, signal.SIGKILL)
        return
    except (ProcessLookupError, PermissionError, OSError):
        pass
    try:
        proc.kill()
    except OSError:
        pass


def watch_child(proc, stop, deadline, timed_out):
    while proc.poll() is None:
        if stop.is_set() or SHUTDOWN.is_set():
            kill_child(proc)
            return
        if time.monotonic() >= deadline:
            timed_out.set()
            kill_child(proc)
            return
        time.sleep(1)


def run_job(job, audio_path):
    global CURRENT_CHILD
    job_id = job["id"]
    stop = threading.Event()
    timed_out = threading.Event()
    with tempfile.TemporaryDirectory(prefix="karalyr-queue-") as tmp:
        tmpdir = pathlib.Path(tmp)
        lyrics_path = tmpdir / "lyrics.txt"
        out_path = tmpdir / "payload.json"
        lyrics_path.write_text(job.get("plain_lyrics") or "", encoding="utf-8")

        threading.Thread(target=heartbeat_loop, args=(job_id, stop), daemon=True).start()
        try:
            try:
                proc = subprocess.Popen(
                    [PYTHON_BIN, ALIGN_SCRIPT, "--audio", str(audio_path),
                     "--lyrics", str(lyrics_path), "--out", str(out_path)],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                    start_new_session=True,  # own group so kill_child reaps demucs too
                )
            except OSError as err:
                post_fail(job_id, f"could not start the aligner ({PYTHON_BIN}): {err}", False)
                return

            CURRENT_CHILD = proc
            deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
            threading.Thread(
                target=watch_child, args=(proc, stop, deadline, timed_out), daemon=True
            ).start()

            tail = deque(maxlen=TAIL_LINES)
            try:
                for raw in proc.stdout:
                    line = raw.strip()
                    if not line or "%|" in line:
                        continue  # drop blanks and tqdm progress spam
                    tail.append(line)
                    print(f"[job {job_id}] {line}", flush=True)
                code = proc.wait()
            finally:
                CURRENT_CHILD = None

            if stop.is_set() or SHUTDOWN.is_set():
                log(f"job #{job_id}: run stopped (lease lost or shutting down) — abandoning")
                return
            if timed_out.is_set():
                log(f"job #{job_id}: timed out — killed the aligner")
                post_fail(job_id, f"job timed out after {JOB_TIMEOUT_SECONDS}s", False)
                return
            if code != 0:
                error = "\n".join(tail) or f"aligner exited with code {code}"
                lowered = error.lower()
                post_fail(job_id, error, any(m in lowered for m in PERMANENT_MARKERS))
                return

            try:
                payload = json.loads(out_path.read_text(encoding="utf-8"))
                meta_path = out_path.with_suffix(".meta.json")
                meta = (
                    json.loads(meta_path.read_text(encoding="utf-8"))
                    if meta_path.exists() else None
                )
            except (OSError, ValueError) as err:
                post_fail(job_id, f"aligner exited 0 but payload is unreadable: {err}", False)
                return

            # Meta is best-effort (the job's intake fields win server-side).
            # align.py can leave placeholder strings in the sidecar (e.g.
            # duration "SECONDS" when yt-dlp reports none) — drop anything
            # that isn't a real value rather than risk a 400 on /complete.
            body = {"worker_id": WORKER_ID, "payload": payload}
            if isinstance(meta, dict):
                dur = meta.get("duration")
                if not isinstance(dur, (int, float)) or isinstance(dur, bool) or dur <= 0:
                    meta.pop("duration", None)
                for key in ("artist", "title"):
                    if not isinstance(meta.get(key), str) or not meta.get(key):
                        meta.pop(key, None)
                body["meta"] = meta

            status, data = api_post(f"/api/worker/jobs/{job_id}/complete", body)
            if status == 200 and isinstance(data, dict):
                log(
                    f"job #{job_id}: complete — revision #{data.get('revision_id')} "
                    f"on track #{data.get('track_id')} ({data.get('revision_status')})"
                )
            elif status == 400:
                err = error_text(data, "server rejected the payload")
                log(f"job #{job_id}: payload rejected: {err}")
                post_fail(job_id, err, True)
            elif status == 409:
                log(f"job #{job_id}: lease lost before completion — abandoning")
            else:
                log(f"job #{job_id}: unexpected /complete status {status}")
        finally:
            stop.set()


def handle_signal(signum, _frame):
    log(f"received {signal.Signals(signum).name} — shutting down")
    SHUTDOWN.set()
    proc = CURRENT_CHILD
    if proc is not None:
        kill_child(proc)


def main():
    ap = argparse.ArgumentParser(
        description="Karalyr worker: claim the oldest queued job and align it from your audio"
    )
    ap.add_argument(
        "--audio",
        type=pathlib.Path,
        required=True,
        help="audio file you possess for the song you promoted",
    )
    args = ap.parse_args()

    if not KARALYR_URL:
        sys.exit("[worker] KARALYR_URL is required (e.g. https://karalyr.example.com)")
    if not WORKER_TOKEN:
        sys.exit("[worker] WORKER_TOKEN is required")
    if not args.audio.exists():
        sys.exit(f"[worker] audio file not found: {args.audio}")

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    log(f"worker '{WORKER_ID}' claiming one job from {KARALYR_URL}")

    try:
        status, data = api_post(
            "/api/worker/claim",
            {"worker_id": WORKER_ID, "lease_seconds": LEASE_SECONDS},
        )
    except NETWORK_ERRORS as err:
        log(f"claim failed (server unreachable?): {err}")
        sys.exit(1)

    if status == 401:
        log("server rejected WORKER_TOKEN (401) — fix the env file")
        sys.exit(1)
    if status not in (200, 204):
        log(f"unexpected /claim status {status}")
        sys.exit(1)
    if status == 204 or not isinstance(data, dict) or not data.get("job"):
        log("nothing queued — promote a song in /admin first")
        return

    job = data["job"]
    log(
        f"claimed job #{job['id']}: {job.get('artist_name')} — {job.get('track_name')} "
        f"(attempt {job.get('attempts')}/{job.get('max_attempts')})"
    )
    log(f"aligning from {args.audio}")
    try:
        run_job(job, args.audio)
    except NETWORK_ERRORS as err:
        log(f"network error while reporting job #{job['id']}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
