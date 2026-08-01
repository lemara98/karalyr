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

  it("returns empty only for genuinely empty input", () => {
    expect(normalizeForMatch("")).toBe("");
    expect(normalizeForMatch(null)).toBe("");
    // Symbol-only titles are real ("!!!" the band, "?" the album) — they keep
    // their raw form instead of collapsing to "", which would merge them all.
    expect(normalizeForMatch("   ---   ")).toBe("---");
    expect(normalizeForMatch("!!!")).not.toBe(normalizeForMatch("?"));
  });

  it("preserves non-Latin scripts instead of erasing them", () => {
    expect(normalizeForMatch("तुम ही हो")).toBe("तुम ही हो");
    expect(normalizeForMatch("เธอคือของขวัญ")).toBe("เธอคือของขวัญ");
    expect(normalizeForMatch("月亮代表我的心")).toBe("月亮代表我的心");
  });

  it("keeps combining vowel signs so near-identical words stay distinct", () => {
    // तुम vs तिम differ only in a \p{M} matra — dropping marks would merge them.
    expect(normalizeForMatch("तुम")).not.toBe(normalizeForMatch("तिम"));
  });

  it("agrees with the extension's normalizer on the shared parity vectors", () => {
    // Pinned in BOTH repos (extension: test/song-match.test.mjs) so the two
    // normalizers can't silently drift on non-Latin content. Known
    // divergence: đ (extension "d", here "dj") — deliberately not asserted.
    expect(normalizeForMatch("तुम ही हो")).toBe("तुम ही हो");
    expect(normalizeForMatch("เธอคือของขวัญ")).toBe("เธอคือของขวัญ");
    expect(normalizeForMatch("月亮代表我的心")).toBe("月亮代表我的心");
    expect(normalizeForMatch("Здраво")).toBe("zdravo");
  });

  it("is stable across Unicode normalization forms", () => {
    const title = "क़यामत से क़यामत तक";
    expect(normalizeForMatch(title.normalize("NFD"))).toBe(
      normalizeForMatch(title.normalize("NFC"))
    );
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
    // No normalization path emits "|", so "a|b" can never be forged.
    expect(songKey("a b", "c")).not.toBe(songKey("a", "b c"));
  });

  it("gives different non-Latin songs different keys", () => {
    // Regression: the old [a-z0-9] collapse erased whole scripts, so EVERY
    // Devanagari/Thai/Han request keyed to "|" and collided in the queue.
    expect(songKey("अरिजीत सिंह", "तुम ही हो")).not.toBe(songKey("श्रेया घोषाल", "सुन रहा है"));
    expect(songKey("อิ้งค์ วรันธร", "เธอคือของขวัญ")).not.toBe(songKey("เบิร์ด ธงไชย", "คู่กัด"));
    expect(songKey("鄧麗君", "月亮代表我的心")).not.toBe(songKey("鄧麗君", "甜蜜蜜"));
  });
});
