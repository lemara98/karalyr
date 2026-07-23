import { describe, expect, it } from "vitest";
import {
  detectFormat,
  parseEnhancedLrc,
  parseLrc,
  parseUltraStar,
  payloadToSyncedLyrics,
  serializeEnhancedLrc,
  serializeLrc,
  validatePayload,
  wordFillPercent,
  FormatError,
} from "@/lib/formats";
import { applyOffset, median } from "@/lib/offset";

const PLAIN_LRC = [
  "[ar:Test Artist]",
  "[ti:Test Song]",
  "[00:12.04]Hello over there",
  "[00:15.20]Second line here",
  "[00:19.00]",
  "[00:21.50]Last line",
].join("\n");

describe("plain LRC", () => {
  it("parses line tags, metadata, and empty lines", () => {
    const p = parseLrc(PLAIN_LRC);
    expect(p.lines).toHaveLength(4);
    expect(p.lines[0]).toMatchObject({ start_ms: 12040, end_ms: 15200, text: "Hello over there" });
    expect(p.lines[2].text).toBe("");
    expect(p.meta.has_word_timing).toBe(false);
  });

  it("supports multiple tags on one source line", () => {
    const p = parseLrc("[00:01.00][00:05.00]Repeated chorus");
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0].start_ms).toBe(1000);
    expect(p.lines[1].start_ms).toBe(5000);
    expect(p.lines[1].text).toBe("Repeated chorus");
  });

  it("round-trips LRC -> payload -> LRC", () => {
    const p = parseLrc(PLAIN_LRC);
    const out = serializeLrc(p);
    expect(out).toBe(
      ["[00:12.04]Hello over there", "[00:15.20]Second line here", "[00:19.00]", "[00:21.50]Last line"].join("\n")
    );
    // Second round trip is identical.
    expect(serializeLrc(parseLrc(out))).toBe(out);
  });

  it("rejects input with no timestamps", () => {
    expect(() => parseLrc("just some text\nwith no tags")).toThrow(FormatError);
  });

  it("parses 3-digit millisecond fractions", () => {
    const p = parseLrc("[00:01.234]Milli");
    expect(p.lines[0].start_ms).toBe(1234);
  });
});

describe("enhanced LRC", () => {
  const ENHANCED = [
    "[00:12.04]<00:12.04>Hello <00:12.60>world <00:13.10>",
    "[00:15.00]<00:15.00>Second <00:15.50>line <00:16.00>",
  ].join("\n");

  it("parses word timestamps", () => {
    const p = parseEnhancedLrc(ENHANCED);
    expect(p.meta.has_word_timing).toBe(true);
    expect(p.lines[0].words).toEqual([
      { text: "Hello", start_ms: 12040, end_ms: 12600 },
      { text: "world", start_ms: 12600, end_ms: 13100 },
    ]);
    expect(p.lines[0].text).toBe("Hello world");
    expect(p.lines[0].end_ms).toBe(15000);
  });

  it("round-trips enhanced LRC -> payload -> enhanced LRC", () => {
    const p = parseEnhancedLrc(ENHANCED);
    const out = serializeEnhancedLrc(p);
    expect(serializeEnhancedLrc(parseEnhancedLrc(out))).toBe(out);
    expect(out).toContain("<00:12.04>Hello");
  });

  it("handles lines without word tags as line-level", () => {
    const p = parseEnhancedLrc("[00:01.00]No words here\n[00:03.00]<00:03.00>Timed <00:03.50>");
    expect(p.lines[0].words).toBeUndefined();
    expect(p.lines[0].text).toBe("No words here");
    expect(p.lines[1].words).toHaveLength(1);
  });
});

describe("ultrastar", () => {
  // BPM 300 -> quarter-beat = 15000/300 = 50 ms/beat. GAP 1000.
  const ULTRASTAR = [
    "#TITLE:Test",
    "#ARTIST:Tester",
    "#BPM:300",
    "#GAP:1000",
    ": 0 4 12 Hel",
    ": 4 4 12 lo",
    ": 10 4 10  there",
    "- 16",
    ": 20 8 8  Sing",
    ": 30 4 8  it",
    "E",
  ].join("\n");

  it("maps beats to ms via GAP + beat * 15000/BPM", () => {
    const p = parseUltraStar(ULTRASTAR);
    expect(p.lines).toHaveLength(2);
    const [l1, l2] = p.lines;
    expect(l1.start_ms).toBe(1000); // GAP + 0*50
    expect(l1.end_ms).toBe(1700); // GAP + 14*50
    expect(l2.start_ms).toBe(2000); // GAP + 20*50
    expect(p.meta.has_word_timing).toBe(true);
  });

  it("merges syllables into words on leading spaces", () => {
    const p = parseUltraStar(ULTRASTAR);
    expect(p.lines[0].words!.map((w) => w.text)).toEqual(["Hello", "there"]);
    const hello = p.lines[0].words![0];
    expect(hello.start_ms).toBe(1000);
    expect(hello.end_ms).toBe(1400); // syllable "lo" ends at beat 8 = 1000 + 400
  });

  it("handles comma decimal BPM", () => {
    const p = parseUltraStar("#BPM:150,5\n#GAP:0\n: 0 4 1 Ha\nE");
    expect(p.lines[0].start_ms).toBe(0);
    expect(p.lines[0].end_ms).toBe(Math.round(4 * (15000 / 150.5)));
  });

  it("assigns singers for duets", () => {
    const duet = ["#BPM:300", "#GAP:0", "P1", ": 0 4 1 Mine", "- 6", "P2", ": 10 4 1 Yours", "- 16", "P3", ": 20 4 1 Ours", "E"].join("\n");
    const p = parseUltraStar(duet);
    expect(p.lines.map((l) => l.singer)).toEqual(["P1", "P2", "BOTH"]);
  });

  it("rejects missing BPM", () => {
    expect(() => parseUltraStar("#GAP:0\n: 0 4 1 Ha\nE")).toThrow(FormatError);
  });
});

describe("format detection", () => {
  it("detects each format", () => {
    expect(detectFormat("#BPM:300\n: 0 4 1 Ha")).toBe("ultrastar");
    expect(detectFormat("[00:01.00]<00:01.00>Hi <00:01.50>")).toBe("enhanced_lrc");
    expect(detectFormat("[00:01.00]Hi")).toBe("lrc");
  });
});

describe("payload validation and helpers", () => {
  it("validates a parsed payload", () => {
    const p = parseLrc(PLAIN_LRC);
    expect(() => validatePayload(p)).not.toThrow();
    expect(() => validatePayload({ format_version: 2, lines: [], meta: {} })).toThrow(FormatError);
  });

  it("payloadToSyncedLyrics picks enhanced only with word timing", () => {
    expect(payloadToSyncedLyrics(parseLrc("[00:01.00]Hi"))).toBe("[00:01.00]Hi");
    expect(payloadToSyncedLyrics(parseEnhancedLrc("[00:01.00]<00:01.00>Hi <00:01.50>"))).toContain("<00:01.00>Hi");
  });
});

describe("applyOffset / median", () => {
  it("shifts all line and word timestamps", () => {
    const p = parseEnhancedLrc("[00:01.00]<00:01.00>Hi <00:01.50>there <00:02.00>");
    const shifted = applyOffset(p, 250);
    expect(shifted.lines[0].start_ms).toBe(1250);
    expect(shifted.lines[0].words![0]).toMatchObject({ start_ms: 1250, end_ms: 1750 });
  });

  it("clamps negative results to zero", () => {
    const p = parseLrc("[00:00.10]Early");
    expect(applyOffset(p, -500).lines[0].start_ms).toBe(0);
  });

  it("computes medians", () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200])).toBe(150);
  });
});

describe("syllable timing", () => {
  // BPM 300 -> 50 ms/beat, GAP 1000. "Hello" = two timed syllables.
  const US = [
    "#BPM:300",
    "#GAP:1000",
    ": 0 4 12 Hel",
    ": 4 4 12 lo",
    ": 10 4 10  there",
    "E",
  ].join("\n");

  it("ultrastar preserves syllables on split words only", () => {
    const p = parseUltraStar(US);
    const [hello, there] = p.lines[0].words!;
    expect(hello.syllables).toEqual([
      { text: "Hel", start_ms: 1000, end_ms: 1200 },
      { text: "lo", start_ms: 1200, end_ms: 1400 },
    ]);
    expect(there.syllables).toBeUndefined();
  });

  it("enhanced LRC round-trips syllables via unspaced tags", () => {
    const p = parseUltraStar(US);
    const text = serializeEnhancedLrc(p, { syllables: true });
    expect(text).toContain("<00:01.00>Hel<00:01.20>lo <00:01.50>there");
    const back = parseEnhancedLrc(text);
    expect(back.lines[0].text).toBe("Hello there");
    // The last syllable's end stretches to the next word's tag — the same
    // lossiness word-level Enhanced LRC always had.
    expect(back.lines[0].words![0].syllables).toEqual([
      { text: "Hel", start_ms: 1000, end_ms: 1200 },
      { text: "lo", start_ms: 1200, end_ms: 1500 },
    ]);
    expect(back.lines[0].words![1]).toMatchObject({ text: "there", start_ms: 1500, end_ms: 1700 });
  });

  it("payloadToSyncedLyrics stays word-level unless asked", () => {
    const p = parseUltraStar(US);
    expect(payloadToSyncedLyrics(p)).toContain("<00:01.00>Hello");
    expect(payloadToSyncedLyrics(p)).not.toContain("Hel<");
    expect(payloadToSyncedLyrics(p, { syllables: true })).toContain("Hel<00:01.20>lo");
  });

  it("validatePayload keeps syllables through a JSON round trip", () => {
    const p = parseUltraStar(US);
    const v = validatePayload(JSON.parse(JSON.stringify(p)));
    expect(v.lines[0].words![0].syllables).toHaveLength(2);
  });

  it("wordFillPercent follows syllable boundaries", () => {
    const w = {
      text: "Hello",
      start_ms: 1000,
      end_ms: 2000,
      syllables: [
        { text: "Hel", start_ms: 1000, end_ms: 1800 },
        { text: "lo", start_ms: 1800, end_ms: 2000 },
      ],
    };
    // At 1800 the first syllable (3 of 5 chars) is done: 60%, not linear 80%.
    expect(wordFillPercent(w, 1800)).toBe(60);
    expect(wordFillPercent(w, 1000)).toBe(0);
    expect(wordFillPercent(w, 2000)).toBe(100);
    expect(wordFillPercent({ text: "Hello", start_ms: 1000, end_ms: 2000 }, 1800)).toBe(80);
  });

  it("applyOffset shifts syllables too", () => {
    const p = parseUltraStar(US);
    const shifted = applyOffset(p, 250);
    expect(shifted.lines[0].words![0].syllables![0]).toEqual({
      text: "Hel",
      start_ms: 1250,
      end_ms: 1450,
    });
  });
});
