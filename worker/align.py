#!/usr/bin/env python3
"""Offline lyrics aligner: audio you own + plain lyrics -> word-timed payload.

Pipeline:
  1. Demucs isolates the vocal stem (alignment on vocals is far more accurate
     than on the full mix). Skippable with --no-demucs for a cappella tracks.
  2. CTC forced alignment (torchaudio MMS_FA via ctc-forced-aligner) maps the
     known lyric text onto the vocal audio. The MMS model reads romanized a-z
     text, so lyrics are transliterated for alignment while the payload keeps
     the original spelling. The per-character token spans from the same model
     pass also yield syllable times (vowel-nucleus split), so multi-syllable
     words carry `syllables` at no extra alignment cost (--word-level skips).
  3. Words are folded back into the lyric lines -> a Karalyr LyricsPayload
     JSON, importable with scripts/import-aligned.ts.

Usage:
  worker/.venv/bin/python worker/align.py \
      --audio song.mp3 --lyrics lyrics.txt --out payload.json

The lyrics file is plain text, one sung line per row (blank lines ignored).
LRC input also works - timestamps are stripped, only the text is used.
First run downloads the MMS alignment model (~1.2 GB, cached by torchaudio).

Everything runs locally; the audio never leaves this machine and the
separated stems are deleted when the run finishes.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

TAG_RE = re.compile(r"\[[^\]]*\]|<[^>]*>")


def load_lyric_lines(path: Path) -> list[str]:
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        text = TAG_RE.sub("", raw).strip()
        text = re.sub(r"\s+", " ", text)
        if text:
            lines.append(text)
    return lines


SPECIAL_ROMAN = {"đ": "dj", "Đ": "dj", "ß": "ss", "æ": "ae", "ø": "o", "þ": "th", "ð": "d", "ł": "l"}

# Languages the aligner accepts via --language (ISO 639-1, what users and the
# DB see) mapped to the ISO 639-3 codes ctc_forced_aligner's tables use.
# Latin-script languages are listed so --language validates, but any language
# benefits from the unidecode path; the default (no --language) keeps the
# original Balkan-tuned behavior byte-for-byte.
LANGUAGES = {
    "hi": "hin", "ta": "tam", "te": "tel", "pa": "pan", "bn": "ben", "mr": "mar",
    "vi": "vie", "id": "ind", "tl": "tgl", "fil": "tgl", "zh": "cmn",
    "th": "tha", "km": "khm", "lo": "lao",
}
# No word boundaries in these scripts and no tokenizer wired up yet - refuse
# word-level rather than emit one giant "word" per line; --line-level is the
# honest path for these. Thai is NOT listed: pythainlp's newmm dictionary
# tokenizer supplies its word boundaries. (message text is matched by
# queue_worker.PERMANENT_MARKERS)
UNSUPPORTED_WORD_LEVEL = {"km", "lo"}

HAN_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")


def romanize_char(ch: str, language: str | None = None) -> str:
    """One original character -> its a-z transliteration ("" if none)."""
    if language is not None:
        # unidecode is a per-codepoint table, so per-char calls concatenate to
        # exactly the whole-word result - split_word_syllables depends on that
        # to map aligned char spans back onto original characters. (This is
        # why text_normalize is NOT in this path: it works on whole strings.)
        from unidecode import unidecode  # lazy: default path stays dep-free

        out = []
        for d in unidecode(ch).lower():
            if "a" <= d <= "z" or d == "'":
                out.append(d)
        return "".join(out)
    if ch in SPECIAL_ROMAN:
        return SPECIAL_ROMAN[ch]
    out = []
    for d in unicodedata.normalize("NFD", ch):
        if unicodedata.category(d) == "Mn":
            continue
        d = d.lower()
        if "a" <= d <= "z" or d == "'":
            out.append(d)
    return "".join(out)


def romanize_word(word: str, language: str | None = None) -> str:
    """Reduce a word to the a-z alphabet the MMS_FA dictionary understands.

    Default path: NFD-decompose to strip diacritics (č->c, ž->z, ...), map a
    few special letters explicitly (Balkan-tuned: đ->dj), drop everything
    else. With a language: unidecode transliterates any script (तुम->tum,
    đường->duong, 中->zhong). Returns "" for words with no alphabetic content
    (pure punctuation) - those get no timestamps.
    """
    return "".join(romanize_char(ch, language) for ch in word)


THAI_RE = re.compile(r"[\u0E00-\u0E7F]")


def split_line_words(text: str, language: str | None = None) -> list[str]:
    """A line's words, in singing order. Whitespace-separated everywhere
    except: Chinese, where unspaced Han runs sing one character at a time
    (each Han char becomes its own word, Latin runs inside stay together);
    and Thai, where pythainlp's newmm dictionary segmentation supplies the
    word boundaries the script doesn't write."""
    words = text.split()
    if language == "th":
        from pythainlp.tokenize import word_tokenize  # lazy: th runs only

        thai_out: list[str] = []
        for w in words:
            if THAI_RE.search(w):
                thai_out.extend(t for t in word_tokenize(w, engine="newmm") if t.strip())
            else:
                thai_out.append(w)
        return thai_out
    if language != "zh":
        return words
    out: list[str] = []
    for w in words:
        if HAN_RE.search(w):
            out.extend(re.findall(r"[㐀-䶿一-鿿豈-﫿]|[^㐀-䶿一-鿿豈-﫿]+", w))
        else:
            out.append(w)
    return out


VOWELS = frozenset("aeiou")


def syllable_boundaries(roman: str):
    """Start indices of syllables in a romanized word (first is always 0).

    Vowel groups are the nuclei; an intervocalic consonant cluster breaks
    before its last consonant (vo-da, i-me-nom, sest-ra). Returns None for
    words with fewer than two nuclei - those stay word-level.
    """
    nuclei = []
    i = 0
    while i < len(roman):
        if roman[i] in VOWELS:
            j = i
            while j + 1 < len(roman) and roman[j + 1] in VOWELS:
                j += 1
            nuclei.append((i, j))
            i = j + 1
        else:
            i += 1
    if len(nuclei) < 2:
        return None
    bounds = [0]
    for (_s1, e1), (s2, _e2) in zip(nuclei, nuclei[1:]):
        bounds.append(s2 if s2 == e1 + 1 else s2 - 1)
    return bounds


def split_word_syllables(original: str, chars_ms, language: str | None = None):
    """Original word + per-roman-char (start_ms, end_ms) -> syllable dicts.

    Boundaries are found in romanized space and snapped up to original
    character starts, so a multi-letter transliteration (đ->dj) never splits.
    Returns None when the word has one syllable or the romanization doesn't
    line up with the aligned character count (defensive: better word-level
    than wrong).
    """
    frags = [romanize_char(ch, language) for ch in original]
    roman = "".join(frags)
    if len(roman) == 0 or len(roman) != len(chars_ms):
        return None
    bounds = syllable_boundaries(roman)
    if bounds is None:
        return None

    # Roman position of each original character's first roman letter.
    orig_start_at = {}
    cum = 0
    for oi, frag in enumerate(frags):
        if frag:
            orig_start_at[cum] = oi
        cum += len(frag)

    # Snap each roman boundary up to an original-character start.
    snapped = []  # (original index, roman index)
    for b in bounds:
        while b < len(roman) and b not in orig_start_at:
            b += 1
        if b >= len(roman):
            continue
        oi = orig_start_at[b]
        if not snapped or oi > snapped[-1][0]:
            snapped.append((oi, b))
    if len(snapped) < 2:
        return None
    snapped[0] = (0, 0)  # leading punctuation belongs to the first syllable

    syllables = []
    for k, (oi, rb) in enumerate(snapped):
        oi_end = snapped[k + 1][0] if k + 1 < len(snapped) else len(original)
        rb_end = snapped[k + 1][1] if k + 1 < len(snapped) else len(roman)
        syllables.append(
            {
                "text": original[oi:oi_end],
                "start_ms": chars_ms[rb][0],
                "end_ms": chars_ms[rb_end - 1][1],
            }
        )
    return syllables


# Mirrors the karaoke-filter-plugin title parser (shared/song-match.js) just
# enough that both sides derive the same {artist, title} from a typical
# "Artist - Title - (Audio 2005)" YouTube video title.
DESCRIPTOR_RE = re.compile(
    r"\b(live|remaster(?:ed)?|version|acoustic|radio edit|extended|remix|instrumental|"
    r"karaoke|cover|audio|video|visuali[sz]er|session|unplugged|demo|mono|stereo|edit|"
    r"official|lyrics?|hd|hq|4k)\b",
    re.IGNORECASE,
)
NOISE_PARENS_RE = re.compile(
    r"\s*[\(\[][^\)\]]*\b(official|audio|video|lyrics?|visuali[sz]er|remaster(?:ed)?|"
    r"live|hd|hq|4k|mv|\d{4})\b[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def parse_artist_title(raw_title: str):
    """Best-effort "Artist - Title" split of a YouTube video title.

    Most uploads carry no music metadata, and falling back to channel + raw
    title stores a track identity that exact /api/get lookups (the browser
    extension, LRCLIB clients) can never match. Split on the dash, drop
    trailing descriptor segments ("(Audio 2005)", "Live in ..."), strip noise
    parentheses. Returns (None, None) when there is no dash to split on -
    the caller keeps its channel/title fallback for that case.
    """
    segs = [s.strip() for s in re.split(r"\s+[-–—]\s+", raw_title) if s.strip()]
    while len(segs) > 2 and (
        DESCRIPTOR_RE.search(segs[-1]) or re.fullmatch(r"\(?\d{4}\)?", segs[-1])
    ):
        segs.pop()
    if len(segs) < 2:
        return None, None
    artist = NOISE_PARENS_RE.sub("", segs[0]).strip()
    title = NOISE_PARENS_RE.sub("", segs[1]).strip()
    if not artist or not title:
        return None, None
    return artist, title


def download_youtube(url: str, workdir: Path) -> tuple[Path, dict]:
    """PERSONAL-USE convenience: fetch a video's audio into the run's temp dir.

    Downloading from YouTube violates YouTube's Terms of Service - this flag
    exists for local, personal testing on your own machine only and must not
    be wired into any hosted flow. The file lives in the temporary work dir
    and is deleted (with the stems) when the run finishes.
    """
    try:
        import yt_dlp
    except ImportError:
        raise SystemExit("[align] yt-dlp missing: worker/.venv/bin/pip install yt-dlp")

    print(f"[align] downloading audio from {url} (personal use; deleted after the run)...")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "yt-audio.%(ext)s"),
        "quiet": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    hits = sorted(workdir.glob("yt-audio.*"))
    if not hits:
        raise SystemExit("[align] YouTube download produced no audio file")
    title = info.get("track") or ""
    artist = info.get("artist") or ""
    if not (title and artist):
        p_artist, p_title = parse_artist_title(info.get("title") or "")
        artist = artist or p_artist or info.get("channel") or ""
        title = title or p_title or info.get("title") or ""
    meta = {
        "title": title,
        "artist": artist,
        "duration": info.get("duration") or 0,
    }
    print(
        f"[align] got: {meta['artist']} - {meta['title']} ({meta['duration']}s, {hits[0].suffix[1:]})"
    )
    return hits[0], meta


def run_demucs(audio: Path, workdir: Path) -> Path:
    """Isolate vocals; returns the path to vocals.wav."""
    print(f"[align] demucs: separating vocals from {audio.name} (CPU, takes a few minutes)...")
    subprocess.run(
        [sys.executable, "-m", "demucs", "--two-stems", "vocals", "-o", str(workdir), str(audio)],
        check=True,
    )
    hits = list(workdir.glob(f"*/{audio.stem}/vocals.wav"))
    if not hits:
        raise SystemExit("[align] demucs produced no vocals.wav - aborting")
    return hits[0]


def get_word_stamps_with_chars(vocals: Path, transcript_path: Path):
    """ctc_forced_aligner.get_word_stamps, reimplemented to also keep each
    word's per-character times - the package computes the char-level token
    spans internally and collapses them at the end. Same single model pass,
    same frame→time math as its _postprocess_results.

    Returns [{"start": sec, "end": sec, "chars": [(start_ms, end_ms), ...]}]
    where chars follows the cleaned romanized word, one entry per letter.
    """
    import torch
    import torchaudio
    import torchaudio.functional as F
    from ctc_forced_aligner import align as ctc_align, load_audio, load_transcript, unflatten

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    bundle = torchaudio.pipelines.MMS_FA
    dictionary = bundle.get_dict(star=None)
    transcript, _lyrics = load_transcript(str(transcript_path), dictionary)
    model = bundle.get_model(with_star=False).to(device)
    waveform = load_audio(str(vocals), ret_type="torch").to(device)
    with torch.inference_mode():
        emission, _ = model(waveform)
    tokenized = [
        dictionary[c] for word in transcript for c in word if c in dictionary and dictionary[c] != 0
    ]
    aligned_tokens, scores = ctc_align(emission, tokenized, device)
    token_spans = F.merge_tokens(aligned_tokens[0], scores[0])
    word_spans = unflatten(token_spans, [len(w) for w in transcript])

    ratio = waveform.size(1) / emission.size(1)

    def frame_to_sec(frame: int) -> float:
        return int(ratio * frame) / bundle.sample_rate

    stamps = []
    for span in word_spans:
        chars = [
            (int(round(frame_to_sec(s.start) * 1000)), int(round(frame_to_sec(s.end) * 1000)))
            for s in span
        ]
        stamps.append({"start": frame_to_sec(span[0].start), "end": frame_to_sec(span[-1].end), "chars": chars})
    return stamps


def align_words(
    vocals: Path,
    lines: list[str],
    workdir: Path,
    legacy_stamps: bool = False,
    allow_partial: bool = False,
    language: str | None = None,
    line_level: bool = False,
):
    """Run forced alignment; returns per-line lists of (original_word, stamp)."""
    # One romanized word per surviving original word, so the returned stamps
    # fold back onto the original text by simple counting.
    per_line_words: list[list[str]] = []  # surviving ORIGINAL words per line
    transcript_lines: list[str] = []
    # Words the romanizer erases entirely (non-Latin scripts) would otherwise
    # vanish from the payload without a trace. Punctuation-only "words" are
    # expected to drop; anything with letters that still romanizes to "" is
    # unsupported input and must fail loudly, not import a gutted payload.
    lettered_total = 0
    dropped_lettered: list[str] = []
    for text in lines:
        # Line-level mode: the whole line is one alignment unit - used for
        # scripts with no word tokenizer (km/lo). Line times are recovered;
        # no word timing is claimed.
        raw = [text] if line_level else split_line_words(text, language)
        originals = [w for w in raw if romanize_word(w, language)]
        line_lettered = [w for w in raw if any(ch.isalpha() for ch in w)]
        line_dropped = [w for w in line_lettered if not romanize_word(w, language)]
        lettered_total += len(line_lettered)
        dropped_lettered.extend(line_dropped)
        if line_lettered and not originals and not allow_partial:
            raise SystemExit(
                f"[align] every word of a line contains unsupported characters "
                f"(e.g. {' '.join(line_lettered[:5])!r}) - the aligner cannot process "
                "this script yet; pass --allow-partial to skip such lines"
            )
        per_line_words.append(originals)
        transcript_lines.append(" ".join(romanize_word(w, language) for w in originals))

    if dropped_lettered and lettered_total:
        lost = len(dropped_lettered) / lettered_total
        if lost > 0.05 and not allow_partial:
            sample = ", ".join(repr(w) for w in dropped_lettered[:5])
            raise SystemExit(
                f"[align] {len(dropped_lettered)}/{lettered_total} words contain "
                f"unsupported characters and would be silently dropped ({sample}) - "
                "refusing to produce a gutted alignment; pass --allow-partial to override"
            )
        if dropped_lettered:
            print(f"[align] warning: dropping {len(dropped_lettered)} unsupported words")

    transcript_path = workdir / "transcript.txt"
    transcript_path.write_text("\n".join(transcript_lines), encoding="utf-8")

    print("[align] forced alignment (MMS_FA, first run downloads ~1.2 GB model)...")
    if legacy_stamps:
        from ctc_forced_aligner import get_word_stamps

        stamps, _model, _lyrics = get_word_stamps(str(vocals), str(transcript_path))
    else:
        stamps = get_word_stamps_with_chars(vocals, transcript_path)

    expected = sum(len(w) for w in per_line_words)
    if len(stamps) != expected:
        raise SystemExit(
            f"[align] aligner returned {len(stamps)} words, transcript has {expected} - "
            "this usually means unsupported characters; check the lyrics file"
        )

    folded = []
    cursor = 0
    for originals in per_line_words:
        folded.append(list(zip(originals, stamps[cursor : cursor + len(originals)])))
        cursor += len(originals)
    return folded


def to_payload(
    lines: list[str],
    folded,
    syllables: bool = True,
    language: str | None = None,
    line_level: bool = False,
) -> dict:
    payload_lines = []
    for text, pairs in zip(lines, folded):
        if not pairs:
            continue  # punctuation-only line; nothing sung
        words = []
        for original, stamp in pairs:
            word = {
                "text": original,
                "start_ms": int(round(float(stamp["start"]) * 1000)),
                "end_ms": int(round(float(stamp["end"]) * 1000)),
            }
            if syllables and stamp.get("chars"):
                syls = split_word_syllables(original, stamp["chars"], language)
                if syls:
                    word["syllables"] = syls
            words.append(word)
        for i in range(1, len(words)):
            if words[i]["start_ms"] < words[i - 1]["start_ms"] + 10:
                words[i]["start_ms"] = words[i - 1]["start_ms"] + 10
            if words[i - 1]["end_ms"] > words[i]["start_ms"]:
                words[i - 1]["end_ms"] = words[i]["start_ms"]
            if words[i]["end_ms"] <= words[i]["start_ms"]:
                words[i]["end_ms"] = words[i]["start_ms"] + 10
        # Snap syllables to the (possibly nudged) word spans: contiguous,
        # strictly increasing, first starts and last ends with the word.
        # A word too short to hold its pieces falls back to word-level.
        for w in words:
            syls = w.get("syllables")
            if not syls:
                continue
            syls[0]["start_ms"] = w["start_ms"]
            for k in range(1, len(syls)):
                if syls[k]["start_ms"] <= syls[k - 1]["start_ms"]:
                    syls[k]["start_ms"] = syls[k - 1]["start_ms"] + 1
                syls[k - 1]["end_ms"] = syls[k]["start_ms"]
            syls[-1]["end_ms"] = w["end_ms"]
            if any(s["end_ms"] <= s["start_ms"] for s in syls):
                del w["syllables"]
        payload_lines.append(
            {
                "start_ms": words[0]["start_ms"],
                "end_ms": words[-1]["end_ms"],
                "singer": None,
                "text": text,
                "words": words,
            }
        )

    # Extend each line's end toward the next line's start, but keep at most a
    # short tail after the last sung word so long instrumental gaps don't
    # leave a line highlighted forever.
    for i, line in enumerate(payload_lines):
        sung_end = line["end_ms"]
        if i + 1 < len(payload_lines):
            nxt = payload_lines[i + 1]["start_ms"]
            line["end_ms"] = max(min(nxt, sung_end + 1500), line["start_ms"] + 10)
        else:
            line["end_ms"] = max(sung_end, line["start_ms"] + 10)

    if line_level:
        # The single per-line pseudo-word only carried the line's span.
        for l in payload_lines:
            del l["words"]

    return {
        "format_version": 1,
        "lines": payload_lines,
        "meta": {
            "language": language,
            # Derived, not asserted: an alignment that produced no timed words
            # must not masquerade as word-synced downstream.
            "has_word_timing": any(l.get("words") for l in payload_lines),
            "countdown_lines": [],
        },
    }


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--audio", type=Path, help="local audio file you own")
    src.add_argument(
        "--youtube",
        help="YouTube URL (PERSONAL USE ONLY - downloading violates YouTube ToS; local testing flag)",
    )
    ap.add_argument("--lyrics", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--no-demucs", action="store_true", help="align on the full mix")
    ap.add_argument(
        "--word-level",
        action="store_true",
        help="skip syllable derivation; emit word spans only",
    )
    ap.add_argument(
        "--legacy-stamps",
        action="store_true",
        help="use ctc_forced_aligner.get_word_stamps verbatim (implies --word-level)",
    )
    ap.add_argument(
        "--allow-partial",
        action="store_true",
        help="proceed even when some words contain unsupported characters and drop",
    )
    ap.add_argument(
        "--language",
        help="ISO 639-1 code of the lyrics language (hi, vi, id, zh, ...); "
        "enables script-aware romanization - omit for Latin/Balkan lyrics",
    )
    ap.add_argument(
        "--line-level",
        action="store_true",
        help="align whole lines only (no word timing) - the honest mode for "
        "scripts with no word tokenizer (km/lo)",
    )
    args = ap.parse_args()

    language = args.language.lower().strip() if args.language else None
    if language is not None and language not in LANGUAGES:
        known = ", ".join(sorted(LANGUAGES))
        raise SystemExit(f"[align] unknown --language {language!r} (known: {known})")
    if language in UNSUPPORTED_WORD_LEVEL and not args.line_level:
        raise SystemExit(
            f"[align] word-level alignment for language {language!r} is not yet "
            "supported (the script has no word boundaries; unsupported characters) "
            "- run with --line-level for line-synced output"
        )
    if args.audio and not args.audio.exists():
        raise SystemExit(f"[align] audio not found: {args.audio}")
    lines = load_lyric_lines(args.lyrics)
    if not lines:
        raise SystemExit("[align] no lyric lines found")
    print(f"[align] {len(lines)} lyric lines")

    meta = {"artist": "ARTIST", "title": "TITLE", "duration": "SECONDS"}
    with tempfile.TemporaryDirectory(prefix="karalyr-align-") as tmp:
        tmpdir = Path(tmp)
        if args.youtube:
            audio, yt_meta = download_youtube(args.youtube, tmpdir)
            meta.update({k: v for k, v in yt_meta.items() if v})
        else:
            audio = args.audio
        vocals = audio if args.no_demucs else run_demucs(audio, tmpdir)
        folded = align_words(
            vocals,
            lines,
            tmpdir,
            legacy_stamps=args.legacy_stamps,
            allow_partial=args.allow_partial,
            language=language,
            line_level=args.line_level,
        )
        # temp dir (downloaded audio + separated stems + transcript) is deleted on exit

    payload = to_payload(
        lines,
        folded,
        syllables=not (args.word_level or args.legacy_stamps or args.line_level),
        language=language,
        line_level=args.line_level,
    )
    n_words = sum(len(l.get("words", [])) for l in payload["lines"])
    n_syls = sum(
        len(w.get("syllables", [])) for l in payload["lines"] for w in l.get("words", [])
    )
    if n_syls:
        print(f"[align] syllable timing on {n_syls} syllables (from the same alignment pass)")
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    # Machine-readable metadata alongside the payload (used by the local UI
    # to prefill the import). Only meaningful for --youtube runs.
    if args.youtube:
        args.out.with_suffix(".meta.json").write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8"
        )
    print(f"[align] wrote {args.out} - {len(payload['lines'])} lines, {n_words} timed words")
    print("[align] import it with:")
    print(
        f'  npx tsx scripts/import-aligned.ts --artist "{meta["artist"]}" --track "{meta["title"]}" '
        f"--duration {meta['duration']} --payload {args.out}"
    )


if __name__ == "__main__":
    main()
