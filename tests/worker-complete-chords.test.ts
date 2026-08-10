import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { chordCharts } from "@/lib/db/schema";
import { enqueueSyncJob, moderateSyncJob, claimNextJob, type EnqueueInput } from "@/lib/sync-queue/core";
import { makeDb, sampleChordChart, samplePayload } from "./helpers";

// The /complete route with the optional chords field. The load-bearing rule:
// an invalid chart NEVER 400s the lyrics job (the daemon treats a /complete
// 400 as permanent failure), it is dropped with a warning.
let testDb: Db;

vi.mock("@/lib/db/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...orig, getDb: () => testDb };
});

const WORKER_TOKEN = "test-worker-token";
const T0 = 1_700_000_000_000;

async function processingJob(db: Db) {
  const input: EnqueueInput = {
    source: "website",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    artistName: "Complete Artist",
    trackName: "Complete Track",
    rawLyrics: "First line here\nSecond line here\nThird line here\nFourth line here",
    submitterUserId: "00000000-0000-0000-0000-000000000001",
    submitterName: "Tester",
  };
  const res = await enqueueSyncJob(db, input, T0);
  if (!res.ok) throw new Error(`enqueue failed: ${res.code}`);
  await moderateSyncJob(db, res.job.id, "promote", undefined, T0);
  const claimed = await claimNextJob(db, "test-worker", 2700, T0);
  if (!claimed) throw new Error("claim failed");
  return claimed;
}

function completeRequest(jobId: number, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/worker/jobs/${jobId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WORKER_TOKEN}`,
    },
    body: JSON.stringify({
      worker_id: "test-worker",
      payload: samplePayload(),
      meta: { duration: 180 },
      ...body,
    }),
  });
}

describe("POST /api/worker/jobs/[id]/complete with chords", () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeAll(async () => {
    process.env.WORKER_TOKEN = WORKER_TOKEN;
    ({ POST } = await import("@/app/api/worker/jobs/[id]/complete/route"));
  });

  beforeEach(async () => {
    testDb = await makeDb();
  });

  async function post(jobId: number, body: Record<string, unknown>) {
    return POST(completeRequest(jobId, body), { params: Promise.resolve({ id: String(jobId) }) });
  }

  it("valid chords land alongside the revision and are reported", async () => {
    const job = await processingJob(testDb);
    const res = await post(job.id, { chords: sampleChordChart() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision_id).toBeGreaterThan(0);
    expect(body.chord_chart_id).toBeGreaterThan(0);
    const rows = await testDb.select().from(chordCharts);
    expect(rows).toHaveLength(1);
    expect(rows[0].trackId).toBe(body.track_id);
    expect(rows[0].derivedFromVideoKey).toBe("yt:dQw4w9WgXcQ");
    expect(rows[0].submitterFingerprint).toBe("system:sync-queue");
  });

  it("invalid chords are dropped - the lyrics still import, no 400", async () => {
    const job = await processingJob(testDb);
    const res = await post(job.id, { chords: { format_version: 99, nonsense: true } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision_id).toBeGreaterThan(0);
    expect(body.chord_chart_id).toBeNull();
    expect(await testDb.select().from(chordCharts)).toHaveLength(0);
  });

  it("an empty chart is dropped the same way", async () => {
    const job = await processingJob(testDb);
    const res = await post(job.id, { chords: { ...sampleChordChart(), segments: [] } });
    expect(res.status).toBe(200);
    expect((await res.json()).chord_chart_id).toBeNull();
    expect(await testDb.select().from(chordCharts)).toHaveLength(0);
  });

  it("no chords field behaves exactly as before", async () => {
    const job = await processingJob(testDb);
    const res = await post(job.id, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision_id).toBeGreaterThan(0);
    expect(body.chord_chart_id).toBeNull();
    expect(await testDb.select().from(chordCharts)).toHaveLength(0);
  });
});
