import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDb } from "./db/client";
import { findOrCreateTrack, insertRevision, linkTrackVideo } from "./db/queries";
import { validatePayload } from "./formats";
import { deriveVideoKey } from "./video-key";

/**
 * Local alignment jobs: the Studio's "AI align" tab spawns worker/align.py
 * (Demucs + MMS forced alignment) on THIS machine and imports the result as
 * an auto_aligned revision. Strictly a local/self-hosted feature:
 *  - gated by ENABLE_LOCAL_ALIGN=1 + the worker venv existing
 *  - one job at a time (it saturates a laptop CPU)
 *  - the downloaded audio/stems live in the worker's temp dir and are
 *    deleted when the run ends
 */

const PYTHON = path.join(process.cwd(), "worker", ".venv", "bin", "python");
const SCRIPT = path.join(process.cwd(), "worker", "align.py");
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_LINES = 400;

export interface AlignJobInput {
  youtubeUrl?: string;
  /** Local file path — dev/testing convenience, not exposed in the UI. */
  audioPath?: string;
  lyrics: string;
  artist?: string;
  track?: string;
  album?: string;
  duration?: number;
}

export interface AlignJob {
  id: string;
  status: "running" | "done" | "failed";
  log: string[];
  createdAt: number;
  result?: { trackId: number; revisionId: number };
  error?: string;
}

const globalForJobs = globalThis as unknown as { __karalyrAlignJobs?: Map<string, AlignJob> };

function jobs(): Map<string, AlignJob> {
  if (!globalForJobs.__karalyrAlignJobs) globalForJobs.__karalyrAlignJobs = new Map();
  return globalForJobs.__karalyrAlignJobs;
}

export function localAlignAvailable(): boolean {
  return process.env.ENABLE_LOCAL_ALIGN === "1" && existsSync(PYTHON) && existsSync(SCRIPT);
}

export function getAlignJob(id: string): AlignJob | undefined {
  return jobs().get(id);
}

export function runningAlignJob(): AlignJob | undefined {
  return [...jobs().values()].find((j) => j.status === "running");
}

export function startAlignJob(input: AlignJobInput): AlignJob {
  const job: AlignJob = { id: randomUUID(), status: "running", log: [], createdAt: Date.now() };
  jobs().set(job.id, job);

  const workdir = mkdtempSync(path.join(tmpdir(), "karalyr-align-ui-"));
  const lyricsPath = path.join(workdir, "lyrics.txt");
  const outPath = path.join(workdir, "payload.json");
  writeFileSync(lyricsPath, input.lyrics, "utf-8");

  const pushLog = (chunk: string) => {
    for (const raw of chunk.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.includes("%|")) continue; // drop tqdm progress spam
      job.log.push(line);
      if (job.log.length > MAX_LOG_LINES) job.log.shift();
    }
  };

  const sourceArgs = input.youtubeUrl
    ? ["--youtube", input.youtubeUrl]
    : ["--audio", input.audioPath!];
  const child = spawn(PYTHON, [SCRIPT, ...sourceArgs, "--lyrics", lyricsPath, "--out", outPath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => pushLog(String(d)));
  child.stderr.on("data", (d) => pushLog(String(d)));

  const timeout = setTimeout(() => {
    pushLog("[align] job timed out — killing");
    child.kill("SIGKILL");
  }, JOB_TIMEOUT_MS);

  const cleanup = () => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch {}
  };

  child.on("error", (err) => {
    clearTimeout(timeout);
    job.status = "failed";
    job.error = `Could not start the worker: ${err.message}`;
    cleanup();
  });

  child.on("close", async (code) => {
    clearTimeout(timeout);
    try {
      if (code !== 0) {
        throw new Error(job.log.slice(-3).join(" · ") || `worker exited with code ${code}`);
      }
      const payload = validatePayload(JSON.parse(readFileSync(outPath, "utf-8")));

      let meta: { artist?: string; title?: string; duration?: number } = {};
      const metaPath = outPath.replace(/\.json$/, ".meta.json");
      if (existsSync(metaPath)) {
        try { meta = JSON.parse(readFileSync(metaPath, "utf-8")); } catch {}
      }
      const artist = input.artist?.trim() || meta.artist;
      const track = input.track?.trim() || meta.title;
      const duration = input.duration || meta.duration;
      if (!artist || !track || !duration) {
        throw new Error(
          "Missing track identity (artist/title/duration) — fill the override fields and retry"
        );
      }

      const db = getDb();
      const trackRow = await findOrCreateTrack(db, {
        artistName: artist,
        trackName: track,
        albumName: input.album?.trim() || null,
        durationSeconds: duration,
      });
      // Remember which video this came from so /api/get?youtube_id=… resolves
      // the track exactly, whatever the stored artist/title spelling.
      const videoKey = deriveVideoKey(input.youtubeUrl);
      if (videoKey) await linkTrackVideo(db, trackRow.id, videoKey);
      const revision = await insertRevision(db, {
        trackId: trackRow.id,
        source: "auto_aligned",
        tier: "auto_aligned",
        payload,
        submitterFingerprint: "system:offline-align",
      });
      job.result = { trackId: trackRow.id, revisionId: revision.id };
      job.status = "done";
      job.log.push(`[align] imported as revision #${revision.id} on track #${trackRow.id}`);
    } catch (err) {
      job.status = "failed";
      job.error = (err as Error).message;
    } finally {
      cleanup();
    }
  });

  return job;
}
