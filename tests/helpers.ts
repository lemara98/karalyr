import { migrate } from "drizzle-orm/libsql/migrator";
import { createTestDb, type Db } from "@/lib/db/client";
import { revisions, signals, tracks, type Revision, type Signal } from "@/lib/db/schema";
import type { LyricsPayload } from "@/lib/formats";

export async function makeDb(): Promise<Db> {
  const db = createTestDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export function samplePayload(startMs = 1000): LyricsPayload {
  return {
    format_version: 1,
    lines: [
      {
        start_ms: startMs,
        end_ms: startMs + 2000,
        singer: null,
        text: "Test line one",
        words: [
          { text: "Test", start_ms: startMs, end_ms: startMs + 500 },
          { text: "line", start_ms: startMs + 500, end_ms: startMs + 1000 },
          { text: "one", start_ms: startMs + 1000, end_ms: startMs + 2000 },
        ],
      },
      {
        start_ms: startMs + 3000,
        end_ms: startMs + 5000,
        singer: null,
        text: "Second test line",
      },
    ],
    meta: { language: "en", has_word_timing: true, countdown_lines: [] },
  };
}

export async function makeTrack(db: Db, overrides: Partial<typeof tracks.$inferInsert> = {}) {
  const [track] = await db
    .insert(tracks)
    .values({
      artistName: "Test Artist",
      trackName: "Test Track",
      durationSeconds: 180,
      createdAt: Date.now(),
      ...overrides,
    })
    .returning();
  return track;
}

export async function makeRevision(
  db: Db,
  trackId: number,
  overrides: Partial<typeof revisions.$inferInsert> = {}
): Promise<Revision> {
  const [rev] = await db
    .insert(revisions)
    .values({
      trackId,
      source: "user_submission",
      tier: "community",
      payload: JSON.stringify(samplePayload()),
      submitterFingerprint: "fp-submitter",
      status: "active",
      createdAt: Date.now(),
      ...overrides,
    })
    .returning();
  return rev;
}

export async function makeSignal(
  db: Db,
  revisionId: number,
  overrides: Partial<typeof signals.$inferInsert> = {}
): Promise<Signal> {
  const [sig] = await db
    .insert(signals)
    .values({
      revisionId,
      type: "explicit_up",
      fingerprint: "fp-1",
      createdAt: Date.now(),
      ...overrides,
    })
    .returning();
  return sig;
}
