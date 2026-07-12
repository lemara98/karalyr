import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { findTrack } from "@/lib/db/queries";
import { revisions } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { trackResponse } from "@/lib/lrclib-compat";
import { getJobQueue } from "@/lib/lazy-import/in-process";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const artistName = params.get("artist_name");
  const trackName = params.get("track_name");
  const albumName = params.get("album_name");
  const durationRaw = params.get("duration");

  if (!artistName || !trackName) {
    return apiError(400, "BadRequest", "artist_name and track_name are required");
  }
  const durationSeconds = durationRaw !== null ? parseFloat(durationRaw) : null;
  if (durationRaw !== null && !Number.isFinite(durationSeconds)) {
    return apiError(400, "BadRequest", "duration must be a number of seconds");
  }

  const db = getDb();
  const track = await findTrack(db, { artistName, trackName, albumName, durationSeconds });

  if (track?.bestRevisionId != null) {
    const [best] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, track.bestRevisionId));
    if (best) return json(trackResponse(track, best));
  }

  // Miss: answer immediately, then try to import from LRCLIB in the
  // background so the next identical request can hit.
  after(() => {
    getJobQueue().enqueueLrclibImport({ artistName, trackName, albumName, durationSeconds });
  });
  return apiError(404, "TrackNotFound", "Failed to find specified track");
}

export const OPTIONS = corsOptions;
