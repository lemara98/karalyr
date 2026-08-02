/**
 * Cheap lyrics-language sniffing for the sync queue: an intake without an
 * explicit language hint gets one guessed from the dominant Unicode script
 * of its lyrics. Only scripts that need aligner special-casing are detected;
 * plain-Latin lyrics return null (correct for the Balkan catalog as well as
 * Indonesian/Tagalog - the aligner default handles all of them).
 *
 * Pure and dependency-free. Codes are ISO 639-1, matching worker/align.py's
 * LANGUAGES table.
 */

const SCRIPT_RANGES: Array<{ code: string; re: RegExp }> = [
  { code: "hi", re: /[ऀ-ॿ]/u }, // Devanagari (hi default; also mr)
  { code: "bn", re: /[ঀ-৿]/u }, // Bengali
  { code: "pa", re: /[਀-੿]/u }, // Gurmukhi
  { code: "ta", re: /[஀-௿]/u }, // Tamil
  { code: "te", re: /[ఀ-౿]/u }, // Telugu
  { code: "th", re: /[฀-๿]/u }, // Thai
  { code: "lo", re: /[຀-໿]/u }, // Lao
  { code: "km", re: /[ក-៿]/u }, // Khmer
  { code: "zh", re: /[㐀-䶿一-鿿豈-﫿]/u }, // Han
];

// Vietnamese is Latin-script but has letters no other target language uses.
const VIETNAMESE_RE = /[ơƠưƯđĐạảầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏồổỗộớờởỡợụủứừửữựỳỵỷỹ]/u;

/**
 * Guess the ISO 639-1 language of a lyrics blob, or null when it's plain
 * Latin (no special handling needed). A script wins when it accounts for the
 * plurality of non-Latin letters; Vietnamese wins on its marker letters.
 */
export function detectLyricsLanguage(lyrics: string): string | null {
  if (!lyrics) return null;
  const counts = new Map<string, number>();
  for (const { code, re } of SCRIPT_RANGES) {
    const matches = lyrics.match(new RegExp(re.source, "gu"));
    if (matches) counts.set(code, matches.length);
  }
  if (counts.size > 0) {
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    // Ignore stray characters (a quoted word in an otherwise-Latin song).
    const letters = (lyrics.match(/\p{L}/gu) || []).length;
    if (letters > 0 && n / letters >= 0.25) return best;
    return null;
  }
  if (VIETNAMESE_RE.test(lyrics)) return "vi";
  return null;
}
