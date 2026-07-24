import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { revisions, tracks } from "@/lib/db/schema";
import { makeDb, samplePayload } from "./helpers";

// Route-level tests for the word-only publish rule. PoW and rate limiting are
// bypassed — they have their own tests; here only the payload gate matters.
let testDb: Db;

vi.mock("@/lib/db/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...orig, getDb: () => testDb };
});
vi.mock("@/lib/pow", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/pow")>();
  return { ...orig, verifyAndConsumeSolution: async () => ({ ok: true as const }) };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...orig, checkRateLimit: async () => ({ allowed: true, remaining: 1 }) };
});

function publishRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge: { prefix: "p", nonce: "n" },
      artist_name: "Word Only Artist",
      track_name: "Word Only Song",
      duration: 200,
      ...body,
    }),
  });
}

describe("POST /api/publish word-only rule", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    ({ POST } = await import("@/app/api/publish/route"));
  });

  it("rejects plain LRC with WordTimingRequired", async () => {
    testDb = await makeDb();
    const res = await POST(
      publishRequest({ raw: "[00:12.00]First line\n[00:15.30]Second line", format: "lrc" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.name).toBe("WordTimingRequired");
    expect(await testDb.select().from(revisions)).toHaveLength(0);
  });

  it("rejects Enhanced LRC that degraded to line-level (no word tags)", async () => {
    testDb = await makeDb();
    const res = await POST(
      publishRequest({ raw: "[00:12.00]First line\n[00:15.30]Second line", format: "enhanced_lrc" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).name).toBe("WordTimingRequired");
  });

  it("rejects a structured payload without word timing", async () => {
    testDb = await makeDb();
    const p = samplePayload();
    const lineLevel = {
      ...p,
      lines: p.lines.map(({ words: _words, ...line }) => line),
      meta: { ...p.meta, has_word_timing: false },
    };
    const res = await POST(publishRequest({ payload: lineLevel }));
    expect(res.status).toBe(400);
    expect((await res.json()).name).toBe("WordTimingRequired");
  });

  it("accepts word-tagged Enhanced LRC and serves it as best", async () => {
    testDb = await makeDb();
    const raw =
      "[00:12.00]<00:12.00>First <00:12.60>line\n[00:15.30]<00:15.30>Second <00:15.90>line";
    const res = await POST(publishRequest({ raw, format: "enhanced_lrc" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tier).toBe("community");

    const [track] = await testDb
      .select()
      .from(tracks)
      .where(eq(tracks.id, body.track_id));
    expect(track.bestRevisionId).toBe(body.revision_id);
  });
});
