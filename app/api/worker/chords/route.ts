import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { findTrackByVideo } from "@/lib/db/queries";
import { tracks } from "@/lib/db/schema";
import { apiError, json } from "@/lib/api-helpers";
import { importChordChart } from "@/lib/chord-import";
import { FormatError, validateChordChart } from "@/lib/formats";
import { deriveVideoKey } from "@/lib/video-key";
import { isWorkerRequest } from "@/lib/worker-auth";

/**
 * Standalone chord-chart upload — the backfill path for tracks that already
 * have lyrics (worker/analyze_chords.py). New tracks only ever enter through
 * an alignment, so an unresolved identity here is a 404, not a create.
 */
const bodySchema = z
  .object({
    worker_id: z.string().min(1).max(100),
    video_key: z.string().min(1).optional(),
    track_id: z.number().int().positive().optional(),
    payload: z.unknown(),
  })
  .refine((b) => (b.video_key !== undefined) !== (b.track_id !== undefined), {
    message: "Exactly one of video_key or track_id is required",
  });

export async function POST(req: Request) {
  if (!isWorkerRequest(req)) return apiError(401, "Unauthorized", "Worker token required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  const db = getDb();
  let track = null;
  let derivedFromVideoKey: string | null = null;
  if (body.video_key !== undefined) {
    derivedFromVideoKey = deriveVideoKey(body.video_key);
    if (!derivedFromVideoKey) {
      return apiError(400, "BadRequest", "video_key is not a recognized video identity");
    }
    track = await findTrackByVideo(db, derivedFromVideoKey);
  } else {
    const [byId] = await db.select().from(tracks).where(eq(tracks.id, body.track_id!));
    track = byId ?? null;
  }
  if (!track) return apiError(404, "TrackNotFound", "Failed to find specified track");

  let chart;
  try {
    chart = validateChordChart(body.payload);
  } catch (err) {
    if (err instanceof FormatError) return apiError(400, "InvalidPayload", err.message);
    throw err;
  }

  let result;
  try {
    result = await importChordChart(db, {
      trackId: track.id,
      payload: chart,
      submitterFingerprint: "system:chords-backfill",
      derivedFromVideoKey,
    });
  } catch (err) {
    // Empty-segments refusal from the import path.
    if (err instanceof FormatError) return apiError(400, "InvalidPayload", err.message);
    throw err;
  }
  if (!result.ok) {
    return apiError(409, "TakenDown", "A chart for this track was removed on a rights complaint");
  }

  return json({ track_id: track.id, chart_id: result.chartId, deduped: result.deduped });
}
