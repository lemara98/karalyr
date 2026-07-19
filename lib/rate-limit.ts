import type { KeyValueStore } from "./stores/kv";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/** Fixed-window rate limit: `limit` hits per `windowMs` for a key. */
export async function checkRateLimit(
  store: KeyValueStore,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const count = await store.incr(`rl:${key}`, windowMs);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export const RATE_LIMITS = {
  publish: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 publishes/hour/fingerprint
  signal: { limit: 30, windowMs: 60 * 60 * 1000 }, // 30 signals/hour/fingerprint
  challenge: { limit: 30, windowMs: 60 * 60 * 1000 },
  comment: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 comments/hour/user (Supabase uid)
  syncQueueIntake: { limit: 20, windowMs: 24 * 60 * 60 * 1000 }, // 20 sync requests/day/user via the karafilt.com proxy
  syncQueueSubmit: { limit: 10, windowMs: 24 * 60 * 60 * 1000 }, // 10 sync requests/day/user on the website
} as const;
