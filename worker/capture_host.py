#!/usr/bin/env python3
"""Karalyr capture host: native messaging bridge between Chrome and align.py.

Chrome starts this process when the capture extension connects to it. The
extension plays a song in a tab and records what comes out of the speakers;
this host takes that recording, aligns it against the job's lyrics, and reports
the result to Karalyr.

Nothing here downloads anything. The audio arrives from playback the operator
started, which is why this exists at all — see capture-extension/README.md.

Protocol (Chrome <-> host, 4-byte little-endian length prefix + UTF-8 JSON):

  ->  {"type": "claim"}
  <-  {"type": "job", "job": {...}} | {"type": "none"}
  ->  {"type": "audio_start", "job_id": 12, "mime": "audio/webm"}
  ->  {"type": "audio_chunk", "data": "<base64>"}            (repeated)
  ->  {"type": "audio_end"}
  <-  {"type": "log", "line": "..."}                          (many)
  <-  {"type": "done", "track_id": 3, "revision_id": 9} | {"type": "error", "message": "..."}
  ->  {"type": "abandon"}      release the claim without aligning

stdout carries the protocol, so every human-readable message goes to stderr.
Config comes from the same env file as queue_worker.py; see WORKER_ENV below.

Stdlib only, Python 3.10+.
"""

import base64
import json
import os
import pathlib
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
# Chrome starts this process with a bare environment, so the env file is the
# only reliable place to read config from.
WORKER_ENV = pathlib.Path(
    os.environ.get("KARALYR_WORKER_ENV")
    or (pathlib.Path.home() / ".config" / "karalyr-worker.env")
)

HTTP_TIMEOUT = 15
LEASE_SECONDS = 2700
HEARTBEAT_SECONDS = 300
JOB_TIMEOUT_SECONDS = 2400
MAX_AUDIO_BYTES = 512 * 1024 * 1024  # a long song at Opus bitrates is ~30 MB


def err_log(msg):
    print(f"[capture-host] {msg}", file=sys.stderr, flush=True)


def load_env():
    """KEY=VALUE lines from the worker env file, without clobbering real env vars."""
    if not WORKER_ENV.exists():
        return
    for raw in WORKER_ENV.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()
KARALYR_URL = os.environ.get("KARALYR_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID") or "chrome-capture"
PYTHON_BIN = os.environ.get("PYTHON_BIN") or str(SCRIPT_DIR / ".venv" / "bin" / "python")
ALIGN_SCRIPT = os.environ.get("ALIGN_SCRIPT") or str(SCRIPT_DIR / "align.py")


# ---------------------------------------------------------------- native messaging

def read_message():
    """Next message from Chrome, or None at EOF (the port closed)."""
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    raw = sys.stdin.buffer.read(length)
    if len(raw) < length:
        return None
    return json.loads(raw.decode("utf-8"))


_write_lock = threading.Lock()


def send(message):
    """Chrome caps a host->extension message at 1 MB; ours are all small."""
    data = json.dumps(message).encode("utf-8")
    with _write_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def send_log(line):
    send({"type": "log", "line": str(line)[:500]})


# ---------------------------------------------------------------- karalyr api

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
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw.strip() else None
        except ValueError:
            return e.code, {"message": raw.decode("utf-8", "replace")[:500]}


def heartbeat_loop(job_id, stop):
    """Hold the lease while Demucs and the aligner grind away."""
    while not stop.wait(HEARTBEAT_SECONDS):
        try:
            status, _ = api_post(
                f"/api/worker/jobs/{job_id}/heartbeat",
                {"worker_id": WORKER_ID, "lease_seconds": LEASE_SECONDS},
            )
            if status == 409:
                err_log(f"job #{job_id}: lease lost")
                stop.set()
                return
        except Exception as e:  # network blips shouldn't kill the run
            err_log(f"heartbeat failed: {e}")


def post_fail(job_id, message, permanent):
    try:
        api_post(
            f"/api/worker/jobs/{job_id}/fail",
            {"worker_id": WORKER_ID, "error": str(message)[:2000], "permanent": permanent},
        )
    except Exception as e:
        err_log(f"could not report failure: {e}")


# ---------------------------------------------------------------- alignment

def align_and_report(job, audio_path):
    """Run align.py on the captured audio and post the payload back."""
    job_id = job["id"]
    stop = threading.Event()
    threading.Thread(target=heartbeat_loop, args=(job_id, stop), daemon=True).start()

    try:
        with tempfile.TemporaryDirectory(prefix="karalyr-capture-") as tmp:
            tmpdir = pathlib.Path(tmp)
            lyrics_path = tmpdir / "lyrics.txt"
            out_path = tmpdir / "payload.json"
            lyrics_path.write_text(job.get("plain_lyrics") or "", encoding="utf-8")

            send_log("starting the aligner (Demucs first — this is the slow part)")
            proc = subprocess.Popen(
                [PYTHON_BIN, ALIGN_SCRIPT, "--audio", str(audio_path),
                 "--lyrics", str(lyrics_path), "--out", str(out_path)],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                start_new_session=True,  # own group, so killing reaps demucs too
            )

            deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
            tail = []
            for raw in proc.stdout:
                line = raw.strip()
                if not line or "%|" in line:  # drop tqdm progress spam
                    continue
                tail.append(line)
                del tail[:-40]
                send_log(line)
                if time.monotonic() > deadline:
                    proc.kill()
                    post_fail(job_id, f"aligner timed out after {JOB_TIMEOUT_SECONDS}s", False)
                    return {"type": "error", "message": "aligner timed out"}
            code = proc.wait()

            if code != 0:
                message = "\n".join(tail[-10:]) or f"aligner exited {code}"
                post_fail(job_id, message, False)
                return {"type": "error", "message": message}

            try:
                payload = json.loads(out_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                post_fail(job_id, f"aligner exited 0 but payload is unreadable: {e}", False)
                return {"type": "error", "message": "unreadable payload"}

            send_log("posting the result to Karalyr")
            status, data = api_post(
                f"/api/worker/jobs/{job_id}/complete",
                {"worker_id": WORKER_ID, "payload": payload},
            )
            if status == 200 and isinstance(data, dict):
                return {
                    "type": "done",
                    "track_id": data.get("track_id"),
                    "revision_id": data.get("revision_id"),
                    "revision_status": data.get("revision_status"),
                }
            message = (data or {}).get("message") or f"server returned {status}"
            if status == 400:  # the payload itself is bad; retrying won't help
                post_fail(job_id, message, True)
            return {"type": "error", "message": message}
    finally:
        stop.set()


# ---------------------------------------------------------------- main loop

def main():
    if not KARALYR_URL or not WORKER_TOKEN:
        send({"type": "error", "message": f"KARALYR_URL/WORKER_TOKEN missing — check {WORKER_ENV}"})
        return

    job = None
    audio_file = None
    audio_bytes = 0

    while True:
        message = read_message()
        if message is None:
            break
        kind = message.get("type")

        if kind == "claim":
            try:
                status, data = api_post(
                    "/api/worker/claim",
                    {"worker_id": WORKER_ID, "lease_seconds": LEASE_SECONDS},
                )
            except Exception as e:
                send({"type": "error", "message": f"could not reach Karalyr: {e}"})
                continue
            if status == 401:
                send({"type": "error", "message": "Karalyr rejected WORKER_TOKEN (401)"})
                continue
            if status == 204 or not isinstance(data, dict) or not data.get("job"):
                send({"type": "none"})
                continue
            job = data["job"]
            err_log(f"claimed job #{job['id']}")
            send({"type": "job", "job": job})

        elif kind == "audio_start":
            if not job:
                send({"type": "error", "message": "no job claimed"})
                continue
            audio_bytes = 0
            suffix = ".webm" if "webm" in (message.get("mime") or "") else ".ogg"
            audio_file = tempfile.NamedTemporaryFile(
                prefix="karalyr-capture-", suffix=suffix, delete=False
            )
            err_log(f"receiving audio -> {audio_file.name}")

        elif kind == "audio_chunk":
            if audio_file is None:
                continue
            chunk = base64.b64decode(message.get("data") or "")
            audio_bytes += len(chunk)
            if audio_bytes > MAX_AUDIO_BYTES:
                send({"type": "error", "message": "capture too large — aborting"})
                audio_file.close()
                os.unlink(audio_file.name)
                audio_file = None
                continue
            audio_file.write(chunk)

        elif kind == "audio_end":
            if audio_file is None or not job:
                send({"type": "error", "message": "no capture in progress"})
                continue
            audio_file.close()
            path = pathlib.Path(audio_file.name)
            audio_file = None
            send_log(f"captured {audio_bytes // 1024} KB of audio")
            try:
                result = align_and_report(job, path)
            except Exception as e:
                err_log(f"alignment crashed: {e}")
                post_fail(job["id"], f"capture host error: {e}", False)
                result = {"type": "error", "message": str(e)}
            finally:
                # The recording is the operator's own playback; it has served
                # its purpose the moment timings exist, so it never lingers.
                path.unlink(missing_ok=True)
            job = None
            send(result)

        elif kind == "abandon":
            if job:
                post_fail(job["id"], "operator abandoned the capture", False)
                job = None
            if audio_file is not None:
                audio_file.close()
                pathlib.Path(audio_file.name).unlink(missing_ok=True)
                audio_file = None
            send({"type": "abandoned"})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # never die silently; Chrome shows nothing
        err_log(f"fatal: {exc}")
        raise
