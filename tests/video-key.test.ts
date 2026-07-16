import { describe, expect, it } from "vitest";
import { deriveVideoKey, parseVideoKey, pickPreferredVideoKey } from "@/lib/video-key";
import { findTrackByVideo, linkTrackVideo, listTrackVideos } from "@/lib/db/queries";
import { trackVideos } from "@/lib/db/schema";
import { makeDb, makeTrack } from "./helpers";

describe("deriveVideoKey", () => {
  it("normalizes every YouTube URL shape and the bare id to the same key", () => {
    const expected = "yt:piM9Du_KSLo";
    expect(deriveVideoKey("https://www.youtube.com/watch?v=piM9Du_KSLo")).toBe(expected);
    expect(deriveVideoKey("https://youtube.com/watch?v=piM9Du_KSLo&list=PL1&t=42s")).toBe(expected);
    expect(deriveVideoKey("https://m.youtube.com/watch?v=piM9Du_KSLo")).toBe(expected);
    expect(deriveVideoKey("https://youtu.be/piM9Du_KSLo?si=abc")).toBe(expected);
    expect(deriveVideoKey("https://www.youtube.com/shorts/piM9Du_KSLo")).toBe(expected);
    expect(deriveVideoKey("https://www.youtube.com/embed/piM9Du_KSLo")).toBe(expected);
    expect(deriveVideoKey("piM9Du_KSLo")).toBe(expected);
  });

  it("rejects non-video input", () => {
    expect(deriveVideoKey(null)).toBeNull();
    expect(deriveVideoKey("")).toBeNull();
    expect(deriveVideoKey("not a url")).toBeNull();
    expect(deriveVideoKey("https://example.com/watch?v=piM9Du_KSLo")).toBeNull();
    expect(deriveVideoKey("https://www.youtube.com/playlist?list=PL1")).toBeNull();
  });

  it("normalizes every Spotify track shape to the same key", () => {
    const expected = "sp:4uLU6hMCjMI75M1A2tKUQC";
    expect(deriveVideoKey("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")).toBe(expected);
    expect(deriveVideoKey("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123")).toBe(expected);
    expect(deriveVideoKey("https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC")).toBe(expected);
    expect(deriveVideoKey("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC")).toBe(expected);
    expect(deriveVideoKey("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toBe(expected);
    expect(deriveVideoKey("4uLU6hMCjMI75M1A2tKUQC")).toBe(expected);
  });

  it("passes canonical keys through unchanged", () => {
    expect(deriveVideoKey("yt:piM9Du_KSLo")).toBe("yt:piM9Du_KSLo");
    expect(deriveVideoKey("sp:4uLU6hMCjMI75M1A2tKUQC")).toBe("sp:4uLU6hMCjMI75M1A2tKUQC");
  });

  it("rejects non-track Spotify input", () => {
    expect(deriveVideoKey("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toBeNull();
    expect(deriveVideoKey("https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC")).toBeNull();
    expect(deriveVideoKey("https://example.com/track/4uLU6hMCjMI75M1A2tKUQC")).toBeNull();
    expect(deriveVideoKey("4uLU6hMCjMI75M1A2tKUQ")).toBeNull(); // 21 chars
    expect(deriveVideoKey("4uLU6hMCjMI75M1A2tKUQCx")).toBeNull(); // 23 chars
    expect(deriveVideoKey("spotify:playlist:4uLU6hMCjMI75M1A2tKUQC")).toBeNull();
  });
});

describe("parseVideoKey", () => {
  it("splits canonical keys into platform + id", () => {
    expect(parseVideoKey("yt:piM9Du_KSLo")).toEqual({ platform: "youtube", id: "piM9Du_KSLo" });
    expect(parseVideoKey("sp:4uLU6hMCjMI75M1A2tKUQC")).toEqual({
      platform: "spotify",
      id: "4uLU6hMCjMI75M1A2tKUQC",
    });
  });

  it("round-trips through deriveVideoKey", () => {
    expect(parseVideoKey(deriveVideoKey("https://youtu.be/piM9Du_KSLo"))).toEqual({
      platform: "youtube",
      id: "piM9Du_KSLo",
    });
    expect(parseVideoKey(deriveVideoKey("spotify:track:4uLU6hMCjMI75M1A2tKUQC"))).toEqual({
      platform: "spotify",
      id: "4uLU6hMCjMI75M1A2tKUQC",
    });
  });

  it("rejects anything that is not a canonical key", () => {
    expect(parseVideoKey(null)).toBeNull();
    expect(parseVideoKey("")).toBeNull();
    expect(parseVideoKey("piM9Du_KSLo")).toBeNull(); // bare id, not a key
    expect(parseVideoKey("yt:tooshort")).toBeNull();
    expect(parseVideoKey("yt:piM9Du_KSLoX")).toBeNull(); // 12 chars
    expect(parseVideoKey("sp:4uLU6hMCjMI75M1A2tKUQ")).toBeNull(); // 21 chars
    expect(parseVideoKey("https://youtu.be/piM9Du_KSLo")).toBeNull();
  });
});

describe("pickPreferredVideoKey", () => {
  const yt = (id: string, createdAt: number) => ({ videoKey: `yt:${id}`, createdAt });
  const sp = (id: string, createdAt: number) => ({ videoKey: `sp:${id}`, createdAt });

  it("returns null for no videos", () => {
    expect(pickPreferredVideoKey([])).toBeNull();
  });

  it("prefers yt: over sp: even when the Spotify link is older", () => {
    expect(
      pickPreferredVideoKey([sp("4uLU6hMCjMI75M1A2tKUQC", 1), yt("piM9Du_KSLo", 2)])
    ).toBe("yt:piM9Du_KSLo");
  });

  it("picks the earliest link within a platform, regardless of input order", () => {
    const videos = [yt("bbbbbbbbbbb", 200), yt("aaaaaaaaaaa", 100)];
    expect(pickPreferredVideoKey(videos)).toBe("yt:aaaaaaaaaaa");
    expect(pickPreferredVideoKey([...videos].reverse())).toBe("yt:aaaaaaaaaaa");
  });

  it("falls back to the earliest Spotify link when no yt: key exists", () => {
    expect(
      pickPreferredVideoKey([
        sp("bbbbbbbbbbbbbbbbbbbbbb", 50),
        sp("aaaaaaaaaaaaaaaaaaaaaa", 90),
      ])
    ).toBe("sp:bbbbbbbbbbbbbbbbbbbbbb");
  });

  it("ignores unparseable keys", () => {
    expect(pickPreferredVideoKey([{ videoKey: "garbage", createdAt: 1 }])).toBeNull();
    expect(
      pickPreferredVideoKey([
        { videoKey: "garbage", createdAt: 1 },
        sp("4uLU6hMCjMI75M1A2tKUQC", 5),
      ])
    ).toBe("sp:4uLU6hMCjMI75M1A2tKUQC");
  });
});

describe("track_videos linking", () => {
  it("resolves a track by its linked video key", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await linkTrackVideo(db, track.id, "yt:piM9Du_KSLo");

    const found = await findTrackByVideo(db, "yt:piM9Du_KSLo");
    expect(found?.id).toBe(track.id);
    expect(await findTrackByVideo(db, "yt:aaaaaaaaaaa")).toBeNull();
  });

  it("links and resolves sp: keys the same as yt: keys", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    await linkTrackVideo(db, track.id, "sp:4uLU6hMCjMI75M1A2tKUQC");

    const found = await findTrackByVideo(db, "sp:4uLU6hMCjMI75M1A2tKUQC");
    expect(found?.id).toBe(track.id);
  });

  it("repoints the video on re-link (last write wins)", async () => {
    const db = await makeDb();
    const first = await makeTrack(db);
    const second = await makeTrack(db, { trackName: "Corrected Track" });
    await linkTrackVideo(db, first.id, "yt:piM9Du_KSLo");
    await linkTrackVideo(db, second.id, "yt:piM9Du_KSLo");

    const found = await findTrackByVideo(db, "yt:piM9Du_KSLo");
    expect(found?.id).toBe(second.id);
  });

  it("lists a track's videos oldest first", async () => {
    const db = await makeDb();
    const track = await makeTrack(db);
    const other = await makeTrack(db, { trackName: "Other Track" });
    // Insert directly: linkTrackVideo stamps Date.now(), which is not
    // deterministic enough to assert ordering.
    await db.insert(trackVideos).values([
      { videoKey: "yt:bbbbbbbbbbb", trackId: track.id, createdAt: 300 },
      { videoKey: "sp:4uLU6hMCjMI75M1A2tKUQC", trackId: track.id, createdAt: 100 },
      { videoKey: "yt:aaaaaaaaaaa", trackId: track.id, createdAt: 200 },
      { videoKey: "yt:ccccccccccc", trackId: other.id, createdAt: 50 },
    ]);

    const videos = await listTrackVideos(db, track.id);
    expect(videos.map((v) => v.videoKey)).toEqual([
      "sp:4uLU6hMCjMI75M1A2tKUQC",
      "yt:aaaaaaaaaaa",
      "yt:bbbbbbbbbbb",
    ]);
  });
});
