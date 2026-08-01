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

/**
 * One URL-safe segment: ASCII-folded where folding is lossless (Latin
 * diacritics, Cyrillic), native script kept otherwise — `/track/तुम-ही-हो-123`
 * carries the keywords people actually search, where the old [a-z0-9] rule
 * collapsed every non-Latin title to the bare id. Browsers render these
 * natively; the URL is percent-encoded only on the wire. The trailing ASCII
 * id keeps parseTrackSlug unambiguous (native digits are \p{N}, not \d).
 */
export function slugifyPart(s: string | null | undefined): string {
  const seg = asciiFold(s || "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // Slice by code point — a UTF-16 slice could cut a surrogate pair in half.
  return [...seg].slice(0, MAX_PART).join("").replace(/-+$/, "");
}

export type SluggableTrack = {
  id: number;
  artistName?: string | null;
  trackName?: string | null;
};

/**
 * Canonical slug for a track. Falls back to the bare id when both names
 * reduce to nothing (a title that is entirely punctuation/symbols).
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
