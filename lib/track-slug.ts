/**
 * Readable URLs for track pages: `/track/<artist>-<title>-<id>`.
 *
 * The numeric id stays in the slug on purpose. Artist+title alone are not
 * unique (covers, re-records, two songs that fold to the same ASCII), and a
 * track can be renamed by a metadata fix — an id-suffixed slug keeps every
 * link stable and lookup a single primary-key read, while still giving search
 * engines and humans the words they care about.
 *
 * Because the id is always the last `-` segment, bare `/track/17` still parses
 * and the page redirects it to the canonical slug.
 */

import { asciiFold } from "./song-key";

// Long enough that real artist/title pairs survive intact, short enough that a
// pathological title can't produce a multi-kilobyte path.
const MAX_PART = 60;

/** One URL-safe segment: ASCII-folded, non-alphanumerics collapsed to "-". */
export function slugifyPart(s: string | null | undefined): string {
  return asciiFold(s || "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PART)
    .replace(/-+$/, "");
}

export type SluggableTrack = {
  id: number;
  artistName?: string | null;
  trackName?: string | null;
};

/**
 * Canonical slug for a track. Falls back to the bare id when both names fold
 * away to nothing (e.g. a title that is entirely punctuation or CJK).
 */
export function trackSlug(track: SluggableTrack): string {
  const words = [slugifyPart(track.artistName), slugifyPart(track.trackName)]
    .filter(Boolean)
    .join("-");
  return words ? `${words}-${track.id}` : String(track.id);
}

/** Canonical href for a track page. */
export function trackPath(track: SluggableTrack): string {
  return `/track/${trackSlug(track)}`;
}

/**
 * Pull the track id back out of a slug. Accepts the bare id too, so old
 * `/track/17` links keep working. Returns null when there's no trailing id.
 */
export function parseTrackSlug(slug: string): number | null {
  const match = /(?:^|-)(\d+)$/.exec(slug.trim());
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
