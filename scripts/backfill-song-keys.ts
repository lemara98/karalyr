import "./load-env";
import { inArray } from "drizzle-orm";
import { getDb } from "../lib/db/client";
import { syncJobs, SYNC_JOB_ACTIVE_STATUSES } from "../lib/db/schema";
import { songKey } from "../lib/song-key";

/**
 * One-off: recompute sync_jobs.song_key after the non-Latin fix in
 * lib/song-key.ts. Old keys erased whole scripts, so every Devanagari/Thai/
 * Han request collided on the key "|". Recomputes active rows only (finished
 * rows keep their historical key - nothing dedups against them). When two
 * active rows now normalize to the same key (they were true duplicates all
 * along), the OLDER row keeps the key and the newer ones are logged for
 * manual review - no automatic vote merging.
 *
 * Run with a verified backup: npx tsx scripts/backfill-song-keys.ts
 * Dry run (default): shows what would change. Apply with --apply.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  const rows = await db
    .select({
      id: syncJobs.id,
      artistName: syncJobs.artistName,
      trackName: syncJobs.trackName,
      songKey: syncJobs.songKey,
      createdAt: syncJobs.createdAt,
    })
    .from(syncJobs)
    .where(inArray(syncJobs.status, [...SYNC_JOB_ACTIVE_STATUSES]));

  const taken = new Map<string, number>(); // new key -> keeper job id
  const updates: { id: number; from: string; to: string }[] = [];
  const conflicts: { id: number; keeperId: number; key: string }[] = [];

  for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt)) {
    const next = songKey(row.artistName, row.trackName);
    const keeper = taken.get(next);
    if (keeper !== undefined) {
      conflicts.push({ id: row.id, keeperId: keeper, key: next });
      continue;
    }
    taken.set(next, row.id);
    if (next !== row.songKey) updates.push({ id: row.id, from: row.songKey, to: next });
  }

  console.log(`${rows.length} active jobs; ${updates.length} keys change; ${conflicts.length} true duplicates.`);
  for (const u of updates) console.log(`  #${u.id}: "${u.from}" -> "${u.to}"`);
  for (const c of conflicts)
    console.log(`  DUPLICATE #${c.id} of #${c.keeperId} ("${c.key}") - merge or cancel manually`);

  if (!apply) {
    console.log("Dry run - re-run with --apply to write.");
    return;
  }
  for (const u of updates) {
    await db.update(syncJobs).set({ songKey: u.to }).where(inArray(syncJobs.id, [u.id]));
  }
  console.log(`Updated ${updates.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
