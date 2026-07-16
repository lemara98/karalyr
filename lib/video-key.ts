// Normalize a playback-source reference to the stable key stored in
// track_videos. Mirrors the Karafilt extension's deriveVideoKey
// (shared/video-key.js): YouTube collapses to "yt:<videoId>" and Spotify
// tracks to "sp:<trackId>", so watch/share/embed URLs, playlist/timestamp
// params, URIs and bare ids all resolve to the same key.

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SP_ID_RE = /^[0-9A-Za-z]{22}$/;
const CANONICAL_RE = /^(?:yt:[A-Za-z0-9_-]{11}|sp:[0-9A-Za-z]{22})$/;
const SP_URI_RE = /^spotify:track:([0-9A-Za-z]{22})$/;
const SP_PATH_RE = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([0-9A-Za-z]{22})(?:[/?]|$)/;

/**
 * URL, URI, bare id, or already-canonical key → "yt:<id>" | "sp:<id>" | null.
 * Accepts YouTube watch/short/embed/youtu.be URLs and bare 11-char ids, and
 * Spotify track URLs (incl. /intl-xx/ and /embed/), spotify:track: URIs and
 * bare 22-char ids. The id lengths differ, so bare ids are unambiguous.
 */
export function deriveVideoKey(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (CANONICAL_RE.test(s)) return s;
  if (YT_ID_RE.test(s)) return `yt:${s}`;
  if (SP_ID_RE.test(s)) return `sp:${s}`;
  const uri = s.match(SP_URI_RE);
  if (uri) return `sp:${uri[1]}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (/(^|\.)youtube\.com$/.test(host)) {
    const v = u.searchParams.get("v");
    if (v && YT_ID_RE.test(v)) return `yt:${v}`;
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return `yt:${m[1]}`;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (YT_ID_RE.test(id)) return `yt:${id}`;
  }
  if (host === "open.spotify.com") {
    const m = u.pathname.match(SP_PATH_RE);
    if (m) return `sp:${m[1]}`;
  }
  return null;
}

export type ParsedVideoKey = { platform: "youtube" | "spotify"; id: string };

/** Canonical key ("yt:<id>" | "sp:<id>") → platform + bare id, or null. */
export function parseVideoKey(key: string | null | undefined): ParsedVideoKey | null {
  const s = (key ?? "").trim();
  if (!CANONICAL_RE.test(s)) return null;
  return s.startsWith("yt:")
    ? { platform: "youtube", id: s.slice(3) }
    : { platform: "spotify", id: s.slice(3) };
}

/**
 * Pick the key to embed on a track page: an embeddable video (yt:) beats an
 * audio-only Spotify card, earliest link wins within a platform. Sorts
 * internally so callers don't depend on query ordering.
 */
export function pickPreferredVideoKey(
  videos: { videoKey: string; createdAt: number }[]
): string | null {
  const sorted = videos
    .filter((v) => parseVideoKey(v.videoKey))
    .sort((a, b) => a.createdAt - b.createdAt || (a.videoKey < b.videoKey ? -1 : 1));
  return (sorted.find((v) => v.videoKey.startsWith("yt:")) ?? sorted[0])?.videoKey ?? null;
}
