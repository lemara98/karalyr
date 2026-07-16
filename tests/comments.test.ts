import { describe, expect, it } from "vitest";
import {
  deleteLyricComment,
  insertLyricComment,
  listLyricComments,
  listRecentLyricComments,
} from "@/lib/db/queries";
import { quoteForRange, validateLineRange, MAX_COMMENT_RANGE_LINES } from "@/lib/comments";
import { anchorComments } from "@/lib/comment-anchors";
import { makeComment, makeDb, makeRevision, makeTrack, samplePayload } from "./helpers";

describe("lyric comment queries", () => {
  it("lists a track's comments oldest first, scoped to the track", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const other = await makeTrack(db, { trackName: "Other Track" });
    const rev = await makeRevision(db, track.id);
    const otherRev = await makeRevision(db, other.id);

    await makeComment(db, track.id, rev.id, { body: "second", createdAt: 2000 });
    await makeComment(db, track.id, rev.id, { body: "first", createdAt: 1000 });
    await makeComment(db, other.id, otherRev.id, { body: "elsewhere", createdAt: 500 });

    const comments = await listLyricComments(db, track.id);
    expect(comments.map((c) => c.body)).toEqual(["first", "second"]);
  });

  it("inserts via insertLyricComment and hard-deletes", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);

    const created = await insertLyricComment(db, {
      trackId: track.id,
      revisionId: rev.id,
      startLine: 1,
      endLine: 2,
      quote: "a\nb",
      body: "hello",
      authorUserId: "u-1",
      authorName: null,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.authorName).toBeNull();

    expect(await deleteLyricComment(db, created.id)).toBe(true);
    expect(await deleteLyricComment(db, created.id)).toBe(false);
    expect(await listLyricComments(db, track.id)).toEqual([]);
  });

  it("lists recent comments across tracks with the track joined, newest first", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const rev = await makeRevision(db, track.id);
    await makeComment(db, track.id, rev.id, { body: "old", createdAt: 1000 });
    await makeComment(db, track.id, rev.id, { body: "new", createdAt: 2000 });

    const rows = await listRecentLyricComments(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].comment.body).toBe("new");
    expect(rows[0].track.id).toBe(track.id);
  });
});

describe("validateLineRange", () => {
  it("accepts a valid range", () => {
    expect(validateLineRange(0, 0, 5)).toBeNull();
    expect(validateLineRange(2, 4, 5)).toBeNull();
  });

  it("rejects inverted, out-of-bounds, empty and oversized ranges", () => {
    expect(validateLineRange(3, 2, 5)).toMatch(/start_line/);
    expect(validateLineRange(0, 5, 5)).toMatch(/out of bounds/);
    expect(validateLineRange(0, 0, 0)).toMatch(/no lyric lines/);
    expect(validateLineRange(0, MAX_COMMENT_RANGE_LINES, 50)).toMatch(/at most/);
  });
});

describe("quoteForRange", () => {
  it("joins line texts and substitutes ♪ for empty lines", () => {
    const payload = samplePayload();
    payload.lines[0].text = "First line";
    payload.lines[1].text = "   ";
    expect(quoteForRange(payload, 0, 1)).toBe("First line\n♪");
  });
});

describe("anchorComments", () => {
  const lines = ["Alpha", "Beta", "Gamma", "Delta"];
  const base = { body: "x", author_name: "A", created_at: 1 };

  it("passes same-revision comments through, clamping the end", () => {
    const { anchored, orphaned } = anchorComments(lines, 7, [
      { id: 1, revision_id: 7, start_line: 1, end_line: 2, quote: "Beta\nGamma", ...base },
      { id: 2, revision_id: 7, start_line: 2, end_line: 99, quote: "Gamma", ...base },
      { id: 3, revision_id: 7, start_line: 99, end_line: 100, quote: "Zed", ...base },
    ]);
    expect(anchored.map((a) => [a.comment.id, a.start, a.end])).toEqual([
      [1, 1, 2],
      [2, 2, 3],
    ]);
    expect(orphaned.map((c) => c.id)).toEqual([3]);
  });

  it("re-anchors cross-revision comments by exact quote match", () => {
    const { anchored, orphaned } = anchorComments(lines, 8, [
      // Was lines 0-1 in the old revision; the block moved down one line.
      { id: 1, revision_id: 7, start_line: 0, end_line: 1, quote: "Beta\nGamma", ...base },
      { id: 2, revision_id: 7, start_line: 0, end_line: 0, quote: "Changed text", ...base },
    ]);
    expect(anchored.map((a) => [a.comment.id, a.start, a.end])).toEqual([[1, 1, 2]]);
    expect(orphaned.map((c) => c.id)).toEqual([2]);
  });

  it("matches ♪ quotes against empty lines", () => {
    const { anchored } = anchorComments(["Alpha", "", "Gamma"], 8, [
      { id: 1, revision_id: 7, start_line: 5, end_line: 5, quote: "♪", ...base },
    ]);
    expect(anchored.map((a) => [a.start, a.end])).toEqual([[1, 1]]);
  });
});
