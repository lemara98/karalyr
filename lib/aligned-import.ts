import type { Db } from "./db/client";
import { findOrCreateTrack, insertRevision, linkTrackVideo } from "./db/queries";
import type { LyricsPayload } from "./formats";
import type { Revision } from "./db/schema";
import { deriveVideoKey } from "./video-key";

export interface AlignedImportInput {
  payload: LyricsPayload;
  artist: string;
  track: string;
  album?: string | null;
  duration: number;
  /** Video URL/id the audio came from; linked so by-video lookups resolve. */
  videoUrl?: string | null;
  submitterFingerprint: string;
}

export interface AlignedImportResult {
  trackId: number;
  revisionId: number;
  /** "pending_review" under Rule C (best revision is verified), else "active". */
  revisionStatus: Revision["status"];
}

/**
 * Import an aligner-produced payload as an auto_aligned revision: resolve or
 * create the track, remember which video it came from, insert the revision
 * (Rule C + best-revision recompute happen inside insertRevision). Shared by
 * the local Studio align flow and the sync-queue worker's complete route —
 * one import path for both.
 */
export async function importAlignedPayload(
  db: Db,
  input: AlignedImportInput
): Promise<AlignedImportResult> {
  const track = await findOrCreateTrack(db, {
    artistName: input.artist,
    trackName: input.track,
    albumName: input.album?.trim() || null,
    durationSeconds: input.duration,
  });
  const videoKey = deriveVideoKey(input.videoUrl);
  if (videoKey) await linkTrackVideo(db, track.id, videoKey);
  const revision = await insertRevision(db, {
    trackId: track.id,
    source: "auto_aligned",
    tier: "auto_aligned",
    payload: input.payload,
    submitterFingerprint: input.submitterFingerprint,
  });
  return { trackId: track.id, revisionId: revision.id, revisionStatus: revision.status };
}
