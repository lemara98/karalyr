import { describe, expect, it } from "vitest";
import { wordSeparators } from "@/lib/word-separators";
import type { Line } from "@/lib/formats/types";

function line(text: string, words: string[]): Line {
  let ms = 0;
  return {
    start_ms: 0,
    end_ms: 1000,
    singer: null,
    text,
    words: words.map((w) => ({ text: w, start_ms: ms, end_ms: (ms += 100) })),
  };
}

describe("wordSeparators", () => {
  it("returns the spaces between Latin words", () => {
    expect(wordSeparators(line("Hello world again", ["Hello", "world", "again"]))).toEqual([
      " ",
      " ",
      "",
    ]);
  });

  it("returns empty separators for Chinese char-words", () => {
    const chars = [..."月亮代表我的心"];
    expect(wordSeparators(line("月亮代表我的心", chars))).toEqual(chars.map(() => ""));
  });

  it("preserves punctuation separators from the text", () => {
    expect(wordSeparators(line("Hello, world", ["Hello,", "world"]))).toEqual([" ", ""]);
    expect(wordSeparators(line("la-la land", ["la-la", "land"]))).toEqual([" ", ""]);
  });

  it("falls back to single spaces when words don't tile the text", () => {
    expect(wordSeparators(line("completely different", ["nope", "missing"]))).toEqual([" ", ""]);
  });

  it("handles a wordless line", () => {
    expect(wordSeparators({ start_ms: 0, end_ms: 1, singer: null, text: "x" })).toEqual([]);
  });
});
