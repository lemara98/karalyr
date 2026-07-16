/**
 * Shared metadata for the "Report lyrics" content-quality signal — the reason
 * a listener can flag that the lyrics *content* is wrong (as opposed to the
 * timing, which goes through offset_correction). Kept free of server/DB
 * imports so both the API route and the client dialog can import it.
 */

export const REPORT_REASONS = [
  { value: "wrong_words", label: "Wrong or misheard words" },
  { value: "different_song", label: "Lyrics are for a different song" },
  { value: "missing_lines", label: "Missing or extra lines" },
  { value: "wrong_language", label: "Wrong language / needs transliteration" },
  { value: "offensive", label: "Spam or offensive content" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

// Non-empty tuple for z.enum(...) on the server.
export const REPORT_REASON_VALUES = REPORT_REASONS.map((r) => r.value) as [
  ReportReason,
  ...ReportReason[],
];

export const REPORT_REASON_LABELS = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.value, r.label])
) as Record<ReportReason, string>;

/** Max length of the optional free-text note on a lyrics report. */
export const MAX_REPORT_NOTE_LENGTH = 500;
