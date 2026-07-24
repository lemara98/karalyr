import "./load-env";
import { getDb } from "../lib/db/client";
import { revisions, signals, tracks } from "../lib/db/schema";
import type { Line, LyricsPayload } from "../lib/formats";
import { computeBestRevision } from "../lib/ranking";

const db = getDb();
const now = Date.now();
const HOUR = 60 * 60 * 1000;

/** Build evenly timed, word-synced lines from plain text. */
function timedPayload(
  lyricLines: (string | { text: string; singer?: "P1" | "P2" | "BOTH" })[],
  opts: { startMs?: number; lineMs?: number } = {}
): LyricsPayload {
  const { startMs = 4000, lineMs = 4000 } = opts;
  const lines: Line[] = lyricLines.map((entry, i) => {
    const text = typeof entry === "string" ? entry : entry.text;
    const singer = typeof entry === "string" ? null : entry.singer ?? null;
    const start = startMs + i * lineMs;
    const end = start + lineMs - 400;
    const line: Line = { start_ms: start, end_ms: end, singer, text };
    const parts = text.split(" ").filter(Boolean);
    const per = Math.floor((end - start) / Math.max(parts.length, 1));
    line.words = parts.map((w, j) => ({
      text: w,
      start_ms: start + j * per,
      end_ms: j + 1 === parts.length ? end : start + (j + 1) * per,
    }));
    return line;
  });
  return {
    format_version: 1,
    lines,
    meta: { language: "en", has_word_timing: true, countdown_lines: [] },
  };
}

async function main() {
  const existing = await db.select().from(tracks).limit(1);
  if (existing.length > 0) {
    console.log("Database already has tracks; skipping seed. Delete data/karalyr.db and re-migrate to reseed.");
    return;
  }

  // All lyrics below are original placeholder verses written for testing.

  // 1. Basic word-level community submission.
  const [t1] = await db.insert(tracks).values({
    artistName: "The Placeholder Trio",
    trackName: "Counting Streetlights",
    albumName: "Test Patterns",
    durationSeconds: 195,
    createdAt: now - 40 * HOUR,
  }).returning();
  await db.insert(revisions).values({
    trackId: t1.id,
    source: "user_submission",
    tier: "community",
    payload: JSON.stringify(
      timedPayload([
        "Counting streetlights on the way back home",
        "Every second one is burning low",
        "I keep time with cracks along the road",
        "Humming songs that nobody wrote",
      ])
    ),
    submitterFingerprint: "seed:user-0",
    status: "active",
    createdAt: now - 40 * HOUR,
  });

  // 2. Word-level community submission.
  const [t2] = await db.insert(tracks).values({
    artistName: "Neon Practice",
    trackName: "Refactor My Heart",
    albumName: null,
    durationSeconds: 212,
    createdAt: now - 30 * HOUR,
  }).returning();
  await db.insert(revisions).values({
    trackId: t2.id,
    source: "user_submission",
    tier: "community",
    payload: JSON.stringify(
      timedPayload([
        "You rewrote my logic line by line",
        "Deleted every bug I called mine",
        "Now my loops all terminate on time",
        "Refactor my heart one more time",
      ])
    ),
    submitterFingerprint: "seed:user-1",
    status: "active",
    createdAt: now - 30 * HOUR,
  });

  // 3. Duet with P1/P2/BOTH.
  const [t3] = await db.insert(tracks).values({
    artistName: "Two Cursors",
    trackName: "Merge Conflict",
    albumName: "Version Control",
    durationSeconds: 188,
    createdAt: now - 25 * HOUR,
  }).returning();
  await db.insert(revisions).values({
    trackId: t3.id,
    source: "ultrastar_import",
    tier: "community",
    payload: JSON.stringify(
      timedPayload([
        { text: "I changed the ending of our song", singer: "P1" },
        { text: "I changed the very same line too", singer: "P2" },
        { text: "Now the chorus won't merge clean", singer: "P1" },
        { text: "Whose version of us is true", singer: "P2" },
        { text: "We resolve it singing both", singer: "BOTH" },
      ])
    ),
    submitterFingerprint: "seed:ultrastar",
    status: "active",
    createdAt: now - 25 * HOUR,
  });

  // 4. Verified track with a pending_review edit against it.
  const [t4] = await db.insert(tracks).values({
    artistName: "Golden Master",
    trackName: "Ship It Tonight",
    albumName: "Release Notes",
    durationSeconds: 240,
    createdAt: now - 20 * HOUR,
  }).returning();
  const [t4verified] = await db.insert(revisions).values({
    trackId: t4.id,
    source: "user_submission",
    tier: "verified",
    payload: JSON.stringify(
      timedPayload([
        "Freeze the branch the sun is going down",
        "Every test is green across the town",
        "Tag the moment hold your breath and then",
        "Ship it tonight and start again",
      ])
    ),
    submitterFingerprint: "seed:user-2",
    status: "active",
    createdAt: now - 20 * HOUR,
    promotedAt: now - 19 * HOUR,
  }).returning();
  await db.insert(revisions).values({
    trackId: t4.id,
    source: "correction",
    tier: "community",
    payload: JSON.stringify(
      timedPayload(
        [
          "Freeze the branch the sun is going down",
          "Every test is green across the town",
          "Tag the moment hold your breath and then",
          "Ship it tonight and start it all again",
        ],
        { startMs: 4200 }
      )
    ),
    parentRevisionId: t4verified.id,
    submitterFingerprint: "seed:user-3",
    status: "pending_review",
    createdAt: now - 2 * HOUR,
  });

  // 5. Multiple revisions + mixed signals (exercises ranking within a tier).
  const [t5] = await db.insert(tracks).values({
    artistName: "The Placeholder Trio",
    trackName: "Static in the Chorus",
    albumName: "Test Patterns",
    durationSeconds: 205,
    createdAt: now - 15 * HOUR,
  }).returning();
  const t5lines = [
    "There's static in the chorus again",
    "A hiss where the harmony has been",
    "Turn the dial until it sings",
    "Clean signal covers everything",
  ];
  const [t5v1] = await db.insert(revisions).values({
    trackId: t5.id,
    source: "auto_aligned",
    tier: "auto_aligned",
    payload: JSON.stringify(timedPayload(t5lines)),
    submitterFingerprint: "seed:auto",
    status: "active",
    createdAt: now - 15 * HOUR,
  }).returning();
  const [t5v2] = await db.insert(revisions).values({
    trackId: t5.id,
    source: "user_submission",
    tier: "community",
    payload: JSON.stringify(timedPayload(t5lines, { startMs: 3800 })),
    submitterFingerprint: "seed:user-4",
    status: "active",
    createdAt: now - 10 * HOUR,
  }).returning();
  const [t5v3] = await db.insert(revisions).values({
    trackId: t5.id,
    source: "correction",
    tier: "community",
    payload: JSON.stringify(timedPayload(t5lines, { startMs: 4100 })),
    parentRevisionId: t5v2.id,
    submitterFingerprint: "seed:user-5",
    status: "active",
    createdAt: now - 5 * HOUR,
  }).returning();
  await db.insert(signals).values([
    { revisionId: t5v2.id, type: "explicit_up", fingerprint: "seed:fan-1", createdAt: now - 9 * HOUR },
    { revisionId: t5v2.id, type: "clean_playthrough", fingerprint: "seed:fan-2", createdAt: now - 8 * HOUR },
    { revisionId: t5v3.id, type: "explicit_down", fingerprint: "seed:fan-3", createdAt: now - 4 * HOUR },
    { revisionId: t5v1.id, type: "explicit_up", fingerprint: "seed:fan-1", createdAt: now - 9 * HOUR },
  ]);

  // 6. One positive signal away from a Rule A promotion, and one agreeing
  //    offset signal away from a Rule B auto-correction.
  const [t6] = await db.insert(tracks).values({
    artistName: "Neon Practice",
    trackName: "Almost There",
    albumName: null,
    durationSeconds: 176,
    createdAt: now - 12 * HOUR,
  }).returning();
  const [t6rev] = await db.insert(revisions).values({
    trackId: t6.id,
    source: "user_submission",
    tier: "community",
    payload: JSON.stringify(
      timedPayload([
        "Two more steps up to the door",
        "One more signal then we soar",
        "Everybody says the same",
        "Almost there is half the game",
      ])
    ),
    submitterFingerprint: "seed:user-6",
    status: "active",
    createdAt: now - 12 * HOUR,
  }).returning();
  await db.insert(signals).values([
    { revisionId: t6rev.id, type: "explicit_up", fingerprint: "seed:fan-4", createdAt: now - 11 * HOUR },
    { revisionId: t6rev.id, type: "clean_playthrough", fingerprint: "seed:fan-5", createdAt: now - 10 * HOUR },
    { revisionId: t6rev.id, type: "offset_correction", value: 180, fingerprint: "seed:fan-6", createdAt: now - 6 * HOUR },
    { revisionId: t6rev.id, type: "offset_correction", value: 220, fingerprint: "seed:fan-7", createdAt: now - 5 * HOUR },
  ]);

  // 7. Plain short track, no album.
  const [t7] = await db.insert(tracks).values({
    artistName: "Lone Variable",
    trackName: "Null Island",
    albumName: null,
    durationSeconds: 142,
    createdAt: now - 6 * HOUR,
  }).returning();
  await db.insert(revisions).values({
    trackId: t7.id,
    source: "user_submission",
    tier: "community",
    payload: JSON.stringify(
      timedPayload([
        "Meet me down at Null Island",
        "Zero north and zero east",
        "Where undefined can hold my hand",
        "And missing values rest in peace",
      ])
    ),
    submitterFingerprint: "seed:user-7",
    status: "active",
    createdAt: now - 6 * HOUR,
  });

  for (const t of [t1, t2, t3, t4, t5, t6, t7]) {
    await computeBestRevision(db, t.id);
  }

  const count = await db.select().from(tracks);
  console.log(`Seeded ${count.length} tracks.`);
  console.log(`Try: curl "http://localhost:3000/api/get?artist_name=Neon%20Practice&track_name=Refactor%20My%20Heart&duration=212"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
