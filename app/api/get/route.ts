import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { findTrack, findTrackByVideo } from "@/lib/db/queries";
import { revisions } from "@/lib/db/schema";
import { apiError, corsOptions, json } from "@/lib/api-helpers";
import { trackResponse } from "@/lib/lrclib-compat";
import { deriveVideoKey } from "@/lib/video-key";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const artistName = params.get("artist_name");
  const trackName = params.get("track_name");
  const albumName = params.get("album_name");
  const durationRaw = params.get("duration");
  // Karalyr extension to the LRCLIB shape: an id, URL, or canonical key of
  // the video/track being played resolves exactly, no name matching involved.
  const videoKey = deriveVideoKey(
    params.get("youtube_id") ??
      params.get("spotify_id") ??
      params.get("video_key") ??
      params.get("video_url")
  );

  if (!videoKey && (!artistName || !trackName)) {
    return apiError(
      400,
      "BadRequest",
      "artist_name and track_name (or youtube_id / spotify_id / video_key) are required"
    );
  }
  const durationSeconds = durationRaw !== null ? parseFloat(durationRaw) : null;
  if (durationRaw !== null && !Number.isFinite(durationSeconds)) {
    return apiError(400, "BadRequest", "duration must be a number of seconds");
  }

  const db = getDb();
  let track = videoKey ? await findTrackByVideo(db, videoKey) : null;
  if (!track && artistName && trackName) {
    track = await findTrack(db, { artistName, trackName, albumName, durationSeconds });
  }

  if (track?.bestRevisionId != null) {
    const [best] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, track.bestRevisionId));
    if (best) return json(trackResponse(track, best));
  }

  // Miss: Karalyr only serves word-synced lyrics, so there is nothing to
  // fall back to here — clients own their own fallback chain (e.g. LRCLIB)
  // and can request a sync via the wanted queue.
  return apiError(404, "TrackNotFound", "Failed to find specified track");
}

export const OPTIONS = corsOptions;
