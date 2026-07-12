import type { KeyValueStore } from "./kv";

interface Entry {
  value: string;
  expiresAt: number;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, Entry>();
  private ops = 0;

  private sweepIfNeeded() {
    // Amortized cleanup instead of timers, so this is serverless-safe.
    if (++this.ops % 500 !== 0) return;
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.sweepIfNeeded();
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.sweepIfNeeded();
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    const current = await this.get(key);
    if (current === null) {
      this.map.set(key, { value: "1", expiresAt: Date.now() + ttlMs });
      return 1;
    }
    const next = parseInt(current, 10) + 1;
    // Keep the original expiry (fixed window).
    const entry = this.map.get(key)!;
    entry.value = String(next);
    return next;
  }
}

// One store per process, surviving dev hot reloads.
const globalForStore = globalThis as unknown as { __karalyrKv?: MemoryStore };

export function getKvStore(): KeyValueStore {
  if (!globalForStore.__karalyrKv) globalForStore.__karalyrKv = new MemoryStore();
  return globalForStore.__karalyrKv;
}
