import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { revisions } from "@/lib/db/schema";
import { isAdminRequest } from "@/lib/admin";
import { apiError } from "@/lib/api-helpers";
import { computeBestRevision } from "@/lib/ranking";

const bodySchema = z.object({
  revision_id: z.number().int().positive(),
  action: z.enum(["approve", "reject", "revert"]),
});

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return apiError(401, "Unauthorized", "Admin token required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return apiError(400, "BadRequest", "Expected { revision_id, action }");
  }

  const db = getDb();
  const [revision] = await db.select().from(revisions).where(eq(revisions.id, body.revision_id));
  if (!revision) return apiError(404, "RevisionNotFound", "Revision does not exist");

  if (body.action === "approve" || body.action === "reject") {
    if (revision.status !== "pending_review") {
      return apiError(400, "BadRequest", "Revision is not pending review");
    }
    await db
      .update(revisions)
      .set({ status: body.action === "approve" ? "active" : "rejected" })
      .where(eq(revisions.id, revision.id));
  } else {
    // Revert-to-revision: retire every newer active revision of the track so
    // this one ranks again, and reactivate the target if it was retired.
    if (revision.status === "rejected" || revision.status === "pending_review") {
      return apiError(400, "BadRequest", "Can only revert to an active or reverted revision");
    }
    await db
      .update(revisions)
      .set({ status: "reverted" })
      .where(
        and(
          eq(revisions.trackId, revision.trackId),
          eq(revisions.status, "active"),
          gt(revisions.createdAt, revision.createdAt)
        )
      );
    await db.update(revisions).set({ status: "active" }).where(eq(revisions.id, revision.id));
  }

  const bestId = await computeBestRevision(db, revision.trackId);
  return Response.json({ ok: true, best_revision_id: bestId });
}
