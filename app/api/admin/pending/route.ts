import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { revisions, tracks } from "@/lib/db/schema";
import { isAdminRequest } from "@/lib/admin";
import { apiError } from "@/lib/api-helpers";
import { validatePayload } from "@/lib/formats";

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return apiError(401, "Unauthorized", "Admin token required");

  const db = getDb();
  const pending = await db
    .select({ revision: revisions, track: tracks })
    .from(revisions)
    .innerJoin(tracks, eq(tracks.id, revisions.trackId))
    .where(eq(revisions.status, "pending_review"))
    .orderBy(desc(revisions.createdAt));

  const items = [];
  for (const { revision, track } of pending) {
    let currentBest = null;
    if (track.bestRevisionId != null) {
      const [best] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.id, track.bestRevisionId));
      if (best) {
        currentBest = {
          id: best.id,
          tier: best.tier,
          source: best.source,
          payload: validatePayload(JSON.parse(best.payload)),
        };
      }
    }
    items.push({
      revision: {
        id: revision.id,
        source: revision.source,
        tier: revision.tier,
        parent_revision_id: revision.parentRevisionId,
        created_at: revision.createdAt,
        payload: validatePayload(JSON.parse(revision.payload)),
      },
      track: {
        id: track.id,
        artistName: track.artistName,
        trackName: track.trackName,
        albumName: track.albumName,
        durationSeconds: track.durationSeconds,
      },
      current_best: currentBest,
    });
  }

  return Response.json({ items });
}
