import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  revisions,
  signals,
  tracks,
  TIER_RANK,
  type Revision,
  type Signal,
} from "./db/schema";

/**
 * Net quality score for a revision: distinct fingerprints for each positive
 * type (explicit_up, clean_playthrough) minus distinct fingerprints for the
 * negatives (explicit_down and content_report — wrong lyrics content).
 * Duplicate signals from one fingerprint count once per type.
 */
export function netScore(revisionSignals: Signal[]): number {
  const byType = (type: Signal["type"]) =>
    new Set(revisionSignals.filter((s) => s.type === type).map((s) => s.fingerprint)).size;
  return (
    byType("explicit_up") +
    byType("clean_playthrough") -
    byType("explicit_down") -
    byType("content_report")
  );
}

/**
 * Pick the best revision: active only; highest tier, then highest net
 * score, then newest created_at, then highest id.
 */
export function rankRevisions(
  candidates: Revision[],
  allSignals: Signal[]
): Revision | null {
  const active = candidates.filter((r) => r.status === "active");
  if (active.length === 0) return null;

  const scores = new Map<number, number>();
  for (const rev of active) {
    scores.set(rev.id, netScore(allSignals.filter((s) => s.revisionId === rev.id)));
  }

  return active.reduce((best, rev) => {
    const tierDiff = TIER_RANK[rev.tier] - TIER_RANK[best.tier];
    if (tierDiff !== 0) return tierDiff > 0 ? rev : best;
    const scoreDiff = (scores.get(rev.id) ?? 0) - (scores.get(best.id) ?? 0);
    if (scoreDiff !== 0) return scoreDiff > 0 ? rev : best;
    if (rev.createdAt !== best.createdAt) return rev.createdAt > best.createdAt ? rev : best;
    return rev.id > best.id ? rev : best;
  });
}

/**
 * Recompute and persist tracks.best_revision_id for one track. Call after
 * any write that can change the answer (new revision, new signal,
 * moderation action).
 */
export async function computeBestRevision(db: Db, trackId: number): Promise<number | null> {
  const revs = await db.select().from(revisions).where(eq(revisions.trackId, trackId));
  const revIds = revs.map((r) => r.id);
  const sigs =
    revIds.length > 0
      ? await db.select().from(signals).where(inArray(signals.revisionId, revIds))
      : [];
  const best = rankRevisions(revs, sigs);
  await db
    .update(tracks)
    .set({ bestRevisionId: best?.id ?? null })
    .where(eq(tracks.id, trackId));
  return best?.id ?? null;
}
