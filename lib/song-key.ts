/**
 * Song identity for the demand queue.
 *
 * A want for "the same song" arrives as a YouTube video, a re-upload, a
 * Spotify track, or with no URL at all — so the queue dedupes on normalized
 * artist+track, never on a video key. Everything here is a port of
 * `normalizeForMatch` in the Karafilt extension's shared/song-match.js, so
 * both sides derive the same identity for the same song. Keep the two in
 * sync; the folding tables below are the part that matters for this catalog
 * (Cyrillic and Balkan diacritics).
 *
 * Pure and dependency-free — the API computes the key server-side on every
 * intake, so a client can never fragment dedup by sending its own.
 */

// NFD strips most Latin diacritics, but some characters don't decompose
// (đ, ø, ł, æ, ß…) and Cyrillic needs an explicit map. Folding to ASCII means
// a Cyrillic or diacritic title still matches its Latin spelling.
//
// DELIBERATE DIVERGENCE from the extension: it maps Latin "đ" → "d" while
// mapping Cyrillic "ђ" → "dj", so "Đorđe" and "Ђорђе" fold differently. Its
// fuzzy matcher absorbs that; an equality-based dedup key cannot — the same
// artist would get two separate wants depending on the script they were typed
// in. "dj" is also the conventional Serbian romanization, and it makes the
// whole alphabet consistent (đ/ђ, lj/љ, nj/њ, dž/џ, ć/ћ, č/ч, š/ш, ž/ж all
// agree). Safe because the key is only ever computed here, server-side.
const SPECIAL_LATIN: Record<string, string> = {
  "đ": "dj", "ð": "d", "ł": "l", "ø": "o", "æ": "ae", "œ": "oe",
  "ß": "ss", "þ": "th", "ı": "i", "ŋ": "n", "ħ": "h", "ĸ": "k",
};

const CYRILLIC: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e",
  "ж": "z", "з": "z", "и": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj",
  "м": "m", "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s",
  "т": "t", "ћ": "c", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "c",
  "џ": "dz", "ш": "s", "ѕ": "dz", "і": "i", "ы": "y", "э": "e", "ю": "yu",
  "я": "ya", "й": "j", "ё": "e", "щ": "sc", "ъ": "", "ь": "",
};

function translit(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    if (Object.prototype.hasOwnProperty.call(SPECIAL_LATIN, ch)) out += SPECIAL_LATIN[ch];
    else if (Object.prototype.hasOwnProperty.call(CYRILLIC, ch)) out += CYRILLIC[ch];
    else out += ch;
  }
  return out;
}

/** Lowercased, diacritic/script-folded to ASCII letters. */
function asciiFold(s: string): string {
  return translit(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Upload/metadata noise stripped before comparison, so "Song (Official Video)
// [HD]" and "Song" are one entry.
const NOISE_WORDS =
  /\b(hd|hq|uhd|4k|8k|2160p|1440p|1080p?|720p|audio|video|lyric|lyrics|official|oficial|officiel|mv|live|vivo|directo|remaster|remastered|remix|rmx|stereo|mono|version|visualizer|visualiser|performance)\b/g;

function collapse(s: string): string {
  return s
    .replace(/[^a-z0-9]+/g, " ")
    // drop a trailing "feat …" / "featuring …" clause some titles embed
    .replace(/\s(feat|ft|featuring|prod)\s.*$/, "")
    .trim();
}

/**
 * Normalized comparison form of one field (artist or track).
 *
 * Falls back to the un-stripped fold when removing noise words would empty
 * the string — a band actually called "Live" must not normalize to "".
 */
export function normalizeForMatch(s: string | null | undefined): string {
  const folded = asciiFold(s || "");
  const stripped = collapse(folded.replace(NOISE_WORDS, " "));
  return stripped || collapse(folded);
}

/**
 * Dedup identity for a song: "<artist>|<track>", both normalized. The
 * separator can't collide with field content because normalization leaves
 * only [a-z0-9 ].
 */
export function songKey(artist: string, track: string): string {
  return `${normalizeForMatch(artist)}|${normalizeForMatch(track)}`;
}
