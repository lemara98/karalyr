import type { KeyValueStore } from "./kv";
import { TursoStore } from "./turso";

export type { KeyValueStore } from "./kv";

// One store per process. The instance is cheap (it holds only a sweep
// counter); caching it just avoids re-resolving the db handle per request.
const globalForStore = globalThis as unknown as { __karalyrKv?: KeyValueStore };

/**
 * The shared store behind every rate limit and the proof-of-work replay
 * guard. Database-backed on purpose: both are only meaningful when all
 * instances see the same counters, so a per-process map silently multiplies
 * limits by the instance count and lets solved PoW challenges be replayed.
 *
 * MemoryStore is kept in ./memory for tests and benchmarks that want a store
 * with no database behind it, but nothing in the app should reach for it.
 */
export function getKvStore(): KeyValueStore {
  if (!globalForStore.__karalyrKv) globalForStore.__karalyrKv = new TursoStore();
  return globalForStore.__karalyrKv;
}
