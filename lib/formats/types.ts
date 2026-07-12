import { z } from "zod";

export const wordSchema = z.object({
  text: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
});

export const lineSchema = z.object({
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  singer: z.union([z.literal("P1"), z.literal("P2"), z.literal("BOTH"), z.null()]),
  text: z.string(),
  words: z.array(wordSchema).optional(),
});

export const payloadSchema = z.object({
  format_version: z.literal(1),
  lines: z.array(lineSchema),
  meta: z.object({
    language: z.string().nullable(),
    has_word_timing: z.boolean(),
    countdown_lines: z.array(z.number().int()),
  }),
});

export type Word = z.infer<typeof wordSchema>;
export type Line = z.infer<typeof lineSchema>;
export type LyricsPayload = z.infer<typeof payloadSchema>;

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

/** Duration a last line/word is assumed to last when nothing follows it. */
export const TRAILING_DURATION_MS = 5000;

export function emptyPayload(): LyricsPayload {
  return {
    format_version: 1,
    lines: [],
    meta: { language: null, has_word_timing: false, countdown_lines: [] },
  };
}

/** Plain, untimed lyrics text (one line per payload line). */
export function payloadToPlainText(payload: LyricsPayload): string {
  return payload.lines.map((l) => l.text).join("\n");
}
