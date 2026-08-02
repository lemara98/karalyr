import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { isAdminRequest } from "@/lib/admin";
import { apiError } from "@/lib/api-helpers";
import { editJob, MIN_LYRIC_LINES } from "@/lib/sync-queue/core";

// Field bounds mirror the intake routes; album_name null (or blank) clears it.
const bodySchema = z
  .object({
    job_id: z.number().int().positive(),
    lyrics: z.string().min(1).max(60_000).optional(),
    artist_name: z.string().min(1).max(500).optional(),
    track_name: z.string().min(1).max(500).optional(),
    album_name: z.string().max(500).nullish(),
  })
  .refine(
    (b) =>
      b.lyrics !== undefined ||
      b.artist_name !== undefined ||
      b.track_name !== undefined ||
      b.album_name !== undefined,
    { message: "Nothing to change" }
  );

/** Admin correction of a candidate's lyrics and/or metadata - see editJob for the rules. */
export async function POST(req: Request) {
  if (!(await isAdminRequest())) return apiError(401, "Unauthorized", "Admin access required");

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Expected { job_id, … }");
  }

  const result = await editJob(
    getDb(),
    body.job_id,
    {
      lyrics: body.lyrics,
      artistName: body.artist_name,
      trackName: body.track_name,
      ...(body.album_name !== undefined ? { albumName: body.album_name } : {}),
    },
    Date.now()
  );
  if (!result.ok) {
    switch (result.reason) {
      case "bad_lyrics":
        return apiError(400, "BadLyrics", `Need at least ${MIN_LYRIC_LINES} lyric lines`);
      case "bad_metadata":
        return apiError(400, "BadMetadata", "Artist and track names cannot be empty");
      case "duplicate_song":
        return apiError(
          409,
          "DuplicateSong",
          "Another active request already exists for that artist and title"
        );
      default:
        return apiError(409, "NotEditable", "Job is processing or closed (or does not exist)");
    }
  }
  return Response.json({ ok: true, line_count: result.lineCount });
}
