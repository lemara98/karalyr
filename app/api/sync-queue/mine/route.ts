import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { syncJobs } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// last_error holds the raw worker output tail (yt-dlp/aligner tracebacks,
// worker-machine paths) — admin material. Submitters get a short summary.
function summarizeError(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("video unavailable") || t.includes("private video")) {
    return "The video could not be downloaded";
  }
  if (t.includes("copyright") || t.includes("terminated")) return "The video is not available";
  if (t.includes("age")) return "The video is age-restricted";
  if (t.includes("timed out")) return "Processing timed out";
  if (t.includes("lease expired")) return "Processing was interrupted";
  if (t.includes("aligner returned") || t.includes("no lyric lines")) {
    return "The lyrics could not be aligned to the audio";
  }
  return "Processing failed";
}

export async function GET() {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(401, "Unauthorized", "Sign in to see your sync requests");

  const jobs = await getDb()
    .select()
    .from(syncJobs)
    .where(eq(syncJobs.submitterUserId, user.id))
    .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
    .limit(20);

  return json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      artist_name: j.artistName,
      track_name: j.trackName,
      video_url: j.videoUrl,
      created_at: j.createdAt,
      last_error: summarizeError(j.lastError),
      rejection_reason: j.rejectionReason,
      result_track_id: j.resultTrackId,
    })),
  });
}

export const OPTIONS = corsOptions;
