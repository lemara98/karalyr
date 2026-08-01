import { describe, expect, it } from "vitest";
import { detectLyricsLanguage } from "@/lib/lang-detect";

describe("detectLyricsLanguage", () => {
  it("detects the dominant non-Latin script", () => {
    expect(detectLyricsLanguage("तुम ही हो\nअब तुम ही हो")).toBe("hi");
    expect(detectLyricsLanguage("เธอคือของขวัญ ที่ฟ้าส่งมา")).toBe("th");
    expect(detectLyricsLanguage("月亮代表我的心\n你问我爱你有多深")).toBe("zh");
    expect(detectLyricsLanguage("என் காதல் நீ")).toBe("ta");
  });

  it("detects Vietnamese from its marker letters", () => {
    expect(detectLyricsLanguage("đường xa ướt mưa, em ơi")).toBe("vi");
  });

  it("returns null for plain Latin (Balkan, English, Indonesian)", () => {
    expect(detectLyricsLanguage("Zvaćeš je mojim imenom")).toBeNull();
    expect(detectLyricsLanguage("Hello world, goodbye world")).toBeNull();
    expect(detectLyricsLanguage("Aku cinta padamu selamanya")).toBeNull();
  });

  it("ignores a stray non-Latin word inside a Latin song", () => {
    const lyrics = "We sing together tonight\nOne little word 愛 appears\nAnd the song goes on and on";
    expect(detectLyricsLanguage(lyrics)).toBeNull();
  });

  it("handles empty input", () => {
    expect(detectLyricsLanguage("")).toBeNull();
  });

  it("picks Hindi for a Hinglish mix once Devanagari dominates", () => {
    expect(detectLyricsLanguage("तुम ही हो oh my love तुम ही हो")).toBe("hi");
  });
});
