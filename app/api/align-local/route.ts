import { z } from "zod";
import { apiError } from "@/lib/api-helpers";
import {
  localAlignAvailable,
  runningAlignJob,
  startAlignJob,
} from "@/lib/align-local";

// Local-only: spawns the alignment worker on this machine. Hidden unless
// ENABLE_LOCAL_ALIGN=1 and the worker venv exists — never enable on a
// hosted deployment.

const bodySchema = z.object({
  youtube_url: z
    .string()
    .regex(/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//, "Not a YouTube URL")
    .optional(),
  // Dev/testing convenience (no UI): align a local file instead.
  audio_path: z.string().optional(),
  lyrics: z.string().min(10).max(50_000),
  artist: z.string().max(500).optional(),
  track: z.string().max(500).optional(),
  album: z.string().max(500).optional(),
  duration: z.number().positive().max(24 * 60 * 60).optional(),
});

export async function POST(req: Request) {
  if (!localAlignAvailable()) {
    return apiError(404, "NotFound", "Local alignment is not enabled on this server");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid body" : "Invalid JSON body";
    return apiError(400, "BadRequest", message);
  }
  if (!body.youtube_url && !body.audio_path) {
    return apiError(400, "BadRequest", "Provide youtube_url");
  }
  if (body.audio_path && process.env.NODE_ENV === "production") {
    return apiError(400, "BadRequest", "audio_path is dev-only");
  }

  if (runningAlignJob()) {
    return apiError(429, "Busy", "An alignment job is already running — one at a time");
  }

  const job = startAlignJob({
    youtubeUrl: body.youtube_url,
    audioPath: body.audio_path,
    lyrics: body.lyrics,
    artist: body.artist,
    track: body.track,
    album: body.album,
    duration: body.duration,
  });
  return Response.json({ job_id: job.id }, { status: 202 });
}
