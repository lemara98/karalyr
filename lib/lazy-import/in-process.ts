import { importFromLrclib } from "./lrclib";
import type { JobQueue, LazyImportParams } from "./queue";

const NEGATIVE_CACHE_MS = 10 * 60 * 1000;

/**
 * Fire-and-forget in-process queue. Dedupes concurrent fetches for the same
 * track and remembers misses for 10 minutes so repeated 404s don't hammer
 * the upstream LRCLIB instance.
 */
class InProcessQueue implements JobQueue {
  private inFlight = new Set<string>();
  private recentAttempts = new Map<string, number>();

  enqueueLrclibImport(params: LazyImportParams): void {
    const key = [
      params.artistName.toLowerCase(),
      params.trackName.toLowerCase(),
      params.albumName?.toLowerCase() ?? "",
      params.durationSeconds != null ? Math.round(params.durationSeconds) : "",
    ].join("|");

    const attempted = this.recentAttempts.get(key);
    if (attempted !== undefined && Date.now() - attempted < NEGATIVE_CACHE_MS) return;
    if (this.inFlight.has(key)) return;

    this.inFlight.add(key);
    importFromLrclib(params)
      .catch((err) => {
        console.error(`[lazy-import] failed for ${key}:`, err);
      })
      .finally(() => {
        this.inFlight.delete(key);
        this.recentAttempts.set(key, Date.now());
        // Keep the negative cache bounded.
        if (this.recentAttempts.size > 5000) {
          const cutoff = Date.now() - NEGATIVE_CACHE_MS;
          for (const [k, t] of this.recentAttempts) {
            if (t < cutoff) this.recentAttempts.delete(k);
          }
        }
      });
  }
}

const globalForQueue = globalThis as unknown as { __karalyrQueue?: JobQueue };

export function getJobQueue(): JobQueue {
  if (!globalForQueue.__karalyrQueue) globalForQueue.__karalyrQueue = new InProcessQueue();
  return globalForQueue.__karalyrQueue;
}
