import { getDb } from "@/lib/db/client";
import { searchTracks } from "@/lib/db/queries";
import { apiError, corsOptions, json } from "@/lib/api-helpers";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  // LRCLIB compatibility: `q` for a free query, or per-field params which we
  // fold into one FTS query.
  const q =
    params.get("q") ??
    [params.get("artist_name"), params.get("track_name"), params.get("album_name")]
      .filter(Boolean)
      .join(" ");

  if (!q.trim()) {
    return apiError(400, "BadRequest", "Provide q or artist_name/track_name/album_name");
  }

  const results = await searchTracks(getDb(), q);
  return json(
    results.map((t) => ({
      id: t.id,
      name: t.trackName,
      trackName: t.trackName,
      artistName: t.artistName,
      albumName: t.albumName,
      duration: t.durationSeconds,
      instrumental: false,
      karalyr: {
        tier: t.bestTier,
        has_lyrics: t.bestRevisionId !== null,
        has_word_timing: t.bestHasWordTiming,
      },
    }))
  );
}

export const OPTIONS = corsOptions;
