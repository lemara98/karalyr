import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { isAdminRequest } from "@/lib/admin";
import { apiError } from "@/lib/api-helpers";
import { editJobLyrics, MIN_LYRIC_LINES } from "@/lib/sync-queue/core";

const bodySchema = z.object({
  job_id: z.number().int().positive(),
  lyrics: z.string().min(1).max(60_000),
});

/** Admin-corrected candidate lyrics — see editJobLyrics for the rules. */
export async function POST(req: Request) {
  if (!(await isAdminRequest())) return apiError(401, "Unauthorized", "Admin access required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Expected { job_id, lyrics }");
  }

  const result = await editJobLyrics(getDb(), body.job_id, body.lyrics, Date.now());
  if (!result.ok) {
    return result.reason === "bad_lyrics"
      ? apiError(400, "BadLyrics", `Need at least ${MIN_LYRIC_LINES} lyric lines`)
      : apiError(409, "NotEditable", "Job is processing or closed (or does not exist)");
  }
  return Response.json({ ok: true, line_count: result.lineCount });
}
