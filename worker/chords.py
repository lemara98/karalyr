"""Chord detection for the karalyr worker.

Analyzes the ORIGINAL mix, not the demucs stems: every usable model was
trained on full commercial mixes, and the published evidence (Mitoma & Furuya,
APSIPA ASC 2025 - HTDemucs stems feeding a pretrained recognizer) shows stem
tricks move accuracy by at most a quarter of a point while vocal-suppressed
input measurably hurts. The accompaniment-stem idea sounds right and is not.

Backends are one swappable function each. The default is lv-chordia (MIT code
AND weights, the ISMIR-2019 chord-structure-decomposition model - the only
open model with slash-bass chords). BTC large-voca (also MIT) is the
documented fallback; its body explains how to vendor it if the lv-chordia
spot-check ever fails.

Licensing note, load-bearing: madmom, Essentia, and Chordino were rejected on
license grounds (CC BY-NC-SA weights / AGPL / GPL), not quality. Do not swap
one in without re-reading that decision - this data is served publicly.

Output is the chord-chart payload karalyr stores (lib/formats/chords.ts):
integer-ms segments with the raw Harte label plus pre-parsed
root_pc/quality/ext/bass_pc in exactly the convention Instrufilt renders.
"""

from __future__ import annotations

import os
from pathlib import Path

# ── pitch and label vocabulary ──────────────────────────────────────────────

_NATURAL_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Harte scale degrees -> semitones above the root (for slash-bass parsing).
_DEGREE_SEMITONES = {
    "1": 0, "b2": 1, "2": 2, "b3": 3, "3": 4, "4": 5, "#4": 6,
    "b5": 6, "5": 7, "#5": 8, "b6": 8, "6": 9, "b7": 10, "7": 11,
    "b9": 1, "9": 2, "#9": 3, "11": 5, "#11": 6, "b13": 8, "13": 9,
}

# Harte quality -> (quality, ext) in the client convention: quality 1 means
# the rendered symbol takes a lowercase "m"; ext is the suffix after it.
_HARTE_QUALITY = {
    "maj": (0, ""), "min": (1, ""),
    "7": (0, "7"), "maj7": (0, "maj7"), "min7": (1, "7"),
    "minmaj7": (1, "maj7"), "dim": (0, "dim"), "dim7": (0, "dim7"),
    "hdim7": (1, "7b5"), "aug": (0, "aug"),
    "sus2": (0, "sus2"), "sus4": (0, "sus4"), "sus4(b7)": (0, "7sus4"),
    "maj6": (0, "6"), "6": (0, "6"), "min6": (1, "6"),
    "9": (0, "9"), "maj9": (0, "maj9"), "min9": (1, "9"),
    "11": (0, "11"), "min11": (1, "11"), "13": (0, "13"), "min13": (1, "13"),
}

# Krumhansl-Schmuckler key profiles (same constants the rest of the family
# uses - instrufilt/shared/chord-format.js).
_KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

# Circle-of-fifths position per MAJOR key tonic; negative = flat side.
_FIFTHS_MAJOR = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6,
                 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}

MIN_SEGMENT_SECONDS = 0.45


def note_to_pc(name: str) -> int | None:
    if not name:
        return None
    pc = _NATURAL_PC.get(name[0].upper())
    if pc is None:
        return None
    for ch in name[1:]:
        if ch == "#":
            pc += 1
        elif ch == "b":
            pc -= 1
        else:
            return None
    return pc % 12


def _uses_flats(key_pc: int | None, key_mode: str | None) -> bool:
    if key_pc is None:
        return False
    major_pc = (key_pc + 3) % 12 if key_mode == "min" else key_pc
    return _FIFTHS_MAJOR.get(major_pc, 0) < 0


def _pc_name(pc: int, use_flats: bool) -> str:
    return (_FLAT_NAMES if use_flats else _SHARP_NAMES)[pc % 12]


def parse_harte(label: str) -> dict | None:
    """'Bb:min7/b3' -> {root_pc, quality, ext, bass_pc?, hq, hdeg}. None for
    N (no chord), X (unknown), and anything unreadable."""
    if not label or label in ("N", "X"):
        return None
    root_part, _, rest = label.partition(":")
    root_pc = note_to_pc(root_part.strip())
    if root_pc is None:
        return None
    rest = rest.strip() or "maj"
    hq, _, hdeg = rest.partition("/")
    hq = hq.strip() or "maj"
    hdeg = hdeg.strip()
    if hq not in _HARTE_QUALITY:
        return None
    quality, ext = _HARTE_QUALITY[hq]
    out = {"root_pc": root_pc, "quality": quality, "ext": ext, "hq": hq, "hdeg": hdeg}
    if hdeg:
        semis = _DEGREE_SEMITONES.get(hdeg)
        if semis is None:
            # Unknown degree: keep the chord, drop the bass claim.
            out["hdeg"] = ""
        elif semis != 0:
            out["bass_pc"] = (root_pc + semis) % 12
        else:
            out["hdeg"] = ""
    return out


# ── post-processing ─────────────────────────────────────────────────────────


def _identity(seg: dict) -> tuple:
    return (seg["root_pc"], seg["quality"], seg["ext"], seg.get("bass_pc"))


def merge_adjacent(segs: list[dict]) -> list[dict]:
    """Collapse runs of the same chord; confidence is duration-weighted."""
    out: list[dict] = []
    for seg in segs:
        prev = out[-1] if out else None
        if prev and _identity(prev) == _identity(seg) and seg["start"] - prev["end"] < 0.1:
            d_prev = prev["end"] - prev["start"]
            d_seg = seg["end"] - seg["start"]
            total = max(1e-6, d_prev + d_seg)
            prev["confidence"] = (
                prev["confidence"] * d_prev + seg["confidence"] * d_seg
            ) / total
            prev["end"] = seg["end"]
        else:
            out.append(dict(seg))
    return out


# Neighbors further apart than this are separated by real silence (dropped
# "N" segments leave gaps), and absorbing across silence would claim a chord
# sounds through it. Same tolerance merge_adjacent uses.
ADJACENCY_GAP_SECONDS = 0.1


def absorb_short(segs: list[dict], min_dur: float = MIN_SEGMENT_SECONDS) -> list[dict]:
    """Fold sub-min_dur flicker into the longer ADJACENT neighbor, then
    re-merge. A flicker with no adjacent neighbor (isolated in a no-chord
    stretch) is dropped outright — extending a neighbor across the silence
    would put a chord where the model heard none."""
    if len(segs) < 2:
        return segs
    out = [dict(s) for s in segs]
    changed = True
    while changed:
        changed = False
        for i, seg in enumerate(out):
            if seg["end"] - seg["start"] >= min_dur or len(out) < 2:
                continue
            prev = out[i - 1] if i > 0 else None
            nxt = out[i + 1] if i + 1 < len(out) else None
            if prev is not None and seg["start"] - prev["end"] >= ADJACENCY_GAP_SECONDS:
                prev = None
            if nxt is not None and nxt["start"] - seg["end"] >= ADJACENCY_GAP_SECONDS:
                nxt = None
            # Absorb into whichever adjacent neighbor is longer (the steadier
            # context); with neither adjacent, the flicker is noise — drop it.
            if prev is not None and (
                nxt is None or (prev["end"] - prev["start"]) >= (nxt["end"] - nxt["start"])
            ):
                prev["end"] = seg["end"]
            elif nxt is not None:
                nxt["start"] = seg["start"]
            del out[i]
            changed = True
            break
    return merge_adjacent(out)


def estimate_key(audio: Path) -> tuple[int | None, str | None, float]:
    """Krumhansl-Schmuckler over a mean chromagram. librosa is already a
    worker dependency (demucs pulls it in)."""
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(str(audio), sr=22050, mono=True)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
        best, second, best_pc, best_mode = -2.0, -2.0, 0, "maj"
        for profile, mode in ((_KS_MAJOR, "maj"), (_KS_MINOR, "min")):
            p = np.asarray(profile)
            for r in range(12):
                c = float(np.corrcoef(np.roll(chroma, -r), p)[0, 1])
                if c > best:
                    second, best, best_pc, best_mode = best, c, r, mode
                elif c > second:
                    second = c
        margin = best - second
        return best_pc, best_mode, margin / (margin + 0.15)
    except Exception:
        return None, None, 0.0


# ── backends ────────────────────────────────────────────────────────────────

DEFAULT_BACKEND = os.environ.get("CHORD_BACKEND", "lv-chordia")


# The model does not report per-segment posteriors, so every segment carries
# this honest-middle default: confident enough not to trip clients'
# low-confidence styling (<0.5), far from the 1.0 reserved for human-verified
# transcriptions.
_LV_DEFAULT_CONFIDENCE = 0.7
_LV_DICT = "submission"  # ~170-entry vocabulary incl. inversions; 'full' is slower and noisier


def _analyze_lv_chordia(audio: Path) -> list[tuple[float, float, str, float]]:
    """lv-chordia: Jiang et al. ISMIR 2019, chord structure decomposition.
    MIT code + MIT weights bundled in the wheel; torch-only; the one open
    model with slash-bass output. chord_recognition() is the package's single
    entry point: audio path in, [{start_time, end_time, chord}] out."""
    from lv_chordia.chord_recognition import chord_recognition

    result = chord_recognition(str(audio), chord_dict_name=_LV_DICT)
    return [
        (
            float(seg["start_time"]),
            float(seg["end_time"]),
            str(seg["chord"]),
            _LV_DEFAULT_CONFIDENCE,
        )
        for seg in result
    ]


_LV_MODEL_NAME = "lv-chordia-ensemble"
_LV_DICT_NAME = _LV_DICT


def _analyze_btc(audio: Path) -> list[tuple[float, float, str, float]]:
    """BTC large-voca (jayg996/BTC-ISMIR19, MIT incl. the committed
    checkpoints) - the documented fallback if the lv-chordia spot-check
    fails. Not vendored until needed:

        git clone --depth 1 https://github.com/jayg996/BTC-ISMIR19 worker/btc
        pip install pyyaml

    then implement this body after test.py's chunked inference (load
    btc_model_large_voca.pt with weights_only=False, chunk the CQT into
    timestep windows, argmax + idx2voca_chord). 170 classes, no slash bass.
    """
    raise NotImplementedError(
        "BTC backend not vendored - see worker/chords.py _analyze_btc docstring"
    )


BACKENDS = {"lv-chordia": _analyze_lv_chordia, "btc": _analyze_btc}


# ── the pipeline ────────────────────────────────────────────────────────────


def analyze(audio: Path, backend: str | None = None) -> dict:
    """Audio file -> chord-chart payload (see lib/formats/chords.ts)."""
    name = backend or DEFAULT_BACKEND
    if name not in BACKENDS:
        raise ValueError(f"unknown chord backend {name!r} (known: {', '.join(BACKENDS)})")

    raw = BACKENDS[name](Path(audio))

    segs: list[dict] = []
    for start, end, label, conf in raw:
        if end <= start:
            continue
        parsed = parse_harte(label)
        if parsed is None:
            continue  # N / X / unreadable - silence is a gap, not a segment
        segs.append({**parsed, "start": start, "end": end, "confidence": conf})
    segs.sort(key=lambda s: s["start"])

    segs = merge_adjacent(segs)
    segs = absorb_short(segs)
    if not segs:
        raise RuntimeError("chord analysis produced no usable segments")

    key_pc, key_mode, key_conf = estimate_key(Path(audio))
    use_flats = _uses_flats(key_pc, key_mode)

    import librosa

    duration_ms = int(round(librosa.get_duration(path=str(audio)) * 1000))

    segments = []
    for seg in segs:
        # Rebuild the Harte label with the root respelled for the key -
        # Bb:maj7 in F major, never A#:maj7. The bass stays a scale degree,
        # so only the root letter needs respelling.
        label = f"{_pc_name(seg['root_pc'], use_flats)}:{seg['hq']}"
        if seg.get("hdeg"):
            label += f"/{seg['hdeg']}"
        entry = {
            "start_ms": int(round(seg["start"] * 1000)),
            "end_ms": int(round(seg["end"] * 1000)),
            "label": label,
            "root_pc": seg["root_pc"],
            "quality": seg["quality"],
            "confidence": round(float(seg["confidence"]), 3),
        }
        if seg["ext"]:
            entry["ext"] = seg["ext"]
        if "bass_pc" in seg:
            entry["bass_pc"] = seg["bass_pc"]
        segments.append(entry)

    model, dict_name = (
        (_LV_MODEL_NAME, _LV_DICT_NAME) if name == "lv-chordia" else ("btc-large-voca", "large_voca_170")
    )
    return {
        "format_version": 1,
        "segments": segments,
        "meta": {
            "model": model,
            "dict": dict_name,
            "key_pc": key_pc,
            "key_mode": key_mode,
            "key_confidence": round(float(key_conf), 3),
            "analyzed_from": "original_mix",
            "duration_ms": max(duration_ms, segments[-1]["end_ms"] if segments else 0),
        },
    }
