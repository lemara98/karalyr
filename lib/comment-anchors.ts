// Client-side re-anchoring of lyric comments onto the currently displayed
// revision. Comments store line indices valid for the revision they were
// posted against; when the best revision has since changed, we try to find
// the quoted lines in the new text and otherwise fall back to "orphaned"
// (rendered via their quote snapshot only).
import { INSTRUMENTAL_MARK } from "./comments";

export interface CommentAnchor {
  id: number;
  revision_id: number;
  start_line: number;
  end_line: number;
  quote: string;
}

export interface AnchoredComment<T> {
  comment: T;
  start: number;
  end: number;
}

function normalized(lineText: string): string {
  return lineText.trim() || INSTRUMENTAL_MARK;
}

/** First index where the consecutive block `quoteLines` matches, or -1. */
function findQuoteBlock(lineTexts: string[], quoteLines: string[]): number {
  if (quoteLines.length === 0 || quoteLines.length > lineTexts.length) return -1;
  outer: for (let i = 0; i + quoteLines.length <= lineTexts.length; i++) {
    for (let j = 0; j < quoteLines.length; j++) {
      if (normalized(lineTexts[i + j]) !== quoteLines[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Split comments into ones renderable on the current lines (with resolved
 * inclusive start/end indices) and orphans from older, changed lyrics.
 */
export function anchorComments<T extends CommentAnchor>(
  lineTexts: string[],
  currentRevisionId: number,
  comments: T[]
): { anchored: AnchoredComment<T>[]; orphaned: T[] } {
  const anchored: AnchoredComment<T>[] = [];
  const orphaned: T[] = [];

  for (const comment of comments) {
    if (comment.revision_id === currentRevisionId) {
      if (comment.start_line >= lineTexts.length) {
        orphaned.push(comment);
      } else {
        anchored.push({
          comment,
          start: comment.start_line,
          end: Math.min(comment.end_line, lineTexts.length - 1),
        });
      }
      continue;
    }
    const quoteLines = comment.quote.split("\n");
    const at = findQuoteBlock(lineTexts, quoteLines);
    if (at === -1) {
      orphaned.push(comment);
    } else {
      anchored.push({ comment, start: at, end: at + quoteLines.length - 1 });
    }
  }

  return { anchored, orphaned };
}
