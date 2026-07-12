import { getDb } from "../db/client";
import { findOrCreateTrack, findTrack, insertRevision } from "../db/queries";
import { parseEnhancedLrc, parseLrc, type LyricsPayload } from "../formats";
import type { LazyImportParams } from "./queue";

const USER_AGENT = "Karalyr/0.1.0 (https://github.com/karalyr/karalyr)";

interface LrclibResponse {
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

function toPayload(res: LrclibResponse): LyricsPayload | null {
  if (res.syncedLyrics) {
    // LRCLIB synced lyrics are plain LRC; the enhanced parser degrades
    // gracefully to line-level when no word tags exist.
    try {
      return /<\d{1,3}:\d{1,2}/.test(res.syncedLyrics)
        ? parseEnhancedLrc(res.syncedLyrics)
        : parseLrc(res.syncedLyrics);
    } catch {
      return null;
    }
  }
  if (res.plainLyrics) {
    // Untimed lyrics: keep line order with zeroed, non-overlapping stubs so
    // the payload validates; has_word_timing false and all starts 0-based.
    const lines = res.plainLyrics.split(/\r?\n/);
    return {
      format_version: 1,
      lines: lines.map((text, i) => ({
        start_ms: i * 1000,
        end_ms: i * 1000 + 1000,
        singer: null,
        text: text.trim(),
      })),
      meta: { language: null, has_word_timing: false, countdown_lines: [] },
    };
  }
  return null;
}

/**
 * Fetch a track from the upstream LRCLIB instance and store it as an
 * lrclib_import revision. Returns true if a revision was created.
 */
export async function importFromLrclib(params: LazyImportParams): Promise<boolean> {
  const base = process.env.LRCLIB_BASE_URL || "https://lrclib.net";
  const url = new URL("/api/get", base);
  url.searchParams.set("artist_name", params.artistName);
  url.searchParams.set("track_name", params.trackName);
  if (params.albumName) url.searchParams.set("album_name", params.albumName);
  if (params.durationSeconds != null) {
    url.searchParams.set("duration", String(Math.round(params.durationSeconds)));
  }

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return false;
  const body = (await res.json()) as LrclibResponse;
  if (body.instrumental) return false;

  const payload = toPayload(body);
  if (!payload || payload.lines.length === 0) return false;

  const db = getDb();
  // Re-check: another request may have imported it while we fetched.
  const existing = await findTrack(db, {
    artistName: body.artistName,
    trackName: body.trackName,
    albumName: body.albumName,
    durationSeconds: body.duration,
  });
  if (existing?.bestRevisionId != null) return false;

  const track =
    existing ??
    (await findOrCreateTrack(db, {
      artistName: body.artistName,
      trackName: body.trackName,
      albumName: body.albumName,
      durationSeconds: body.duration,
    }));

  await insertRevision(db, {
    trackId: track.id,
    source: "lrclib_import",
    tier: "imported",
    payload,
    submitterFingerprint: "system:lrclib-import",
  });
  return true;
}
