import { getDb } from "@/lib/db/client";
import { findTrackByVideo, getActiveChordChart } from "@/lib/db/queries";
import { tracks } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { validateChordChart } from "@/lib/formats";
import { deriveVideoKey } from "@/lib/video-key";
import { eq } from "drizzle-orm";

/**
 * Public chord-chart lookup. Same identity family as /api/get — the id, URL,
 * or canonical key of the video being played resolves exactly — plus track_id
 * for clients that already resolved the track. Not folded into /api/get: that
 * response is the LRCLIB-compat surface and a chart is karalyr-native data,
 * so it gets its own route the way /api/track/[id]/revisions does. /api/get
 * advertises availability via karalyr.has_chords.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const trackIdRaw = params.get("track_id");
  const videoKey = deriveVideoKey(
    params.get("youtube_id") ??
      params.get("spotify_id") ??
      params.get("video_key") ??
      params.get("video_url")
  );

  const db = getDb();
  let track = videoKey ? await findTrackByVideo(db, videoKey) : null;
  if (!track && trackIdRaw !== null) {
    const trackId = parseInt(trackIdRaw, 10);
    if (!Number.isInteger(trackId) || trackId <= 0) {
      return apiError(400, "BadRequest", "track_id must be a positive integer");
    }
    const [byId] = await db.select().from(tracks).where(eq(tracks.id, trackId));
    track = byId ?? null;
  }
  if (!videoKey && trackIdRaw === null) {
    return apiError(
      400,
      "BadRequest",
      "youtube_id / spotify_id / video_key / video_url or track_id is required"
    );
  }
  if (!track) return apiError(404, "TrackNotFound", "Failed to find specified track");

  const chart = await getActiveChordChart(db, track.id);
  if (!chart) return apiError(404, "ChordsNotFound", "No chord chart for the specified track");

  return json({
    track_id: track.id,
    trackName: track.trackName,
    artistName: track.artistName,
    duration: track.durationSeconds,
    chords: validateChordChart(JSON.parse(chart.payload)),
    karalyr: {
      chart_id: chart.id,
      tier: chart.tier,
      source: chart.source,
      created_at: chart.createdAt,
    },
  });
}

export const OPTIONS = corsOptions;
