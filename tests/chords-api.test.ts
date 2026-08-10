import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { linkTrackVideo } from "@/lib/db/queries";
import {
  makeChordChart,
  makeDb,
  makeRevision,
  makeTrack,
  sampleChordChart,
} from "./helpers";

// Route-level tests for the chords API surface. Same template as
// publish-word-only.test.ts: the db client is swapped for an in-memory one.
let testDb: Db;

vi.mock("@/lib/db/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...orig, getDb: () => testDb };
});

const WORKER_TOKEN = "test-worker-token";

function chordsGet(query: string): Request {
  return new Request(`http://localhost/api/chords?${query}`);
}

function workerPost(body: Record<string, unknown>, token = WORKER_TOKEN): Request {
  return new Request("http://localhost/api/worker/chords", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("chords API", () => {
  let GET: (req: Request) => Promise<Response>;
  let POST: (req: Request) => Promise<Response>;
  let GET_TRACK: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.WORKER_TOKEN = WORKER_TOKEN;
    ({ GET } = await import("@/app/api/chords/route"));
    ({ POST } = await import("@/app/api/worker/chords/route"));
    ({ GET: GET_TRACK } = await import("@/app/api/get/route"));
  });

  beforeEach(async () => {
    testDb = await makeDb();
  });

  describe("GET /api/chords", () => {
    it("serves the chart by track_id", async () => {
      const track = await makeTrack(testDb);
      await makeChordChart(testDb, track.id);
      const res = await GET(chordsGet(`track_id=${track.id}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.track_id).toBe(track.id);
      expect(body.chords.segments).toHaveLength(4);
      expect(body.chords.segments[2].bass_pc).toBe(0);
      expect(body.karalyr.source).toBe("auto_detected");
    });

    it("serves the chart by youtube_id via the video link", async () => {
      const track = await makeTrack(testDb);
      await linkTrackVideo(testDb, track.id, "yt:abc123def45");
      await makeChordChart(testDb, track.id);
      const res = await GET(chordsGet("youtube_id=abc123def45"));
      expect(res.status).toBe(200);
      expect((await res.json()).track_id).toBe(track.id);
    });

    it("404s when the track has no chart, or only a taken_down one", async () => {
      const track = await makeTrack(testDb);
      let res = await GET(chordsGet(`track_id=${track.id}`));
      expect(res.status).toBe(404);
      expect((await res.json()).name).toBe("ChordsNotFound");

      await makeChordChart(testDb, track.id, { status: "taken_down" });
      res = await GET(chordsGet(`track_id=${track.id}`));
      expect(res.status).toBe(404);
    });

    it("400s with no identity at all", async () => {
      const res = await GET(chordsGet(""));
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/worker/chords", () => {
    it("401s without the worker token", async () => {
      const res = await POST(workerPost({ worker_id: "w", track_id: 1, payload: sampleChordChart() }, "wrong"));
      expect(res.status).toBe(401);
    });

    it("404s for an unknown track - backfill never creates tracks", async () => {
      const res = await POST(workerPost({ worker_id: "w", track_id: 999, payload: sampleChordChart() }));
      expect(res.status).toBe(404);
    });

    it("requires exactly one identity", async () => {
      const track = await makeTrack(testDb);
      const both = await POST(
        workerPost({ worker_id: "w", track_id: track.id, video_key: "yt:abc123def45", payload: sampleChordChart() })
      );
      expect(both.status).toBe(400);
      const neither = await POST(workerPost({ worker_id: "w", payload: sampleChordChart() }));
      expect(neither.status).toBe(400);
    });

    it("uploads by video_key, dedupes the identical re-upload", async () => {
      const track = await makeTrack(testDb);
      await linkTrackVideo(testDb, track.id, "yt:abc123def45");
      const body = { worker_id: "w", video_key: "yt:abc123def45", payload: sampleChordChart() };
      const first = await POST(workerPost(body));
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.deduped).toBe(false);

      const second = await POST(workerPost(body));
      const secondBody = await second.json();
      expect(secondBody.deduped).toBe(true);
      expect(secondBody.chart_id).toBe(firstBody.chart_id);
    });

    it("400s an invalid payload and 409s after a takedown", async () => {
      const track = await makeTrack(testDb);
      const bad = await POST(
        workerPost({ worker_id: "w", track_id: track.id, payload: { format_version: 2 } })
      );
      expect(bad.status).toBe(400);
      expect((await bad.json()).name).toBe("InvalidPayload");

      await makeChordChart(testDb, track.id, { status: "taken_down" });
      const blocked = await POST(
        workerPost({ worker_id: "w", track_id: track.id, payload: sampleChordChart() })
      );
      expect(blocked.status).toBe(409);
    });
  });

  describe("karalyr.has_chords on /api/get", () => {
    it("reports chart availability", async () => {
      const track = await makeTrack(testDb);
      const rev = await makeRevision(testDb, track.id);
      const { tracks } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      await testDb.update(tracks).set({ bestRevisionId: rev.id }).where(eq(tracks.id, track.id));

      let res = await GET_TRACK(
        new Request("http://localhost/api/get?artist_name=Test%20Artist&track_name=Test%20Track")
      );
      expect(res.status).toBe(200);
      expect((await res.json()).karalyr.has_chords).toBe(false);

      await makeChordChart(testDb, track.id);
      res = await GET_TRACK(
        new Request("http://localhost/api/get?artist_name=Test%20Artist&track_name=Test%20Track")
      );
      expect((await res.json()).karalyr.has_chords).toBe(true);
    });
  });
});
