import "./load-env";
import { readFileSync } from "node:fs";
import { getDb } from "../lib/db/client";
import { findOrCreateTrack, insertRevision } from "../lib/db/queries";
import { validatePayload } from "../lib/formats";

/**
 * Import a worker/align.py payload as an auto_aligned revision.
 *
 *   npx tsx scripts/import-aligned.ts --artist "Rasta" --track "Tajland" \
 *     --duration 174 [--album "..."] --payload payload.json
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const artist = arg("artist");
  const track = arg("track");
  const duration = parseFloat(arg("duration") ?? "");
  const payloadPath = arg("payload");
  const album = arg("album") ?? null;

  if (!artist || !track || !Number.isFinite(duration) || !payloadPath) {
    console.error(
      'Usage: npx tsx scripts/import-aligned.ts --artist "..." --track "..." --duration SECONDS --payload payload.json [--album "..."]'
    );
    process.exit(1);
  }

  const payload = validatePayload(JSON.parse(readFileSync(payloadPath, "utf-8")));
  const db = getDb();
  const trackRow = await findOrCreateTrack(db, {
    artistName: artist,
    trackName: track,
    albumName: album,
    durationSeconds: duration,
  });

  const revision = await insertRevision(db, {
    trackId: trackRow.id,
    source: "auto_aligned",
    tier: "auto_aligned",
    payload,
    submitterFingerprint: "system:offline-align",
  });

  console.log(
    `Imported revision #${revision.id} (status ${revision.status}) on track #${trackRow.id} — ` +
      `${payload.lines.length} lines, word timing: ${payload.meta.has_word_timing}`
  );
  console.log(`View it: http://localhost:3000/track/${trackRow.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
