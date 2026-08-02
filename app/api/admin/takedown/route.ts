import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { adminStatus } from "@/lib/admin";
import { apiError, json } from "@/lib/api-helpers";
import {
  actionTakedown,
  blockSubmitter,
  declineNotice,
  listNotices,
  unblockSubmitter,
} from "@/lib/takedown";

/**
 * Acting on a rights complaint. Every action names the admin who took it -
 * a removal is a legal act, so the audit trail matters as much as the effect.
 *
 * `action: "remove"` is irreversible: the lyric payloads are purged, not
 * hidden (lib/takedown.ts).
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("remove"),
    notice_id: z.number().int().positive(),
    revision_ids: z.array(z.number().int().positive()).min(1).max(500),
    resolution: z.string().max(2000).nullish(),
  }),
  z.object({
    action: z.literal("decline"),
    notice_id: z.number().int().positive(),
    // Required: a declined notice with no stated reason is the one record
    // that would actively hurt to produce later.
    resolution: z.string().min(1).max(2000),
  }),
  z.object({
    action: z.literal("block"),
    fingerprint: z.string().min(1).max(200),
    reason: z.string().min(1).max(2000),
  }),
  z.object({
    action: z.literal("unblock"),
    fingerprint: z.string().min(1).max(200),
  }),
]);

export async function GET() {
  const { isAdmin } = await adminStatus();
  if (!isAdmin) return apiError(401, "Unauthorized", "Admin access required");
  return json({ notices: await listNotices(getDb()) });
}

export async function POST(req: Request) {
  const { isAdmin, email, via } = await adminStatus();
  if (!isAdmin) return apiError(401, "Unauthorized", "Admin access required");
  const actor = email ?? (via === "legacy-token" ? "legacy-token" : "unknown");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid body" : "Invalid JSON body";
    return apiError(400, "BadRequest", message);
  }

  const db = getDb();

  if (body.action === "remove") {
    const { notice, removed, tracksRecomputed } = await actionTakedown(db, {
      noticeId: body.notice_id,
      revisionIds: body.revision_ids,
      actor,
      resolution: body.resolution,
    });
    if (!notice) return apiError(404, "NoticeNotFound", "Notice does not exist");
    return json({ ok: true, removed, tracks_recomputed: tracksRecomputed });
  }

  if (body.action === "decline") {
    const notice = await declineNotice(db, {
      noticeId: body.notice_id,
      actor,
      resolution: body.resolution,
    });
    if (!notice) return apiError(404, "NoticeNotFound", "Notice does not exist");
    return json({ ok: true });
  }

  if (body.action === "block") {
    await blockSubmitter(db, {
      fingerprint: body.fingerprint,
      reason: body.reason,
      actor,
    });
    return json({ ok: true });
  }

  await unblockSubmitter(db, body.fingerprint);
  return json({ ok: true });
}
