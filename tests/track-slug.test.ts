import { describe, expect, it } from "vitest";
import { parseTrackSlug, slugifyPart, trackPath, trackSlug } from "../lib/track-slug";

describe("slugifyPart", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyPart("Bohemian Rhapsody")).toBe("bohemian-rhapsody");
  });

  it("folds diacritics and Cyrillic to ASCII", () => {
    expect(slugifyPart("Đorđe Balašević")).toBe("djordje-balasevic");
    expect(slugifyPart("Ђорђе Балашевић")).toBe("djordje-balasevic");
  });

  it("collapses punctuation and trims stray hyphens", () => {
    expect(slugifyPart("  ...Baby One More Time!  ")).toBe("baby-one-more-time");
    expect(slugifyPart("AC/DC")).toBe("ac-dc");
  });

  it("keeps words a match key would strip", () => {
    // normalizeForMatch() drops "live"/"official" as upload noise; a slug must
    // not, or two different songs collapse to the same URL.
    expect(slugifyPart("Live Forever")).toBe("live-forever");
  });

  it("returns empty when nothing survives folding", () => {
    expect(slugifyPart("???")).toBe("");
    expect(slugifyPart(null)).toBe("");
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugifyPart(`${"a".repeat(59)} tail`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("trackSlug", () => {
  const track = { id: 17, artistName: "Queen", trackName: "Bohemian Rhapsody" };

  it("joins artist, title and id", () => {
    expect(trackSlug(track)).toBe("queen-bohemian-rhapsody-17");
    expect(trackPath(track)).toBe("/track/queen-bohemian-rhapsody-17");
  });

  it("falls back to the bare id when both names fold away", () => {
    expect(trackSlug({ id: 9, artistName: "米津玄師", trackName: "" })).toBe("9");
  });

  it("survives a title that ends in digits", () => {
    const s = trackSlug({ id: 42, artistName: "Blur", trackName: "Song 2" });
    expect(s).toBe("blur-song-2-42");
    expect(parseTrackSlug(s)).toBe(42);
  });
});

describe("parseTrackSlug", () => {
  it("reads the trailing id", () => {
    expect(parseTrackSlug("queen-bohemian-rhapsody-17")).toBe(17);
  });

  it("accepts a bare id, so old links keep working", () => {
    expect(parseTrackSlug("17")).toBe(17);
  });

  it("round-trips any slug it generates", () => {
    const track = { id: 1234, artistName: "Đorđe Balašević", trackName: "Ne lomite mi bagrenje" };
    expect(parseTrackSlug(trackSlug(track))).toBe(1234);
  });

  it("rejects slugs with no id", () => {
    expect(parseTrackSlug("bohemian-rhapsody")).toBeNull();
    expect(parseTrackSlug("")).toBeNull();
    expect(parseTrackSlug("0")).toBeNull();
    expect(parseTrackSlug("abc")).toBeNull();
  });
});
