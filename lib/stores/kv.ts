/**
 * Minimal key-value seam used by the rate limiter and the PoW replay guard.
 * The in-memory implementation works for a single local/VPS process; swap in
 * a Turso- or Redis-backed implementation for multi-instance deployments.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  /** Set with a TTL; the key expires after ttlMs. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Atomically increment a counter, creating it with the TTL if absent. Returns the new value. */
  incr(key: string, ttlMs: number): Promise<number>;
}
