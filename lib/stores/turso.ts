import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import type { KeyValueStore } from "./kv";

/**
 * Database-backed KeyValueStore (see kv_entries in lib/db/schema.ts).
 *
 * The in-memory implementation is correct for exactly one process. On any
 * host that runs several — Vercel's serverless functions especially, where
 * the count is unbounded and cold starts wipe state — per-process counters
 * make rate limits meaningless and, worse, let a solved proof-of-work
 * challenge be replayed against any instance that has not seen it. Sharing
 * the state through the database we already have fixes both.
 *
 * Expiry is lazy: reads ignore rows whose expires_at has passed, and an
 * amortized sweep deletes them so the table cannot grow without bound.
 */
export class TursoStore implements KeyValueStore {
  private ops = 0;

  constructor(private readonly db: Db = getDb()) {}

  /** Delete expired rows occasionally rather than on every call. */
  private async sweepIfNeeded(now: number): Promise<void> {
    if (++this.ops % 500 !== 0) return;
    await this.db.run(sql`DELETE FROM kv_entries WHERE expires_at <= ${now}`);
  }

  async get(key: string): Promise<string | null> {
    const now = Date.now();
    const rows = await this.db.all<{ value: string }>(
      sql`SELECT value FROM kv_entries WHERE key = ${key} AND expires_at > ${now}`
    );
    await this.sweepIfNeeded(now);
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    const now = Date.now();
    await this.db.run(sql`
      INSERT INTO kv_entries (key, value, expires_at)
      VALUES (${key}, ${value}, ${now + ttlMs})
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at
    `);
    await this.sweepIfNeeded(now);
  }

  /**
   * Atomic fixed-window counter.
   *
   * One statement, because read-then-write would let two concurrent requests
   * both read 9 and both write 10 — which is precisely the race a rate limit
   * exists to lose. The CASE arms reproduce MemoryStore's semantics: a live
   * row increments and *keeps its original expiry* (so the window doesn't
   * slide forward on every hit), while an expired row restarts at 1 with a
   * fresh window.
   */
  async incr(key: string, ttlMs: number): Promise<number> {
    const now = Date.now();
    const expiry = now + ttlMs;
    const rows = await this.db.all<{ value: string }>(sql`
      INSERT INTO kv_entries (key, value, expires_at)
      VALUES (${key}, '1', ${expiry})
      ON CONFLICT(key) DO UPDATE SET
        value = CASE
          WHEN kv_entries.expires_at <= ${now} THEN '1'
          ELSE CAST(CAST(kv_entries.value AS INTEGER) + 1 AS TEXT)
        END,
        expires_at = CASE
          WHEN kv_entries.expires_at <= ${now} THEN ${expiry}
          ELSE kv_entries.expires_at
        END
      RETURNING value
    `);
    await this.sweepIfNeeded(now);
    return parseInt(rows[0]?.value ?? "1", 10);
  }
}
