import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { findTrack } from "@/lib/db/queries";
import { lineObservations } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { fingerprintFromRequest } from "@/lib/fingerprint";
import { getJobQueue } from "@/lib/lazy-import/in-process";
import { checkRateLimit } from "@/lib/rate-limit";
import { runStitchCheck } from "@/lib/stitch";
import { getKvStore } from "@/lib/stores/memory";

// A playthrough submits one observation per sung line (~30-80 per song), so
// this is far above /api/signal's budget but still bounded per fingerprint.
const OBSERVE_LIMIT = { limit: 1000, windowMs: 60 * 60 * 1000 };

const bodySchema = z.object({
  artist_name: z.string().min(1).max(500),
  track_name: z.string().min(1).max(500),
  album_name: z.string().max(500).nullish(),
  duration: z.number().positive().max(24 * 60 * 60),
  line_start_ms: z.number().int().nonnegative(),
  line_text: z.string().min(1).max(1000),
  words: z
    .array(
      z.object({
        text: z.string().min(1).max(100),
        start_ms: z.number().int().nonnegative(),
        end_ms: z.number().int().nonnegative(),
      })
    )
    .min(1)
    .max(60),
  confidence: z.number().min(0).max(1),
  client: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid body" : "Invalid JSON body";
    return apiError(400, "BadRequest", message);
  }

  const fingerprint = fingerprintFromRequest(req);
  const { allowed } = await checkRateLimit(
    getKvStore(),
    `observe:${fingerprint}`,
    OBSERVE_LIMIT.limit,
    OBSERVE_LIMIT.windowMs
  );
  if (!allowed) return apiError(429, "TooManyRequests", "Observation rate limit exceeded");

  const db = getDb();
  const track = await findTrack(db, {
    artistName: body.artist_name,
    trackName: body.track_name,
    albumName: body.album_name ?? null,
    durationSeconds: body.duration,
  });

  if (!track) {
    // Unknown track: kick off the LRCLib lazy import so the line-level base
    // exists by the next playthrough; this observation is dropped.
    after(() => {
      getJobQueue().enqueueLrclibImport({
        artistName: body.artist_name,
        trackName: body.track_name,
        albumName: body.album_name ?? null,
        durationSeconds: body.duration,
      });
    });
    return json({ ok: false, queued_import: true }, { status: 202 });
  }

  await db.insert(lineObservations).values({
    trackId: track.id,
    lineStartMs: body.line_start_ms,
    lineText: body.line_text,
    wordsJson: JSON.stringify(body.words),
    confidence: body.confidence,
    fingerprint,
    createdAt: Date.now(),
  });

  const stitchedRevisionId = await runStitchCheck(db, track.id);
  return json({ ok: true, track_id: track.id, stitched_revision_id: stitchedRevisionId });
}

export const OPTIONS = corsOptions;
