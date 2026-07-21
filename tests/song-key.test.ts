import { describe, expect, it } from "vitest";
import { normalizeForMatch, songKey } from "@/lib/song-key";

// songKey is the demand queue's dedup axis: two requests that normalize to the
// same key become one want with two votes, and anything that wrongly collapses
// merges two different songs. These cases are the contract.

describe("normalizeForMatch", () => {
  it("folds Balkan diacritics to their ASCII spelling", () => {
    expect(normalizeForMatch("Đorđe Balašević")).toBe("djordje balasevic");
    expect(normalizeForMatch("Željko Šaulić")).toBe("zeljko saulic");
    expect(normalizeForMatch("Ćao")).toBe("cao");
  });

  it("folds Cyrillic so it matches the Latin spelling of the same name", () => {
    expect(normalizeForMatch("Ђорђе Балашевић")).toBe(normalizeForMatch("Đorđe Balašević"));
    expect(normalizeForMatch("Здраво")).toBe("zdravo");
  });

  it("strips upload noise so re-uploads collapse onto one identity", () => {
    const bare = normalizeForMatch("Prevari Me");
    expect(normalizeForMatch("Prevari Me (Official Video)")).toBe(bare);
    expect(normalizeForMatch("Prevari Me [HD] 1080p")).toBe(bare);
    expect(normalizeForMatch("Prevari Me - Official Lyric Video 4K")).toBe(bare);
  });

  it("drops a trailing feat clause", () => {
    expect(normalizeForMatch("Some Song feat Someone Else")).toBe("some song");
    expect(normalizeForMatch("Some Song ft Another")).toBe("some song");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeForMatch("  Hello,   World!  ")).toBe("hello world");
    expect(normalizeForMatch("A.B.C.")).toBe("a b c");
  });

  it("keeps a title that is entirely a noise word", () => {
    // "Live" is a real band/title — stripping it to "" would merge every such
    // song into one want.
    expect(normalizeForMatch("Live")).toBe("live");
    expect(normalizeForMatch("Video")).toBe("video");
  });

  it("returns empty for empty-ish input", () => {
    expect(normalizeForMatch("")).toBe("");
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch("   ---   ")).toBe("");
  });
});

describe("songKey", () => {
  it("is stable across casing, diacritics, and upload noise", () => {
    const canonical = songKey("Slavica Ćuktera", "Prevari Me");
    expect(songKey("SLAVICA CUKTERA", "prevari me")).toBe(canonical);
    expect(songKey("Slavica Cuktera", "Prevari Me (Official Video)")).toBe(canonical);
  });

  it("keeps different songs by the same artist apart", () => {
    expect(songKey("Artist", "Song One")).not.toBe(songKey("Artist", "Song Two"));
  });

  it("keeps the same title by different artists apart", () => {
    expect(songKey("Artist One", "Song")).not.toBe(songKey("Artist Two", "Song"));
  });

  it("does not let field content collide across the separator", () => {
    // Normalization leaves only [a-z0-9 ], so "a|b" can never be forged.
    expect(songKey("a b", "c")).not.toBe(songKey("a", "b c"));
  });
});
