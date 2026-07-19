import { describe, expect, it } from "vitest";
import { stripToPlainLines } from "@/lib/formats";

describe("stripToPlainLines", () => {
  it("passes plain text through, dropping blank lines", () => {
    expect(stripToPlainLines("Hello there\n\nSecond line\n")).toBe("Hello there\nSecond line");
  });

  it("strips LRC line timestamps", () => {
    const lrc = "[00:12.34]First line\n[00:15.60]Second line";
    expect(stripToPlainLines(lrc)).toBe("First line\nSecond line");
  });

  it("strips enhanced-LRC word tags", () => {
    const enhanced = "[00:12.34]<00:12.34>First <00:12.90>line";
    expect(stripToPlainLines(enhanced)).toBe("First line");
  });

  it("drops metadata-only lines entirely", () => {
    const lrc = "[ar:Some Artist]\n[ti:Some Title]\n[00:01.00]Real lyric";
    expect(stripToPlainLines(lrc)).toBe("Real lyric");
  });

  it("collapses whitespace like the aligner does", () => {
    expect(stripToPlainLines("  spaced   out\ttext  ")).toBe("spaced out text");
  });

  it("returns empty string for tag-only input", () => {
    expect(stripToPlainLines("[00:01.00]\n[ar:X]")).toBe("");
  });
});
