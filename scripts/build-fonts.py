#!/usr/bin/env python3
"""Build the Noto Sans JP fonts embedded in HiraKata's PDF progress reports.

The PDF renderer (server/report/pdf.js) embeds two static TrueType fonts:

    server/report/fonts/NotoSansJP-Regular.ttf   (wght 400)
    server/report/fonts/NotoSansJP-Bold.ttf      (wght 700)
    server/report/fonts/OFL.txt                  (SIL Open Font License 1.1)

They are produced from the official Noto Sans JP variable font published in the
google/fonts repository:

1. Download ``NotoSansJP[wght].ttf`` and ``OFL.txt`` into a fresh temporary
   directory (or use local copies via ``--source`` / ``--license``). Downloads
   are treated as untrusted data: they are only ever parsed by fontTools.
2. Subset the variable font to the Unicode ranges a report can contain (Latin,
   Latin-1, Latin Extended-A for the macron romaji ā ī ū ē ō, punctuation,
   arrows, shapes, kana, CJK unified ideographs including Extension A, CJK
   radicals and compatibility ideographs, full-width forms, plus a few small
   symbol blocks used in dictionary glosses) and to every character of the word
   bank ``data/words.json.gz`` (the whole JMdict; a plain ``.json`` bank works
   too) when that file exists. Hinting, vertical metrics and layout features a
   horizontal report never uses are dropped.
3. Instantiate the subset at wght=400 and wght=700 and give each static font
   proper names and style bits.
4. Verify the cmap of both outputs: all kana, macron vowels, the report's
   symbols (○ × – ✓ …), the grade kanji (秀 優 良 可 不) and every character of
   the word bank must be present; each file must stay under 5 MB.

A handful of word-bank characters do not exist in Noto Sans JP at all (a few
rare kanji such as 欙 and 饃, and Latin letters such as ą ł ş ṭ from loanword
glosses). They cannot be embedded, so verification accepts them: after a build
it knows exactly which wanted characters the source font lacks, and with
``--verify-only`` it accepts the documented ``KNOWN_UNSUPPORTED`` set. The PDF
renderer handles them at draw time: a kanji form containing such a character is
left out of the report, and other text folds accented letters to their base
letter (ą → a) or shows "?" (server/report/text.js).

The PDF renderer only embeds the glyphs a document actually uses, so the size of
these files affects the repository and server memory, not the PDFs.

Usage (from the repository root; requires Python 3.9+ and fontTools):

    python scripts/build-fonts.py                     # download, build, verify
    python scripts/build-fonts.py --source NotoSansJP[wght].ttf --license OFL.txt
    python scripts/build-fonts.py --verify-only       # check the committed fonts

Exit status is 0 on success, 1 when verification fails, 2 on usage or download
errors.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
except ImportError:  # pragma: no cover - environment guard
    sys.exit("fontTools is required: python -m pip install fonttools")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "server" / "report" / "fonts"
DEFAULT_WORDS = ROOT / "data" / "words.json.gz"
LEGACY_WORDS = ROOT / "data" / "words.json"

FONT_URL = "https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
LICENSE_URL = "https://github.com/google/fonts/raw/main/ofl/notosansjp/OFL.txt"
DOWNLOAD_TIMEOUT_S = 120
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 5 * 1024 * 1024
FAMILY = "Noto Sans JP"
POSTSCRIPT_FAMILY = "NotoSansJP"

# (style name, wght value, bold?)
STYLES = (("Regular", 400, False), ("Bold", 700, True))

# Unicode blocks a report may contain. The first group is the required set; the
# second covers small blocks that occasionally appear in JMdict glosses
# (Greek letters, ℃, №, ½, ①, ㎏ …). Only code points the font supports are kept.
UNICODE_RANGES = (
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x017F),  # Latin-1 Supplement + Latin Extended-A (ā ī ū ē ō)
    (0x2000, 0x206F),  # General Punctuation
    (0x2190, 0x21FF),  # Arrows
    (0x2500, 0x25FF),  # Box Drawing, Block Elements, Geometric Shapes (○)
    (0x2600, 0x27BF),  # Miscellaneous Symbols, Dingbats (✓)
    (0x3000, 0x30FF),  # CJK Symbols & Punctuation (incl. 々 〆 〇), Hiragana, Katakana
    (0x31F0, 0x31FF),  # Katakana Phonetic Extensions
    (0x3400, 0x4DBF),  # CJK Unified Ideographs Extension A (rare kanji of the full JMdict)
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms
    # --- small extras for dictionary glosses ---
    (0x0180, 0x024F),  # Latin Extended-B
    (0x0250, 0x02FF),  # IPA Extensions, Spacing Modifier Letters
    (0x0300, 0x036F),  # Combining Diacritical Marks
    (0x0370, 0x03FF),  # Greek and Coptic
    (0x0400, 0x04FF),  # Cyrillic
    (0x1E00, 0x1EFF),  # Latin Extended Additional
    (0x2070, 0x209F),  # Superscripts and Subscripts
    (0x20A0, 0x20CF),  # Currency Symbols
    (0x2100, 0x218F),  # Letterlike Symbols, Number Forms
    (0x2200, 0x23FF),  # Mathematical Operators, Miscellaneous Technical
    (0x2460, 0x24FF),  # Enclosed Alphanumerics
    (0x2E80, 0x2FDF),  # CJK Radicals Supplement, Kangxi Radicals
    (0x31C0, 0x31EF),  # CJK Strokes
    (0x3200, 0x33FF),  # Enclosed CJK Letters, CJK Compatibility
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
    (0xFE30, 0xFE4F),  # CJK Compatibility Forms
)

# OpenType features worth keeping for horizontal text (kerning, proportional
# kana alternates, ligatures, mark positioning, localized forms).
LAYOUT_FEATURES = ["ccmp", "locl", "liga", "kern", "mark", "mkmk", "palt", "halt"]

# Tables a static, horizontal, unhinted PDF font does not need.
DROP_TABLES = ["BASE", "STAT", "VORG", "vhea", "vmtx", "VVAR", "MVAR", "gasp", "DSIG", "meta"]

# Name records kept: copyright, family/style/unique/full/version/PostScript
# names, trademark, manufacturer, designer, URLs and the license description.
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]

# Characters the report layout itself draws; all must be covered.
REQUIRED_CHARS = (
    "".join(chr(c) for c in range(0x3041, 0x3097))  # hiragana ぁ…ゖ
    + "".join(chr(c) for c in range(0x30A1, 0x30FB))  # katakana ァ…ヺ
    + "ー・゛゜、。「」『』【】〜々"
    + "āīūēōĀĪŪĒŌ"
    + "○●×–—…·•✓→←↑↓▲▼★☆％＋"
    + "秀優良可不"
)

# Word-bank characters that Noto Sans JP (google/fonts, 2.004) does not contain,
# so no subset can carry them. ``--verify-only`` accepts exactly these; a full
# build computes the set from the source font instead.
KNOWN_UNSUPPORTED = frozenset(
    "欙疍皻饃"  # kanji forms (the report leaves such a form out)
    "ąčğłŚśşšžșʿḍḥḳṃṇṣṭ≒"  # gloss / origin text (folded to the base letter)
)


def _safe_streams() -> None:
    """Never crash on a console that cannot show kanji (e.g. cp1252 on Windows)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="backslashreplace")
        except (AttributeError, ValueError):  # pragma: no cover - exotic streams
            pass


def log(message: str) -> None:
    print(message, flush=True)


def fail(message: str, code: int = 2) -> None:
    print(f"error: {message}", file=sys.stderr, flush=True)
    sys.exit(code)


def download(url: str, dest: Path) -> None:
    """Fetch ``url`` into ``dest`` with a size cap (the content is untrusted)."""
    log(f"Downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "hirakata-build-fonts"})
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as response, dest.open("wb") as out:
            total = 0
            while chunk := response.read(1 << 16):
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    fail(f"{url} is larger than {MAX_DOWNLOAD_BYTES} bytes; refusing")
                out.write(chunk)
    except OSError as exc:
        fail(f"download failed for {url}: {exc}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


GZIP_MAGIC = bytes((0x1F, 0x8B))


def load_bank(words_path: Path) -> dict:
    """Read a word bank: gzip (``words.json.gz``) or plain JSON, detected from the content."""
    raw = words_path.read_bytes()
    if raw[:2] == GZIP_MAGIC:
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def collect_words_chars(words_path: Path) -> set[str]:
    """Every character a word entry can contribute to a report (kana, kanji, glosses …)."""
    bank = load_bank(words_path)
    chars: set[str] = set()

    def add(value) -> None:
        if isinstance(value, str):
            chars.update(value)
        elif isinstance(value, list):
            for item in value:
                add(item)

    for word in bank.get("words", []):
        for key in ("kana", "romaji", "kanji"):
            add(word.get(key))
        for sense in word.get("senses") or []:
            for key in ("gloss", "pos", "info"):
                add(sense.get(key))
        for origin in word.get("origin") or []:
            add(origin.get("lang"))
            add(origin.get("text"))
    # Control and format characters (ZWSP, ZWJ …) are never drawn by the report.
    return {c for c in chars if c.isprintable()}


def target_codepoints(source_cmap: dict[int, str], extra_chars: set[str]) -> list[int]:
    wanted = {cp for start, end in UNICODE_RANGES for cp in range(start, end + 1)}
    wanted.update(ord(c) for c in extra_chars)
    return sorted(cp for cp in wanted if cp in source_cmap)


def subset_options() -> subset.Options:
    options = subset.Options()
    options.layout_features = list(LAYOUT_FEATURES)
    options.hinting = False
    options.drop_tables = list(options.drop_tables) + DROP_TABLES
    options.name_IDs = list(NAME_IDS)
    options.name_languages = [0x0409]
    options.notdef_outline = True
    options.glyph_names = False
    options.legacy_cmap = False
    options.symbol_cmap = False
    options.prune_unicode_ranges = True
    options.recalc_bounds = True
    return options


def set_static_names(font: TTFont, style: str, weight: int, bold: bool) -> None:
    """Give an instance clean RIBBI names and matching OS/2 / head style bits."""
    postscript = f"{POSTSCRIPT_FAMILY}-{style}"
    name = font["name"]
    version = name.getDebugName(5) or "Version 1.000"
    version_number = version.removeprefix("Version ").split(";")[0]
    for name_id in (16, 17, 21, 22, 25):
        name.removeNames(nameID=name_id)
    records = {
        1: FAMILY,
        2: style,
        3: f"{version_number};GOOG;{postscript};HiraKata report subset",
        4: f"{FAMILY} {style}",
        6: postscript,
    }
    for name_id, value in records.items():
        name.removeNames(nameID=name_id)
        name.setName(value, name_id, 3, 1, 0x409)

    os2 = font["OS/2"]
    os2.usWeightClass = weight
    regular_bit, bold_bit, italic_bit = 1 << 6, 1 << 5, 1 << 0
    os2.fsSelection = (os2.fsSelection & ~(regular_bit | bold_bit | italic_bit)) | (bold_bit if bold else regular_bit)
    head = font["head"]
    head.macStyle = (head.macStyle & ~0b11) | (0b1 if bold else 0)


def build(source: Path, license_file: Path, out_dir: Path, words_chars: set[str]) -> set[str]:
    """Subset + instance the source font; returns the word-bank characters it lacks."""
    log(f"Source font: {source} (sha256 {sha256(source)})")
    varfont = TTFont(source)
    if "fvar" not in varfont or not any(axis.axisTag == "wght" for axis in varfont["fvar"].axes):
        fail("the source font is not a variable font with a wght axis")
    wght = next(axis for axis in varfont["fvar"].axes if axis.axisTag == "wght")
    if not all(wght.minValue <= weight <= wght.maxValue for _, weight, _ in STYLES):
        fail(f"the wght axis {wght.minValue}..{wght.maxValue} does not cover 400 and 700")
    log(f"Source: {varfont['name'].getDebugName(4)} - {varfont['name'].getDebugName(5)}")

    license_text = license_file.read_text(encoding="utf-8")
    if "SIL OPEN FONT LICENSE" not in license_text.upper():
        fail(f"{license_file} does not look like the SIL Open Font License")

    source_cmap = varfont.getBestCmap()
    unsupported = {c for c in words_chars if ord(c) not in source_cmap}
    if unsupported:
        log(f"The source font lacks {len(unsupported)} word-bank characters (the renderer substitutes them): "
            f"{describe(unsupported)}")
    codepoints = target_codepoints(source_cmap, words_chars)
    log(f"Subsetting to {len(codepoints)} code points ...")
    subsetter = subset.Subsetter(options=subset_options())
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(varfont)

    out_dir.mkdir(parents=True, exist_ok=True)
    for style, weight, bold in STYLES:
        log(f"Instancing wght={weight} ({style}) ...")
        static = instancer.instantiateVariableFont(varfont, {"wght": weight}, inplace=False)
        for tag in DROP_TABLES:
            if tag in static:
                del static[tag]
        set_static_names(static, style, weight, bold)
        target = out_dir / f"{POSTSCRIPT_FAMILY}-{style}.ttf"
        static.save(target)
        log(f"Wrote {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}")

    shutil.copyfile(license_file, out_dir / "OFL.txt")
    log(f"Wrote {out_dir / 'OFL.txt'}")
    return unsupported


def describe(chars) -> str:
    return " ".join(f"{c}(U+{ord(c):04X})" for c in sorted(chars))


def verify(out_dir: Path, words_chars: set[str], unsupported: frozenset[str] | set[str] = KNOWN_UNSUPPORTED) -> bool:
    """Check coverage and size of the built fonts; returns True when all checks pass.

    ``unsupported`` lists word-bank characters the source font itself lacks; they
    are reported but do not fail verification."""
    ok = True
    if not (out_dir / "OFL.txt").is_file():
        log("FAIL OFL.txt is missing")
        ok = False
    for style, weight, _ in STYLES:
        path = out_dir / f"{POSTSCRIPT_FAMILY}-{style}.ttf"
        if not path.is_file():
            log(f"FAIL {path.name} is missing")
            ok = False
            continue
        font = TTFont(path)
        cmap = font.getBestCmap()
        size = path.stat().st_size
        missing_required = {c for c in REQUIRED_CHARS if ord(c) not in cmap}
        missing_all = {c for c in words_chars if ord(c) not in cmap}
        accepted = missing_all & set(unsupported)
        missing_words = missing_all - accepted
        kanji = sum(1 for cp in cmap if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF)
        log(
            f"{path.name}: {size / 1048576:.2f} MB, {len(font.getGlyphOrder())} glyphs, "
            f"{len(cmap)} code points ({kanji} kanji), weight {font['OS/2'].usWeightClass}, "
            f"PostScript name {font['name'].getDebugName(6)}"
        )
        if font["OS/2"].usWeightClass != weight:
            log(f"FAIL {path.name}: usWeightClass is not {weight}")
            ok = False
        if any(tag in font for tag in ("fvar", "gvar")):
            log(f"FAIL {path.name}: still contains variation tables")
            ok = False
        if size > MAX_OUTPUT_BYTES:
            log(f"FAIL {path.name}: larger than {MAX_OUTPUT_BYTES / 1048576:.0f} MB")
            ok = False
        if missing_required:
            log(f"FAIL {path.name}: missing required characters {describe(missing_required)}")
            ok = False
        if words_chars:
            if missing_words:
                log(f"FAIL {path.name}: missing {len(missing_words)} word-bank characters {describe(missing_words)}")
                ok = False
            else:
                covered = len(words_chars) - len(accepted)
                log(f"  covers {covered} of {len(words_chars)} distinct word-bank characters")
                if accepted:
                    log(f"  not in Noto Sans JP, substituted when drawn: {describe(accepted)}")
    return ok


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, help="local NotoSansJP[wght].ttf instead of downloading it")
    parser.add_argument("--license", type=Path, help="local OFL.txt instead of downloading it")
    parser.add_argument("--words", type=Path, default=DEFAULT_WORDS, help="word bank to cover, .json.gz or .json (default: data/words.json.gz)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory (default: server/report/fonts)")
    parser.add_argument("--verify-only", action="store_true", help="only verify the existing output fonts")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    _safe_streams()
    args = parse_args(argv)
    words_chars: set[str] = set()
    if not args.words.is_file() and args.words == DEFAULT_WORDS and LEGACY_WORDS.is_file():
        args.words = LEGACY_WORDS
    if args.words.is_file():
        words_chars = collect_words_chars(args.words)
        log(f"Word bank: {args.words} ({len(words_chars)} distinct characters)")
    else:
        log(f"Word bank {args.words} not found; checking the built-in character set only")

    unsupported: frozenset[str] | set[str] = KNOWN_UNSUPPORTED
    if not args.verify_only:
        with tempfile.TemporaryDirectory(prefix="hirakata-fonts-") as tmp:
            tmp_dir = Path(tmp)
            source = args.source
            license_file = args.license
            if source is None:
                source = tmp_dir / "NotoSansJP-VF.ttf"
                download(FONT_URL, source)
            if license_file is None:
                license_file = tmp_dir / "OFL.txt"
                download(LICENSE_URL, license_file)
            for path in (source, license_file):
                if not path.is_file():
                    fail(f"{path} does not exist")
            unsupported = build(source, license_file, args.out, words_chars)

    if verify(args.out, words_chars, unsupported):
        log("All font checks passed.")
        return 0
    log("Font verification failed.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
