import "./load-env";
import { getDb } from "../lib/db/client";
import { cleanupLrclibImports } from "../lib/cleanup-lrclib";

/**
 * Remove the retired LRCLIB lazy-import data. Dry-run by default; nothing is
 * written until --apply. Tracks with a linked video become wanted-queue
 * requests; the rest are deleted (see lib/cleanup-lrclib.ts).
 *
 *   npx tsx scripts/cleanup-lrclib.ts            # dry-run, prints the plan
 *   npx tsx scripts/cleanup-lrclib.ts --apply    # execute
 *
 * Against production (Turso), override the env:
 *   DATABASE_URL="libsql://…" DATABASE_AUTH_TOKEN="…" npx tsx scripts/cleanup-lrclib.ts
 *
 * Back up first: scripts/backup-db.sh (Turso) or copy data/karalyr.db.
 */

function has(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

async function main() {
  const apply = has("apply");
  const db = getDb();
  const summary = await cleanupLrclibImports(db, { dryRun: !apply });

  for (const line of summary.actions) console.log(line);
  console.log("");
  console.log(`Tracks with lrclib imports: ${summary.tracksScanned}`);
  console.log(`Revisions ${apply ? "deleted" : "to delete"}:      ${summary.revisionsDeleted}`);
  console.log(`Tracks ${apply ? "deleted" : "to delete"}:         ${summary.tracksDeleted} (${summary.deletedNoVideo} had no video link)`);
  console.log(`Tracks kept:                ${summary.tracksKept}`);
  if (apply) {
    console.log(`Wanted requests created:    ${summary.jobsCreated}`);
    console.log(`Votes on existing requests: ${summary.votesRecorded}`);
    console.log(`Already synced elsewhere:   ${summary.alreadySynced}`);
    console.log(`Rejected (short lyrics):    ${summary.badLyrics}`);
  } else {
    console.log("\nDry run — nothing was written. Re-run with --apply to execute.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
