/**
 * Background job seam. Locally jobs run in-process (fire-and-forget); in a
 * bigger deployment this interface can be backed by a real queue without
 * touching the route handlers.
 */
export interface LazyImportParams {
  artistName: string;
  trackName: string;
  albumName?: string | null;
  durationSeconds?: number | null;
}

export interface JobQueue {
  enqueueLrclibImport(params: LazyImportParams): void;
}
