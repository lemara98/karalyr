/**
 * Rights complaints: recording them, and removing what they point at.
 *
 * Karalyr hosts lyric text submitted by contributors, and lyric text is a
 * copyrighted work in its own right - separate from any recording, and not
 * covered by crediting the writer (see the README's legal posture). The
 * position that holds for a contribution-driven site is to act on notice and
 * be able to show that you did, so:
 *
 *   - every notice is stored, actioned or not, with the reasoning
 *   - a takedown *purges the payload* rather than hiding it
 *   - repeat submitters can actually be blocked, on the publish path
 *
 * The purge is the part that matters and the part that is irreversible.
 * Flipping a status while keeping the words on disk is not a removal; it is a
 * removal you would have to explain. `taken_down` rows survive only as an
 * audit trail: which revision, whose complaint, who actioned it, when.
 */

import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  blockedSubmitters,
  chordCharts,
  revisions,
  takedownNotices,
  type TakedownNotice,
} from "./db/schema";
import { computeBestRevision } from "./ranking";

/**
 * Where notices reach a human. Single source of truth - it appears on the
 * public page and in the API errors that tell someone to write in.
 *
 * A role alias (takedown@karalyr.com) would be better practice than a
 * personal address: it survives staff changes and can be forwarded. This uses
 * the address already published on /sponsors because a contact that bounces
 * is far worse than one that is merely personal - swap it here once the alias
 * exists, and nothing else needs touching.
 *
 * Publishing this at all is the point. Karalyr deploys on Vercel, and a
 * rightsholder who cannot find the operator complains to the host instead -
 * which takes the whole deployment down rather than one revision.
 */
export const TAKEDOWN_EMAIL = "milan.knezevic@betania.io";

/**
 * What replaces a purged payload. Structurally valid so nothing downstream
 * has to special-case parsing it, and inert: `has_word_timing: false` means
 * even a status bug can't get it ranked (lib/ranking.ts requires both).
 */
export const TOMBSTONE_PAYLOAD = JSON.stringify({
  format_version: 1,
  lines: [],
  meta: {
    language: null,
    has_word_timing: false,
    countdown_lines: [],
    taken_down: true,
  },
});

/**
 * Chord-chart tombstone, same idea: structurally valid (empty segments pass
 * chordChartSchema; the import path is what refuses empties), inert, and
 * never served — getActiveChordChart filters on "active".
 */
export const CHORD_TOMBSTONE_PAYLOAD = JSON.stringify({
  format_version: 1,
  segments: [],
  meta: {
    model: "removed",
    dict: "removed",
    key_pc: null,
    key_mode: null,
    analyzed_from: "original_mix",
    duration_ms: 0,
    taken_down: true,
  },
});

export interface NoticeInput {
  claimantName: string;
  claimantEmail: string;
  claimantOrg?: string | null;
  claimantRole: string;
  workDescription: string;
  complainedOf: string;
  trackId?: number | null;
}

/** Log a complaint. Nothing is removed until an admin actions it. */
export async function recordNotice(
  db: Db,
  input: NoticeInput
): Promise<TakedownNotice> {
  const [notice] = await db
    .insert(takedownNotices)
    .values({
      claimantName: input.claimantName.trim(),
      claimantEmail: input.claimantEmail.trim(),
      claimantOrg: input.claimantOrg?.trim() || null,
      claimantRole: input.claimantRole.trim(),
      workDescription: input.workDescription.trim(),
      complainedOf: input.complainedOf.trim(),
      trackId: input.trackId ?? null,
      status: "received",
    })
    .returning();
  return notice;
}

/**
 * Remove the named revisions and close the notice.
 *
 * Irreversible: the lyric payloads are overwritten, not flagged. Returns the
 * revisions actually purged - ids that don't exist, or were already taken
 * down, are skipped rather than failing the whole action, so a re-run after a
 * partial failure finishes the job instead of refusing.
 */
export async function actionTakedown(
  db: Db,
  opts: {
    noticeId: number;
    revisionIds: number[];
    actor: string;
    resolution?: string | null;
    now?: number;
    /**
     * Chord charts named by the notice. Deliberately NOT auto-cascaded from
     * the revisions: lyric text and a chord transcription are different
     * claimed works, and a notice about one says nothing about the other.
     * The admin lists chart ids when the complaint covers the composition.
     */
    chordChartIds?: number[];
  }
): Promise<{
  notice: TakedownNotice;
  removed: number[];
  removedChordCharts: number[];
  tracksRecomputed: number[];
}> {
  const now = opts.now ?? Date.now();

  const targets = opts.revisionIds.length
    ? await db
        .select()
        .from(revisions)
        .where(inArray(revisions.id, opts.revisionIds))
    : [];
  const removable = targets.filter((r) => r.status !== "taken_down");

  if (removable.length > 0) {
    await db
      .update(revisions)
      .set({ status: "taken_down", payload: TOMBSTONE_PAYLOAD })
      .where(inArray(revisions.id, removable.map((r) => r.id)));
  }

  // Chord charts named by the notice get the same treatment: payload purged,
  // status terminal. No winner to recompute — getActiveChordChart just stops
  // finding them — and lib/chord-import.ts refuses re-uploads while any
  // taken_down chart exists for the track.
  const chartIds = opts.chordChartIds ?? [];
  const chartTargets = chartIds.length
    ? await db.select().from(chordCharts).where(inArray(chordCharts.id, chartIds))
    : [];
  const chartRemovable = chartTargets.filter((c) => c.status !== "taken_down");
  if (chartRemovable.length > 0) {
    await db
      .update(chordCharts)
      .set({ status: "taken_down", payload: CHORD_TOMBSTONE_PAYLOAD })
      .where(inArray(chordCharts.id, chartRemovable.map((c) => c.id)));
  }

  // Every affected track needs its winner re-picked - the removed revision
  // may well have been it, and `tracks.best_revision_id` is what reads hit.
  const trackIds = [...new Set(targets.map((r) => r.trackId))];
  for (const trackId of trackIds) await computeBestRevision(db, trackId);

  const removed = removable.map((r) => r.id);
  const removedChordCharts = chartRemovable.map((c) => c.id);
  const noticeTrackIds = [
    ...new Set([...trackIds, ...chartTargets.map((c) => c.trackId)]),
  ];
  const [notice] = await db
    .update(takedownNotices)
    .set({
      status: "actioned",
      removedRevisionIds: JSON.stringify(removed),
      resolution: [
        opts.resolution?.trim() || null,
        removedChordCharts.length
          ? `Removed chord charts: ${removedChordCharts.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      actionedBy: opts.actor,
      actionedAt: now,
      // Resolve the notice onto a track when it named exactly one, so the
      // record points somewhere specific later.
      ...(noticeTrackIds.length === 1 ? { trackId: noticeTrackIds[0] } : {}),
    })
    .where(eq(takedownNotices.id, opts.noticeId))
    .returning();

  return { notice, removed, removedChordCharts, tracksRecomputed: trackIds };
}

/** Close a notice without removing anything. The reason is not optional. */
export async function declineNotice(
  db: Db,
  opts: { noticeId: number; actor: string; resolution: string; now?: number }
): Promise<TakedownNotice | null> {
  const [notice] = await db
    .update(takedownNotices)
    .set({
      status: "declined",
      resolution: opts.resolution.trim(),
      actionedBy: opts.actor,
      actionedAt: opts.now ?? Date.now(),
    })
    .where(eq(takedownNotices.id, opts.noticeId))
    .returning();
  return notice ?? null;
}

/** How many of this submitter's revisions have been taken down. */
export async function strikeCount(db: Db, fingerprint: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(revisions)
    .where(
      and(
        eq(revisions.submitterFingerprint, fingerprint),
        eq(revisions.status, "taken_down")
      )
    );
  return row?.n ?? 0;
}

/** Block a submitter from publishing. Records the strike count as evidence. */
export async function blockSubmitter(
  db: Db,
  opts: { fingerprint: string; reason: string; actor: string }
): Promise<void> {
  const strikes = await strikeCount(db, opts.fingerprint);
  await db
    .insert(blockedSubmitters)
    .values({
      fingerprint: opts.fingerprint,
      reason: opts.reason.trim(),
      strikes,
      blockedBy: opts.actor,
    })
    .onConflictDoUpdate({
      target: blockedSubmitters.fingerprint,
      set: { reason: opts.reason.trim(), strikes, blockedBy: opts.actor },
    });
}

export async function unblockSubmitter(db: Db, fingerprint: string): Promise<void> {
  await db.delete(blockedSubmitters).where(eq(blockedSubmitters.fingerprint, fingerprint));
}

/** Publish-path guard. Cheap indexed lookup on the primary key. */
export async function isBlockedSubmitter(db: Db, fingerprint: string): Promise<boolean> {
  const [row] = await db
    .select({ fingerprint: blockedSubmitters.fingerprint })
    .from(blockedSubmitters)
    .where(eq(blockedSubmitters.fingerprint, fingerprint));
  return !!row;
}

export async function listNotices(db: Db, limit = 100): Promise<TakedownNotice[]> {
  return db
    .select()
    .from(takedownNotices)
    .orderBy(desc(takedownNotices.createdAt))
    .limit(limit);
}
