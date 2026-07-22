import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/stores/memory";
import { TursoStore } from "@/lib/stores/turso";
import type { KeyValueStore } from "@/lib/stores/kv";
import {
  createChallenge,
  difficultyBits,
  difficultyTarget,
  hashMeetsTarget,
  verifyAndConsumeSolution,
} from "@/lib/pow";
import { makeDb } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await makeDb();
});

// The database store must behave exactly like the in-memory one it replaces,
// so both run the same suite.
const IMPLEMENTATIONS: [string, () => KeyValueStore][] = [
  ["MemoryStore", () => new MemoryStore()],
  ["TursoStore", () => new TursoStore(db)],
];

describe.each(IMPLEMENTATIONS)("%s", (_name, make) => {
  it("returns null for a key that was never set", async () => {
    expect(await make().get("nope")).toBeNull();
  });

  it("round-trips a value", async () => {
    const s = make();
    await s.set("k", "v", 60_000);
    expect(await s.get("k")).toBe("v");
  });

  it("treats an expired key as absent", async () => {
    const s = make();
    await s.set("k", "v", -1); // already in the past
    expect(await s.get("k")).toBeNull();
  });

  it("set overwrites an existing key", async () => {
    const s = make();
    await s.set("k", "first", 60_000);
    await s.set("k", "second", 60_000);
    expect(await s.get("k")).toBe("second");
  });

  it("incr counts up from 1", async () => {
    const s = make();
    expect(await s.incr("c", 60_000)).toBe(1);
    expect(await s.incr("c", 60_000)).toBe(2);
    expect(await s.incr("c", 60_000)).toBe(3);
  });

  it("incr keeps the original window instead of sliding it", async () => {
    // A fixed window is the point: if every hit pushed the expiry out, a
    // steady stream of requests would never let the limit reset.
    const s = make();
    await s.incr("c", 40); // expires ~40ms from now
    await s.incr("c", 40);
    await new Promise((r) => setTimeout(r, 60));
    expect(await s.incr("c", 40)).toBe(1); // window elapsed → restarted
  });

  it("incr restarts after expiry rather than resuming", async () => {
    const s = make();
    await s.incr("c", -1);
    expect(await s.incr("c", 60_000)).toBe(1);
  });

  it("counters are independent per key", async () => {
    const s = make();
    await s.incr("a", 60_000);
    await s.incr("a", 60_000);
    expect(await s.incr("b", 60_000)).toBe(1);
  });

  it("enforces a rate limit through checkRateLimit", async () => {
    const s = make();
    const hits = [];
    for (let i = 0; i < 5; i++) hits.push(await checkRateLimit(s, "user", 3, 60_000));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, true, false, false]);
    expect(hits[0].remaining).toBe(2);
  });

  it("consumes a proof-of-work solution exactly once", async () => {
    // The replay guard is the whole reason this store has to be shared: the
    // challenge itself is a stateless HMAC, so only this entry stops a solved
    // nonce being reused.
    const s = make();
    const key = "pow-used:abc123";
    expect(await s.get(key)).toBeNull();
    await s.set(key, "1", 60_000);
    expect(await s.get(key)).not.toBeNull();
  });
});

describe("TursoStore concurrency", () => {
  it("loses no increments when callers race", async () => {
    // Read-then-write would let two callers both read 9 and both write 10 —
    // exactly the race a rate limit exists to lose. A single upsert cannot.
    const s = new TursoStore(db);
    const results = await Promise.all(
      Array.from({ length: 25 }, () => s.incr("hot", 60_000))
    );
    expect(results.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1)
    );
  });

  it("shares state across instances, the way separate servers would", async () => {
    // Two TursoStore objects stand in for two app instances on one database.
    const a = new TursoStore(db);
    const b = new TursoStore(db);
    await a.incr("shared", 60_000);
    expect(await b.incr("shared", 60_000)).toBe(2);

    await a.set("pow-used:xyz", "1", 60_000);
    expect(await b.get("pow-used:xyz")).toBe("1"); // replay refused on B
  });

  it("sweeps expired rows so the table cannot grow forever", async () => {
    const s = new TursoStore(db);
    for (let i = 0; i < 40; i++) await s.set(`dead:${i}`, "x", -1);
    // The sweep is amortized (every 500 ops), so drive it directly.
    for (let i = 0; i < 500; i++) await s.get("probe");
    const [row] = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM kv_entries WHERE expires_at <= ${Date.now()}`
    );
    expect(row.n).toBe(0);
  });
});

describe("pow replay guard, end to end", () => {
  it("refuses a second use of the same solved challenge", async () => {
    process.env.POW_SECRET = "test-secret";
    process.env.POW_DIFFICULTY = "4"; // trivial to solve, keeps the test fast

    const challenge = createChallenge();
    const target = difficultyTarget(difficultyBits());
    let nonce = "";
    for (let i = 0; ; i++) {
      const hash = createHash("sha256").update(challenge.prefix + i).digest("hex");
      if (hashMeetsTarget(hash, target)) {
        nonce = String(i);
        break;
      }
    }

    const store = new TursoStore(db);
    expect((await verifyAndConsumeSolution(store, challenge.prefix, nonce)).ok).toBe(true);

    // Same solved nonce again — the only thing refusing it is the store entry.
    const replay = await verifyAndConsumeSolution(store, challenge.prefix, nonce);
    expect(replay.ok).toBe(false);
    expect(replay.ok === false && replay.reason).toBe("already_used");
  });

  it("a second instance also refuses the replay (what memory could not do)", async () => {
    process.env.POW_SECRET = "test-secret";
    process.env.POW_DIFFICULTY = "4";

    const challenge = createChallenge();
    const target = difficultyTarget(difficultyBits());
    let nonce = "";
    for (let i = 0; ; i++) {
      const hash = createHash("sha256").update(challenge.prefix + i).digest("hex");
      if (hashMeetsTarget(hash, target)) {
        nonce = String(i);
        break;
      }
    }

    const instanceA = new TursoStore(db);
    const instanceB = new TursoStore(db);
    expect((await verifyAndConsumeSolution(instanceA, challenge.prefix, nonce)).ok).toBe(true);

    // With MemoryStore these are separate maps and B would happily accept it.
    const onB = await verifyAndConsumeSolution(instanceB, challenge.prefix, nonce);
    expect(onB.ok === false && onB.reason).toBe("already_used");
  });
});
