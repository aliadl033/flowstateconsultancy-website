#!/usr/bin/env python3
# Vendored copy of ~/.claude/skills/menselijke-nl-copy/scripts/check_copy.py (tools/check.mjs runs it
# on every post.md). Behaviour is identical; the only change is that the literal em and en dash
# characters are written as \u2014 and \u2013 escapes, so this repository holds no typographic
# dashes. To update: copy the original again and re-apply the escapes.
"""Scan text for the AI tells this skill bans.

Usage:
    python check_copy.py --lang nl file.html [more files...]
    cat draft.txt | python check_copy.py --lang en

Exits 1 when something is found, so it can gate a delivery.
HTML/JSX input is stripped of tags first, so class names and hex colors
don't produce noise.
"""

import argparse
import re
import sys
from pathlib import Path

DASH_TYPO = re.compile(r"\u2014|\u2013")
DASH_ASCII = re.compile(r"(?<=\w)\s+-\s+(?=\w)")
# In code staat een losse \u2014 vaak voor "geen waarde" in een tabelcel. Daar
# tellen alleen streepjes die echt twee stukken zin aan elkaar plakken.
DASH_TYPO_STRICT = re.compile(r"(?<=\w)\s*[\u2014\u2013]\s*(?=\w)")

HINT = (
    "Fix each line before delivering. Dashes become a comma, period or colon; "
    "banned phrases become a concrete claim; bold lead-ins become prose."
)

NL_PHRASES = [
    r"\bnaadloo(?:s|ze)\b", r"\bkrachtige?\b", r"\bontgrendel\w*",
    r"\bontdek de wereld van\b", r"\bduik in\b", r"\bkortom\b",
    r"^\s*Bovendien\b", r"\bof je nu\b", r"\bKlaar om\b",
    r"\blaten we eerlijk zijn\b", r"\bniet zomaar een\b",
    r"\bdé oplossing\b", r"\bongeëvenaard\w*", r"\brevolutionair\w*",
    r"\bnaar een hoger niveau\b", r"\bin de wereld van vandaag\b",
]

EN_PHRASES = [
    r"\bdelve\b", r"\bseamless(?:ly)?\b", r"\brobust\b", r"\bleverag(?:e|ing)\b",
    r"\bunlock\b", r"\belevate\b", r"\bempower\w*", r"\bharness\b",
    r"\btapestry\b", r"\btestament to\b", r"\bgame.?chang\w*",
    r"\bcutting.edge\b", r"\bin today's fast.paced world\b",
    r"\blet's dive in\b", r"\bhere's the thing\b", r"\bin conclusion\b",
    r"\bat the end of the day\b", r"\bwhether you're a\b",
    r"\bready to get started\b", r"\bit's not just\b", r"\bunparalleled\b",
    r"\bbest.in.class\b", r"\bthe ultimate\b",
]

BOLD_LEAD_IN = re.compile(r"^\s*[-*]\s*\*\*[^*]{1,30}\*\*\s*:|^\s*[-*]\s*\*\*[^*]{1,30}:\*\*", re.M)
TITLE_CASE_HEADING = re.compile(r"^#{1,3}\s+(?:[A-Z][a-z]+\s+){2,}[A-Z][a-z]+\s*$", re.M)


def strip_markup(text: str) -> str:
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"&[a-z]+;", " ", text)


NL_MARKERS = re.compile(
    r"\b(de|het|een|niet|voor|met|jij|jouw|wij|onze|maar|ook|zijn|worden|"
    r"wordt|naar|jullie|dat|deze|geen)\b", re.I)
EN_MARKERS = re.compile(
    r"\b(the|and|you|your|we|our|with|for|this|that|are|is|will|from|"
    r"they|their|have|has|but|not)\b", re.I)


def detect_lang(text: str) -> str:
    """Kies de taal op basis van veelvoorkomende woorden.

    Bij twijfel wint Nederlands, want dat is de standaard voor deze teksten.
    De streepjescontrole is toch taalonafhankelijk, dus een misser kost
    hooguit een gemiste woordmelding.
    """
    nl = len(NL_MARKERS.findall(text))
    en = len(EN_MARKERS.findall(text))
    return "en" if en > nl * 1.5 else "nl"


def scan(text: str, lang: str, code: bool = False):
    findings = []
    patterns = [DASH_TYPO_STRICT] if code else [DASH_TYPO, DASH_ASCII]
    for pattern in patterns:
        for m in pattern.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            findings.append((line, "dash", context(text, m.start())))

    phrases = NL_PHRASES if lang == "nl" else EN_PHRASES
    for pattern in phrases:
        for m in re.finditer(pattern, text, re.I | re.M):
            line = text.count("\n", 0, m.start()) + 1
            findings.append((line, "phrase", context(text, m.start())))

    for m in BOLD_LEAD_IN.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        findings.append((line, "bold lead-in", context(text, m.start())))

    for m in TITLE_CASE_HEADING.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        findings.append((line, "Title Case heading", context(text, m.start())))

    return sorted(findings)


def context(text: str, pos: int, width: int = 60) -> str:
    start = max(0, pos - width // 2)
    return " ".join(text[start:start + width].split())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--lang", choices=["nl", "en", "auto"], default="nl")
    ap.add_argument("--raw", action="store_true", help="skip HTML tag stripping")
    ap.add_argument("--code", action="store_true",
                    help="strengere streepjesregel voor bestanden met code erin: "
                         "een minteken of een losse \u2014 als lege waarde telt niet mee")
    args = ap.parse_args()

    sources = []
    if args.files:
        for f in args.files:
            sources.append((f, Path(f).read_text(encoding="utf-8", errors="replace")))
    else:
        sources.append(("stdin", sys.stdin.read()))

    total = 0
    for name, raw in sources:
        text = raw if args.raw else strip_markup(raw)
        lang = detect_lang(text) if args.lang == "auto" else args.lang
        findings = scan(text, lang, code=args.code)
        total += len(findings)
        for line, kind, snippet in findings:
            print(f"{name}:{line}: {kind}: …{snippet}…")

    if total:
        print(f"\n{total} issue(s). {HINT}", file=sys.stderr)
        return 1
    print("Clean: no dashes as punctuation, no banned phrases.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
