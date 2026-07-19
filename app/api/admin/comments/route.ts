import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { deleteLyricComment, listRecentLyricComments } from "@/lib/db/queries";
import { isAdminRequest } from "@/lib/admin";
import { apiError } from "@/lib/api-helpers";

export async function GET(req: Request) {
  if (!(await isAdminRequest())) return apiError(401, "Unauthorized", "Admin access required");

  const rows = await listRecentLyricComments(getDb(), 100);
  return Response.json({
    comments: rows.map(({ comment, track }) => ({
      id: comment.id,
      track_id: track.id,
      artist_name: track.artistName,
      track_name: track.trackName,
      start_line: comment.startLine,
      end_line: comment.endLine,
      quote: comment.quote,
      body: comment.body,
      author_name: comment.authorName,
      author_user_id: comment.authorUserId,
      created_at: comment.createdAt,
    })),
  });
}

const bodySchema = z.object({
  comment_id: z.number().int().positive(),
  action: z.literal("delete"),
});

export async function POST(req: Request) {
  if (!(await isAdminRequest())) return apiError(401, "Unauthorized", "Admin access required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return apiError(400, "BadRequest", 'Expected { comment_id, action: "delete" }');
  }

  const deleted = await deleteLyricComment(getDb(), body.comment_id);
  if (!deleted) return apiError(404, "CommentNotFound", "Comment does not exist");
  return Response.json({ ok: true });
}
