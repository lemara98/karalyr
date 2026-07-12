import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { listRevisions } from "@/lib/db/queries";
import { tracks } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";

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
  if (!track) return apiError(404, "TrackNotFound", "Failed to find specified track");

  const revs = await listRevisions(db, trackId);
  return json({
    track_id: track.id,
    best_revision_id: track.bestRevisionId,
    revisions: revs.map((r) => ({
      id: r.id,
      source: r.source,
      tier: r.tier,
      status: r.status,
      parent_revision_id: r.parentRevisionId,
      created_at: r.createdAt,
      // Public transparency without doxing: fingerprints are hashes already,
      // but only expose a stub.
      submitter: r.submitterFingerprint.startsWith("system:")
        ? r.submitterFingerprint
        : r.submitterFingerprint.slice(0, 8),
    })),
  });
}

export const OPTIONS = corsOptions;
