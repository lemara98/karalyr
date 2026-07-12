import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { revisions, tracks } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { trackResponse } from "@/lib/lrclib-compat";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (!Number.isFinite(trackId)) {
    return apiError(400, "BadRequest", "Track id must be a number");
  }

  const db = getDb();
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track || track.bestRevisionId == null) {
    return apiError(404, "TrackNotFound", "Failed to find specified track");
  }
  const [best] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, track.bestRevisionId));
  if (!best) return apiError(404, "TrackNotFound", "Failed to find specified track");

  return json(trackResponse(track, best));
}

export const OPTIONS = corsOptions;
