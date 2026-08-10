import type { Revision, Track } from "./db/schema";
import {
  payloadToPlainText,
  payloadToSyncedLyrics,
  validatePayload,
} from "./formats";

/**
 * LRCLIB-compatible response body plus the `karalyr` extension object. An
 * existing LRCLIB client can swap base URLs and keep reading
 * plainLyrics/syncedLyrics; karaoke-aware clients read karalyr.payload.
 *
 * Stays pure — the caller looks up whatever `extras` need a query (the
 * has_chords flag), the same way it looks up the revision.
 */
export function trackResponse(
  track: Track,
  revision: Revision,
  extras: { hasChords?: boolean } = {}
) {
  const payload = validatePayload(JSON.parse(revision.payload));
  return {
    id: track.id,
    name: track.trackName,
    trackName: track.trackName,
    artistName: track.artistName,
    albumName: track.albumName,
    duration: track.durationSeconds,
    instrumental: false,
    plainLyrics: payloadToPlainText(payload),
    syncedLyrics: payloadToSyncedLyrics(payload),
    karalyr: {
      payload,
      tier: revision.tier,
      source: revision.source,
      revision_id: revision.id,
      has_word_timing: payload.meta.has_word_timing,
      // Discovery hint for GET /api/chords, the exact analogue of
      // has_word_timing: cheap to serve, saves a doomed round trip.
      has_chords: extras.hasChords ?? false,
    },
  };
}
