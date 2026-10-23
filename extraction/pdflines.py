"""Low-level PDF line reconstruction for the KIT module handbook.

Turns PyMuPDF spans into positioned lines (one per visual baseline), while
dropping running headers/footers and white "badge" glyphs (M/T/V markers).
Everything here is deterministic: the same PDF always yields the same lines.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

HEADER_MAX_Y = 58.0   # running header ends around y=45
FOOTER_MIN_Y = 805.0  # running footer starts at y=812
BOLD_FLAG = 16
ITALIC_FLAG = 2
WHITE = 0xFFFFFF

# Glyph-level normalisation. The study-plan PDFs embedded in the handbook use
# typographic ligatures and a symbol-font bullet; one embedded font maps the
# "ff" ligature to U+01AF. These are encoding artefacts, not content.
GLYPH_MAP = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
    "Ư": "ff", "": "•",
}
GLYPH_STATS: dict[str, int] = {}


def normalize_glyphs(text: str) -> str:
    for k, v in GLYPH_MAP.items():
        if k in text:
            GLYPH_STATS[k] = GLYPH_STATS.get(k, 0) + text.count(k)
            text = text.replace(k, v)
    return text


@dataclass
class Span:
    x0: float
    x1: float
    y: float          # baseline
    top: float
    size: float
    bold: bool
    italic: bool
    color: int
    font: str
    text: str
    glued: bool = False  # span began with a ligature glyph: join to previous span without a space

    @property
    def is_link_color(self) -> bool:
        return self.color == 0x4664AA


@dataclass
class Line:
    page: int                     # 1-based PDF page number
    y: float
    spans: list[Span] = field(default_factory=list)

    @property
    def x0(self) -> float:
        vis = [s for s in self.spans if s.text.strip()]
        return min(s.x0 for s in vis) if vis else self.spans[0].x0

    @property
    def x1(self) -> float:
        return max(s.x1 for s in self.spans)

    @property
    def size(self) -> float:
        vis = [s for s in self.spans if s.text.strip()]
        return max(s.size for s in vis) if vis else 0

    @property
    def bold(self) -> bool:
        vis = [s for s in self.spans if s.text.strip() and s.text.strip() != "•"]
        return bool(vis) and all(s.bold for s in vis)

    @property
    def italic(self) -> bool:
        vis = [s for s in self.spans if s.text.strip()]
        return bool(vis) and all(s.italic for s in vis)

    @property
    def text(self) -> str:
        return join_spans(self.spans).strip()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<L p{self.page} y{self.y:.0f} x{self.x0:.0f} {'B' if self.bold else ' '} {self.size:.1f} {self.text[:80]!r}>"


def join_spans(spans: list[Span]) -> str:
    out = ""
    prev: Span | None = None
    for s in spans:
        if prev is not None:
            gap = s.x0 - prev.x1
            if gap > 1.2 and out and not out.endswith(" ") and not s.text.startswith(" ") and not s.glued:
                out += " "
        out += s.text
        prev = s
    out = out.replace(" ", " ")
    return re.sub(r"[ \t]{2,}", " ", out)


def page_spans(page: pymupdf.Page) -> list[Span]:
    spans: list[Span] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for s in line["spans"]:
                if not s["text"]:
                    continue
                if s["color"] == WHITE:
                    continue  # M / T / V badge letters on coloured squares
                x0, top, x1, _ = s["bbox"]
                base = s["origin"][1]
                if base < HEADER_MAX_Y or top > FOOTER_MIN_Y:
                    continue
                raw = s["text"]
                spans.append(Span(x0, x1, base, top, round(s["size"], 1),
                                  bool(s["flags"] & BOLD_FLAG) or "Bold" in s["font"],
                                  bool(s["flags"] & ITALIC_FLAG) or "Italic" in s["font"],
                                  s["color"], s["font"], normalize_glyphs(raw),
                                  glued=raw[:1] in GLYPH_MAP and raw[:1] != ""))
    return spans


def page_lines(page: pymupdf.Page, pno: int) -> list[Line]:
    spans = sorted(page_spans(page), key=lambda s: (round(s.y, 0), s.x0))
    lines: list[Line] = []
    for s in sorted(spans, key=lambda s: s.y):
        # group by baseline; emoji / symbol glyphs sit up to ~3pt off the baseline
        for ln in reversed(lines[-4:]):
            if abs(ln.y - s.y) <= 2.6:
                ln.spans.append(s)
                break
        else:
            lines.append(Line(pno, s.y, [s]))
    for ln in lines:
        ln.spans.sort(key=lambda s: s.x0)
    lines = [ln for ln in lines if ln.text]
    lines.sort(key=lambda ln: ln.y)
    return lines


def document_lines(doc: pymupdf.Document, first: int = 1, last: int | None = None) -> list[Line]:
    last = last or doc.page_count
    out: list[Line] = []
    for pno in range(first, last + 1):
        out.extend(page_lines(doc[pno - 1], pno))
    return out


def page_links(page: pymupdf.Page) -> list[dict]:
    """External URI links on a page with their rectangles."""
    res = []
    for ln in page.get_links():
        if ln.get("uri"):
            r = ln["from"]
            res.append({"uri": ln["uri"], "x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1})
    return res


def reflow(lines: list[Line], wrap_x: float = 470.0, line_gap: float | None = None) -> str:
    """Join visually wrapped lines into paragraphs while keeping list items
    and short lines on their own line. Text content is never altered.
    line_gap: max baseline distance of wrapped lines; default derives from the
    handbook body layout (10.3pt leading, 14pt paragraph spacing)."""
    if line_gap is None:
        join_max, para_min = 13.5, 13.0
    else:
        join_max, para_min = line_gap * 1.2, line_gap * 1.2
    out: list[str] = []
    prev: Line | None = None
    for ln in lines:
        t = ln.text
        bullet = t.startswith(("•", "◦", "▪", "-", "–")) or re.match(r"^(\d+[.)]|[a-z][.)])\s", t)
        if prev is not None and out and not bullet and prev.x1 >= wrap_x and prev.page == ln.page and (ln.y - prev.y) < join_max:
            if out[-1].endswith("-") and len(out[-1]) > 1 and out[-1][-2].isalnum():
                out[-1] += t
            else:
                out[-1] += " " + t
        elif prev is not None and out and not bullet and prev.x1 >= wrap_x and prev.page != ln.page:
            out[-1] += " " + t
        else:
            # preserve vertical paragraph gaps as blank lines
            if prev is not None and prev.page == ln.page and ln.y - prev.y > para_min and out:
                out.append("")
            out.append(t)
        prev = ln
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
