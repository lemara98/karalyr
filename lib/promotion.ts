import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { revisions, signals, TIERS, TIER_RANK, type Revision, type Tier } from "./db/schema";
import { validatePayload } from "./formats";
import { applyOffset, median } from "./offset";
import { computeBestRevision } from "./ranking";

export const PROMOTION_THRESHOLD = 3;
export const OFFSET_AGREEMENT_MS = 150;
export const RECENT_DOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTO_OFFSET_FINGERPRINT = "system:auto-offset";

function nextTier(tier: Tier): Tier {
  return TIERS[Math.min(TIER_RANK[tier] + 1, TIERS.length - 1)];
}

/**
 * Run promotion rules for a revision after a signal insert.
 *
 * Rule A: >= 3 positive signals (explicit_up / clean_playthrough) from
 * distinct fingerprints since the last promotion, and no explicit_down in
 * the past 7 days -> promote one tier (capped at verified).
 *
 * Rule B: >= 3 offset_correction signals from distinct fingerprints, newer
 * than the latest auto-correction child, all within +-150ms of their
 * median -> create a `correction` revision with the median offset applied.
 *
 * Returns what happened so callers/tests can assert on it.
 */
export async function runPromotionChecks(
  db: Db,
  revisionId: number,
  now: number = Date.now()
): Promise<{ promoted: boolean; correctionRevisionId: number | null }> {
  const [revision] = await db.select().from(revisions).where(eq(revisions.id, revisionId));
  if (!revision || revision.status !== "active") {
    return { promoted: false, correctionRevisionId: null };
  }

  const revisionSignals = await db
    .select()
    .from(signals)
    .where(eq(signals.revisionId, revisionId));

  const promoted = await checkTierPromotion(db, revision, revisionSignals, now);
  const correctionRevisionId = await checkOffsetCorrection(db, revision, revisionSignals, now);

  if (promoted || correctionRevisionId !== null) {
    await computeBestRevision(db, revision.trackId);
  }
  return { promoted, correctionRevisionId };
}

async function checkTierPromotion(
  db: Db,
  revision: Revision,
  revisionSignals: (typeof signals.$inferSelect)[],
  now: number
): Promise<boolean> {
  if (revision.tier === "verified") return false;

  const since = revision.promotedAt ?? 0;
  const positiveFingerprints = new Set(
    revisionSignals
      .filter(
        (s) =>
          (s.type === "explicit_up" || s.type === "clean_playthrough") &&
          s.createdAt > since
      )
      .map((s) => s.fingerprint)
  );
  if (positiveFingerprints.size < PROMOTION_THRESHOLD) return false;

  const recentDown = revisionSignals.some(
    (s) => s.type === "explicit_down" && s.createdAt > now - RECENT_DOWN_WINDOW_MS
  );
  if (recentDown) return false;

  await db
    .update(revisions)
    .set({ tier: nextTier(revision.tier), promotedAt: now })
    .where(eq(revisions.id, revision.id));
  return true;
}

async function checkOffsetCorrection(
  db: Db,
  revision: Revision,
  revisionSignals: (typeof signals.$inferSelect)[],
  now: number
): Promise<number | null> {
  // Only count offset signals newer than the latest auto-correction child,
  // so a batch of agreeing signals triggers exactly one correction.
  const [latestAutoChild] = await db
    .select()
    .from(revisions)
    .where(
      and(
        eq(revisions.parentRevisionId, revision.id),
        eq(revisions.source, "correction"),
        eq(revisions.submitterFingerprint, AUTO_OFFSET_FINGERPRINT)
      )
    )
    .orderBy(desc(revisions.createdAt), desc(revisions.id))
    .limit(1);
  const since = latestAutoChild?.createdAt ?? 0;

  // One offset value per fingerprint (latest wins).
  const byFingerprint = new Map<string, number>();
  for (const s of revisionSignals) {
    if (s.type === "offset_correction" && s.value !== null && s.createdAt > since) {
      byFingerprint.set(s.fingerprint, s.value);
    }
  }
  if (byFingerprint.size < PROMOTION_THRESHOLD) return null;

  const values = [...byFingerprint.values()];
  const mid = median(values);
  const agreeing = values.filter((v) => Math.abs(v - mid) <= OFFSET_AGREEMENT_MS);
  if (agreeing.length < PROMOTION_THRESHOLD) return null;

  const payload = validatePayload(JSON.parse(revision.payload));
  const corrected = applyOffset(payload, median(agreeing));

  const [inserted] = await db
    .insert(revisions)
    .values({
      trackId: revision.trackId,
      source: "correction",
      tier: "community",
      payload: JSON.stringify(corrected),
      parentRevisionId: revision.id,
      submitterFingerprint: AUTO_OFFSET_FINGERPRINT,
      status: "active",
      createdAt: now,
    })
    .returning();
  return inserted.id;
}
