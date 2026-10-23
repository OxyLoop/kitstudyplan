"""Deterministic extraction of the KIT CDS (M.Sc.) module handbook.

Usage:
    python extraction/extract_handbook.py [path/to/mhb-master-cds.pdf]

Outputs (public/data/):
    handbook.json            metadata, table of contents, section page ranges
    program-structure.json   study program structure tree (chapter 3)
    modules.json             module records (chapter 4), incl. eligibility
    module-components.json   module component records (chapter 5)
    regulations.json         disclaimer + study plan text (chapters 1-2)
    handbook-pages.json      verbatim text of every PDF page (fallback/source view)
    extraction-report.json   validation results (also written as Markdown to extraction/report/)
"""
from __future__ import annotations

import hashlib
import shutil
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pymupdf

from pdflines import GLYPH_STATS, Line, Span, document_lines, join_spans, page_links, reflow

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
REPORT_DIR = ROOT / "extraction" / "report"

MODULE_ID = r"M-[A-Z]+-\d{6}"
COMPONENT_ID = r"T-[A-Z]+-\d{6}"

# Official section headings used by the handbook generator. Anything bold that is
# not in this list stays inside the body text of the current section.
SECTION_HEADINGS = {
    "Assessment": "assessment",
    "Prerequisites": "prerequisites",
    "Modeled Prerequisites": "modeledPrerequisites",
    "Modelled Conditions": "modeledConditions",
    "Competence Goal": "competenceGoal",
    "Content": "content",
    "Module Grade Calculation": "moduleGradeCalculation",
    "Additional Information": "additionalInformation",
    "Workload": "workload",
    "Recommendations": "recommendations",
    "Literature": "literature",
    "Teaching and Learning Methods": "teachingAndLearningMethods",
    "Organizational issues": "organizationalIssues",
    "Base For": "baseFor",
    "Election Notes": "electionNotes",
    "Election notes": "electionNotes",
    "Election Regulations": "electionRegulations",
    "Self Service Assignment of Supplementary Studies": "selfServiceAssignment",
}
GRID_LABELS = {"Credits", "Grading", "Recurrence", "Duration", "Language", "Level", "Version",
               "Type", "Term offered", "Expansion"}
HEADER_LABELS = {"Coordinators:": "coordinators", "Organisation:": "organisation", "Part of:": "partOf"}

TOP_FIELDS = [
    "Master's Thesis",
    "Mathematics for Computational and Data Science",
    "Computer Science",
    "Sciences, Engineering, Economics",
    "Specialization",
    "Hackathon, High Performance Computing and Research Data Management",
    "Interdisciplinary Qualifications",
    "Additional Examinations",
]

MODE_ICONS = {"🖥": "online", "🧩": "blended", "🗣": "on-site", "🗙": "cancelled"}


# --------------------------------------------------------------------------- helpers

def norm_term(raw: str | None) -> str:
    """Normalise an offering value to WT | ST | WT+ST | IRREGULAR | SEE_NOTES | UNKNOWN.
    The original value is always stored next to the normalised one."""
    if not raw:
        return "UNKNOWN"
    r = raw.strip().lower()
    if r in ("wt", "each winter term", "winter term"):
        return "WT"
    if r in ("st", "each summer term", "summer term"):
        return "ST"
    if r in ("wt+st", "each term", "every term"):
        return "WT+ST"
    if r.startswith("irreg"):
        return "IRREGULAR"
    if r.replace(" ", "") in ("seenotes", "seeannotations"):
        return "SEE_NOTES"
    if "winter" in r and "summer" not in r:
        return "WT"
    if "summer" in r and "winter" not in r:
        return "ST"
    return "UNKNOWN"


def norm_language(raw: str | None) -> list[str]:
    if not raw:
        return []
    r = raw.lower()
    codes = []
    for key, code in (("english", "EN"), ("german", "DE"), ("deutsch", "DE"), ("en", "EN"), ("de", "DE")):
        if re.search(rf"\b{key}\b", r) and code not in codes:
            codes.append(code)
    return codes


def parse_credits(raw: str | None) -> dict:
    if not raw:
        return {"raw": None, "value": None, "min": None, "max": None}
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)", raw)
    if m:
        a, b = (float(x.replace(",", ".")) for x in m.groups())
        return {"raw": raw, "value": None, "min": a, "max": b}
    m = re.search(r"(\d+(?:[.,]\d+)?)", raw)
    if m:
        v = float(m.group(1).replace(",", "."))
        v = int(v) if v.is_integer() else v
        return {"raw": raw, "value": v, "min": v, "max": v}
    return {"raw": raw, "value": None, "min": None, "max": None}


def is_section_heading(ln: Line) -> str | None:
    if ln.bold and ln.x0 < 100 and abs(ln.size - 9.0) < 0.4:
        return SECTION_HEADINGS.get(ln.text.strip())
    return None


def group_label(text: str) -> dict:
    """Parse e.g. 'Compulsory Elective Courses (Elective: at least 9 credits)'."""
    m = re.match(r"^(.*?)\s*\((Elective|Election):\s*(.*?)\)\s*$", text)
    if m:
        return {"label": text, "name": m.group(1).strip(), "kind": "elective", "constraint": m.group(3).strip() or None}
    return {"label": text, "name": text, "kind": "mandatory" if text.strip() == "Mandatory" else "other", "constraint": None}


def column_of(x: float, bounds: list[tuple[str, float]]) -> str:
    col = bounds[0][0]
    for name, start in bounds:
        if x >= start:
            col = name
    return col


class Report:
    def __init__(self) -> None:
        self.errors: list[dict] = []
        self.warnings: list[dict] = []
        self.ambiguities: list[dict] = []
        self.info: dict = {}

    def err(self, code, msg, **ctx):
        self.errors.append({"code": code, "message": msg, **ctx})

    def warn(self, code, msg, **ctx):
        self.warnings.append({"code": code, "message": msg, **ctx})

    def amb(self, code, msg, **ctx):
        self.ambiguities.append({"code": code, "message": msg, **ctx})


R = Report()


# --------------------------------------------------------------------------- TOC

def parse_printed_toc(lines: list[Line]) -> list[dict]:
    """Printed TOC (pages 2-17). Long entries wrap: the page number may sit on the
    first or the last visual line; continuation lines are indented."""
    raw: list[dict] = []
    for ln in lines:
        if not (2 <= ln.page <= 17) or ln.text.strip() == "Table Of Contents":
            continue
        t = ln.text.strip()
        page = None
        mp = re.match(r"^(.*?)\s*\.+\s*(\d+)$", t)
        if mp and (mp.group(1).endswith(".") or "..." in t or re.search(r"\s\.+\d+$", t) or re.search(r"\.{2,}\s*\d+$", t)):
            t, page = mp.group(1).rstrip(" ."), int(mp.group(2))
        mn = re.match(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$", t)
        if mn and ln.x0 < 90:
            raw.append({"number": mn.group(1), "title": mn.group(2), "page": page, "tocPage": ln.page})
        elif raw:
            prev = raw[-1]
            joiner = "" if (prev["title"].endswith("-") and prev["title"][-2:-1].isalnum()) else " "
            prev["title"] = (prev["title"] + joiner + t).strip()
            if page is not None and prev["page"] is None:
                prev["page"] = page
    out = []
    for entry in raw:
        entry["title"] = re.sub(r"\s+", " ", entry["title"]).strip()
        mm = re.match(rf"^(.*?)(?:\s+\[([^\]]+)\])?\s+-\s+({MODULE_ID}|{COMPONENT_ID})$", entry["title"])
        if mm:
            entry["name"], entry["code"], entry["id"] = mm.group(1).strip(), mm.group(2), mm.group(3)
        if entry["page"] is None:
            R.warn("TOC_ENTRY_NO_PAGE", "Printed TOC entry without page number", number=entry["number"])
        out.append(entry)
    return out


# --------------------------------------------------------------------------- record segmentation

HEAD_RE = re.compile(r"^(\d+\.\d+) (Module|Module component): ")


def split_records(lines: list[Line], first_page: int, last_page: int) -> list[tuple[list[Line], list[Line]]]:
    """Return [(title_lines, body_lines)] for every module/component heading."""
    region = [ln for ln in lines if first_page <= ln.page <= last_page]
    starts = [i for i, ln in enumerate(region) if ln.bold and abs(ln.size - 12) < 0.3 and HEAD_RE.match(ln.text)]
    recs = []
    for k, i in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else len(region)
        j = i
        title = [region[j]]
        while "]" not in " ".join(t.text for t in title) and j + 1 < end:
            j += 1
            title.append(region[j])
        body = region[j + 1:end]
        # drop chapter headings ("5 Module components") that may trail
        body = [b for b in body if not (b.bold and b.size >= 12.9)]
        recs.append((title, body))
    return recs


def parse_title(title_lines: list[Line]) -> dict:
    t = ""
    for ln in title_lines:
        piece = ln.text.strip()
        t = t + piece if (t.endswith("-") and len(t) > 1 and t[-2].isalnum()) else (t + " " + piece if t else piece)
    m = re.match(r"^(\d+\.\d+) (Module|Module component): (.*) \[((?:M|T)-[A-Z]+-\d+)\]$", t)
    if not m:
        return {"raw": t}
    return {"raw": t, "number": m.group(1), "kind": m.group(2), "label": m.group(3), "id": m.group(4)}


# --------------------------------------------------------------------------- field parsing

def parse_header(body: list[Line], idx: int, rec: dict) -> int:
    """Coordinators / Organisation / Part of block (label column right-aligned ~110)."""
    cur = None
    values: dict[str, list[Line]] = defaultdict(list)
    while idx < len(body):
        ln = body[idx]
        first = next((s for s in ln.spans if s.text.strip()), None)
        lab = first.text.strip() if first else ""
        if first and first.bold and lab in HEADER_LABELS and first.x1 < 118:
            cur = HEADER_LABELS[lab]
            rest = [s for s in ln.spans if s is not first]
            if rest:
                values[cur].append(Line(ln.page, ln.y, rest))
            idx += 1
            continue
        if cur and ln.x0 >= 118 and not ln.bold:
            values[cur].append(ln)
            idx += 1
            continue
        break
    for k, lns in values.items():
        rec["_header_" + k] = lns
    return idx


def split_part_of_module(lns: list[Line]) -> list[str]:
    """Module 'Part of' values: each entry is link-coloured and terminated by a
    trailing non-link blank span."""
    entries, cur = [], ""
    for ln in lns:
        vis = [s for s in ln.spans if s.text.strip()]
        txt = join_spans(vis).strip()
        cur = (cur + txt) if cur.endswith("-") else (cur + " " + txt).strip()
        last = ln.spans[-1]
        if not last.text.strip() and not last.is_link_color:
            entries.append(cur)
            cur = ""
    if cur:
        entries.append(cur)
    return [re.sub(r"\s+", " ", e).strip() for e in entries if e.strip()]


def split_part_of_component(lns: list[Line]) -> list[dict]:
    txt = " ".join(ln.text for ln in lns)
    out = []
    for m in re.finditer(rf"({MODULE_ID}) - (.*?)(?=\s+{MODULE_ID} - |$)", txt):
        out.append({"moduleId": m.group(1), "moduleName": m.group(2).strip()})
    return out


def parse_grid(body: list[Line], idx: int, rec: dict) -> int:
    if idx >= len(body):
        return idx
    ln = body[idx]
    labels = [s for s in ln.spans if s.text.strip()]
    if not (ln.bold and labels and all(s.text.strip() in GRID_LABELS for s in labels)):
        return idx
    centers = [((s.x0 + s.x1) / 2, s.text.strip()) for s in labels]
    vals: dict[str, list[str]] = defaultdict(list)
    idx += 1
    y_prev = ln.y
    while idx < len(body):
        v = body[idx]
        if v.bold or v.y - y_prev > 12.5 or v.page != ln.page:
            break
        for s in v.spans:
            if not s.text.strip():
                continue
            c = (s.x0 + s.x1) / 2
            lab = min(centers, key=lambda t: abs(t[0] - c))[1]
            vals[lab].append(s.text.strip())
        y_prev = v.y
        idx += 1
    rec["_grid"] = {k: " ".join(v) for k, v in vals.items()}
    for _, lab in centers:
        rec["_grid"].setdefault(lab, None)
    return idx


def collect_sections(lines: list[Line], rec_id: str) -> tuple[dict, list[dict]]:
    """Split lines into official sections. Lines before the first heading are
    returned as section 'unassigned'."""
    sections: dict[str, dict] = {}
    order: list[dict] = []
    cur_key, cur_title, cur_lines = "unassigned", None, []

    def flush():
        if cur_lines or cur_title:
            text = reflow(cur_lines)
            entry = {"key": cur_key, "heading": cur_title, "text": text,
                     "page": cur_lines[0].page if cur_lines else None}
            order.append(entry)
            if cur_key in sections:  # repeated heading: append, never drop
                sections[cur_key]["text"] += "\n\n" + text
            else:
                sections[cur_key] = {"text": text, "page": entry["page"]}

    for ln in lines:
        key = is_section_heading(ln)
        if key:
            flush()
            cur_key, cur_title, cur_lines = key, ln.text.strip(), []
        else:
            cur_lines.append(ln)
    flush()
    return sections, order


# --------------------------------------------------------------------------- module component table (inside modules)

def parse_component_table(body: list[Line], idx: int, rec: dict) -> int:
    """Table 'ID | Name | Term offered | Credits | Lecturers' with group rows."""
    rows, groups = [], []
    bounds = None
    group = None
    while idx < len(body):
        ln = body[idx]
        t = ln.text.strip()
        if is_section_heading(ln):
            break
        if ln.bold and t == "Term" and ln.x0 > 300:
            idx += 1
            continue
        if ln.bold and t.startswith("ID Name"):
            sp = {s.text.strip(): s.x0 for s in ln.spans if s.text.strip()}
            prev = body[idx - 1] if idx > 0 else None
            term_x = sp.get("offered", 999)
            if prev and prev.text.strip() == "Term":
                term_x = min(term_x, prev.x0)
            bounds = [("id", 0), ("name", sp.get("Name", 130) - 6), ("term", term_x - 6),
                      ("credits", sp.get("Credits", 418) - 4), ("lecturers", sp.get("Lecturers", 456) - 4)]
            idx += 1
            continue
        if bounds is None:
            break
        first = next((s for s in ln.spans if s.text.strip()), None)
        if first and re.fullmatch(COMPONENT_ID, first.text.strip()) and first.x0 < bounds[1][1]:
            row = {"id": first.text.strip(), "name": "", "termOffered": "", "credits": "", "lecturers": "",
                   "group": group["label"] if group else None, "notes": [], "page": ln.page}
            for s in ln.spans[ln.spans.index(first) + 1:]:
                c = column_of(s.x0, bounds)
                if c != "id":
                    row[{"term": "termOffered"}.get(c, c)] += s.text
            rows.append(row)
        elif ln.bold and ln.x0 < bounds[1][1] and ln.size >= 8.5:
            group = group_label(t)
            group["page"] = ln.page
            groups.append(group)
        elif rows and ln.size < 8.5:
            rows[-1]["notes"].append(t)
        elif rows:
            for s in ln.spans:
                c = column_of(s.x0, bounds)
                key = {"term": "termOffered"}.get(c, c)
                if key == "id":
                    rows[-1]["notes"].append(s.text.strip())
                else:
                    sep = "" if rows[-1][key].endswith(("-", " ")) else " "
                    rows[-1][key] = (rows[-1][key] + sep + s.text).strip() if rows[-1][key] else s.text
        else:
            break
        idx += 1
    for r in rows:
        for k in ("name", "termOffered", "credits", "lecturers"):
            r[k] = re.sub(r"\s+", " ", r[k]).strip()
        r["termNormalized"] = norm_term(r["termOffered"])
        r["creditsParsed"] = parse_credits(r["credits"])
    rec["components"] = rows
    rec["componentGroups"] = groups
    return idx


# --------------------------------------------------------------------------- courses table (inside components)

SEM_RE = re.compile(r"^(WT|ST|WS|SS) ?(\d{2}/\d{2}|\d{4})$")


def norm_semester(raw: str) -> dict:
    m = SEM_RE.match(raw.strip())
    if not m:
        return {"raw": raw, "term": None, "label": None}
    t, y = m.groups()
    term = "WT" if t in ("WT", "WS") else "ST"
    if term == "WT" and len(y) == 5:
        label = f"WS 20{y[:2]}/{y[3:]}"
    elif term == "WT":
        label = f"WS {y}/{str(int(y) + 1)[2:]}"
    else:
        label = f"SS {y}"
    return {"raw": raw, "term": term, "label": label}


def parse_courses_table(body: list[Line], idx: int, comp: dict, links_by_page: dict) -> int:
    bounds = [("semester", 0), ("number", 92), ("title", 168), ("sws", 316), ("type", 360), ("lecturers", 452)]
    courses = []
    while idx < len(body):
        ln = body[idx]
        t = ln.text.strip()
        if t.startswith("Legend:"):
            idx += 1
            break
        if is_section_heading(ln) or ln.italic:
            break
        first = next((s for s in ln.spans if s.text.strip()), None)
        if first and first.x0 < 92 and SEM_RE.match(first.text.strip()):
            row = {k: "" for k, _ in bounds}
            courses.append(row)
            row["page"] = ln.page
            row["url"] = None
            for lk in links_by_page.get(ln.page, []):
                if lk["y0"] - 1 <= ln.y <= lk["y1"] + 3 and 160 <= lk["x0"] <= 200:
                    row["url"] = lk["uri"]
                    break
        elif not courses:
            break
        row = courses[-1]
        for s in ln.spans:
            if not s.text.strip():
                continue
            c = column_of(s.x0, bounds)
            sep = "" if (row[c].endswith("-") or not row[c]) else " "
            row[c] = (row[c] + sep + s.text.strip())
        idx += 1
    out = []
    for r in courses:
        typ = r["type"]
        mode = None
        for icon, name in MODE_ICONS.items():
            if icon in typ:
                mode = name
                typ = typ.replace(icon, "")
        types = [p.strip() for p in typ.split("/") if p.strip()]
        out.append({
            "semester": norm_semester(r["semester"]),
            "number": r["number"] or None,
            "title": re.sub(r"\s+", " ", r["title"]).strip(),
            "sws": r["sws"] or None,
            "typeRaw": r["type"],
            "types": types,
            "mode": mode,
            "lecturers": r["lecturers"] or None,
            "url": r["url"],
            "page": r["page"],
        })
    comp["courses"] = out
    return idx


def parse_excerpts(lines: list[Line], links_by_page: dict[int, list[dict]]) -> list[dict]:
    """'Below you will find excerpts from courses related to this module component'."""
    excerpts, cur, buf = [], None, []

    def flush():
        if cur is not None:
            modes = ("On-Site", "Online", "Blended (On-Site/Online)", "Cancelled")
            if cur["typeRaw"] in modes and cur["format"] is None:
                cur["format"], cur["typeRaw"] = cur["typeRaw"], None
            secs, order = collect_sections(buf, cur["title"])
            cur["sections"] = {k: v for k, v in secs.items()}
            excerpts.append(cur)

    for ln in lines:
        big = [s for s in ln.spans if s.bold and abs(s.size - 11) < 0.3]
        if big and big[0].x0 < 100 and cur is not None and cur["meta"] is None and not buf:
            cur["title"] = (cur["title"] + " " + join_spans(big).strip()).strip()
            right = [s for s in ln.spans if s.x0 > 400 and s.bold and s not in big]
            if right and cur["typeRaw"] is None:
                cur["typeRaw"] = join_spans(right).strip()
            continue
        if big and big[0].x0 < 100:
            flush()
            right = [s for s in ln.spans if s.x0 > 400 and s.bold and s not in big]
            cur = {"title": join_spans(big).strip(), "meta": None, "number": None, "semester": None,
                   "sws": None, "language": None, "typeRaw": join_spans(right).strip() or None,
                   "format": None, "url": None, "page": ln.page}
            buf = []
            continue
        if cur is not None and cur["meta"] is None and any(abs(s.size - 8.8) < 0.1 and s.x0 < 100 for s in ln.spans):
            meta_sp = [s for s in ln.spans if abs(s.size - 8.8) < 0.1]
            right = [s for s in ln.spans if s.x0 > 400 and s.bold]
            meta = join_spans(meta_sp).strip()
            cur["meta"] = meta
            parts = [p.strip() for p in meta.split(",")]
            if parts:
                cur["number"] = parts[0]
            for p in parts[1:]:
                if SEM_RE.match(p):
                    cur["semester"] = norm_semester(p)
                elif p.endswith("SWS"):
                    cur["sws"] = p
                elif p.startswith("Language:"):
                    cur["language"] = p.split(":", 1)[1].strip()
            if right:
                cur["format"] = join_spans(right).strip()
            for lk in links_by_page.get(ln.page, []):
                if lk["y0"] - 1 <= ln.y <= lk["y1"] + 3 and lk["x0"] > 200:
                    cur["url"] = lk["uri"]
                    break
            continue
        if cur is not None and not buf and ln.bold and ln.x0 > 400:
            if cur["typeRaw"] is None:
                cur["typeRaw"] = ln.text.strip()
            elif cur["format"] is None:
                cur["format"] = ln.text.strip()
            else:
                buf.append(ln)
            continue
        if cur is not None:
            buf.append(ln)
    flush()
    return excerpts


# --------------------------------------------------------------------------- module / component record

def finish_common(rec: dict, title: dict, body: list[Line]) -> None:
    rec["id"] = title.get("id")
    rec["number"] = title.get("number")
    rec["titleRaw"] = title.get("raw")
    pages = [ln.page for ln in body]
    rec["pages"] = {"start": None, "end": max(pages) if pages else None}


def parse_module(title: dict, title_lines: list[Line], body: list[Line], toc_by_id: dict) -> dict:
    rec: dict = {}
    finish_common(rec, title, body)
    rec["pages"]["start"] = title_lines[0].page
    tocent = toc_by_id.get(rec["id"])
    label = title.get("label", "")
    if tocent:
        rec["name"] = tocent["name"]
        rec["code"] = tocent.get("code")
    else:
        mm = re.match(r"^(.*?)(?: \(([^()]*)\))?$", label)
        rec["name"], rec["code"] = (mm.group(1), mm.group(2)) if mm else (label, None)
        R.warn("MODULE_NOT_IN_TOC", "Module heading not found in printed table of contents", id=rec["id"])
    idx = parse_header(body, 0, rec)
    idx = parse_grid(body, idx, rec)
    rec["components"], rec["componentGroups"] = [], []
    text_lines: list[Line] = []
    tables = 0
    while idx < len(body):
        ln = body[idx]
        nxt = body[idx + 1] if idx + 1 < len(body) else None
        if (ln.bold and ln.text.strip() == "Term" and nxt is not None and nxt.text.startswith("ID Name")) or                 (ln.bold and ln.text.startswith("ID Name")):
            tables += 1
            sub: dict = {}
            idx = parse_component_table(body, idx, sub)
            rec["components"] += sub["components"]
            rec["componentGroups"] += sub["componentGroups"]
            continue
        text_lines.append(ln)
        idx += 1
    if tables > 1:
        R.amb("MULTIPLE_COMPONENT_TABLES", "Module page has more than one component table (merged)", id=rec["id"])
    sections, order = collect_sections(text_lines, rec["id"])
    g = rec.pop("_grid", {})
    rec["coordinators"] = " ".join(l.text for l in rec.get("_header_coordinators", [])) or None
    rec["organisation"] = " ".join(l.text for l in rec.get("_header_organisation", [])) or None
    rec["partOfRaw"] = split_part_of_module(rec.pop("_header_partOf", []))
    rec["partOf"] = []
    for p in rec["partOfRaw"]:
        usage = None
        mu = re.match(r"^(.*?)\s*\((Usage [^()]*)\)\s*$", p)
        if mu:
            p_core, usage = mu.group(1), mu.group(2)
        else:
            p_core = p
        mm = re.match(r"^(.*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$", p_core)
        path, grp = (mm.group(1), mm.group(2)) if mm else (p_core, None)
        rec["partOf"].append({"raw": p, "path": path.strip(), "group": grp, "usage": usage})
    rec.pop("_header_coordinators", None)
    rec.pop("_header_organisation", None)
    rec["credits"] = parse_credits(g.get("Credits"))
    rec["grading"] = g.get("Grading")
    rec["recurrence"] = {"raw": g.get("Recurrence"), "normalized": norm_term(g.get("Recurrence"))}
    rec["duration"] = g.get("Duration")
    rec["language"] = {"raw": g.get("Language"), "codes": norm_language(g.get("Language"))}
    rec["level"] = g.get("Level")
    rec["version"] = g.get("Version")
    rec["otherFields"] = {k: v for k, v in g.items() if k not in
                          {"Credits", "Grading", "Recurrence", "Duration", "Language", "Level", "Version"}}
    rec["sections"] = sections
    rec["sectionOrder"] = [{"key": o["key"], "heading": o["heading"], "page": o["page"]} for o in order]
    return rec


def parse_component(title: dict, title_lines: list[Line], body: list[Line], links_by_page) -> dict:
    rec: dict = {}
    finish_common(rec, title, body)
    rec["pages"]["start"] = title_lines[0].page
    rec["name"] = title.get("label")
    idx = parse_header(body, 0, rec)
    idx = parse_grid(body, idx, rec)
    rec["courses"] = []
    if idx < len(body) and body[idx].bold and body[idx].text.strip() == "Courses":
        idx = parse_courses_table(body, idx + 1, rec, links_by_page)
    # excerpts start at the italic notice line
    rest = body[idx:]
    cut = next((i for i, ln in enumerate(rest) if ln.italic and ln.text.startswith("Below you will find excerpts")), None)
    main, exc = (rest, []) if cut is None else (rest[:cut], rest[cut + 1:])
    sections, order = collect_sections(main, rec["id"])
    rec["excerpts"] = parse_excerpts(exc, links_by_page)
    g = rec.pop("_grid", {})
    rec["coordinators"] = " ".join(l.text for l in rec.pop("_header_coordinators", [])) or None
    rec["organisation"] = " ".join(l.text for l in rec.pop("_header_organisation", [])) or None
    rec["partOf"] = split_part_of_component(rec.pop("_header_partOf", []))
    rec["type"] = g.get("Type")
    rec["credits"] = parse_credits(g.get("Credits"))
    rec["grading"] = g.get("Grading")
    rec["termOffered"] = {"raw": g.get("Term offered"), "normalized": norm_term(g.get("Term offered"))}
    rec["expansion"] = g.get("Expansion")
    rec["version"] = g.get("Version")
    rec["otherFields"] = {k: v for k, v in g.items() if k not in
                          {"Type", "Credits", "Grading", "Term offered", "Expansion", "Version"}}
    rec["sections"] = sections
    rec["sectionOrder"] = [{"key": o["key"], "heading": o["heading"], "page": o["page"]} for o in order]
    return rec


# --------------------------------------------------------------------------- program structure (chapter 3)

STRUCT_HEAD = re.compile(r"^(3(?:\.\d+)*) (.+?)\s*$")


def parse_structure(lines: list[Line], first: int, last: int) -> dict:
    region = [ln for ln in lines if first <= ln.page <= last]
    nodes: list[dict] = []
    root = {"number": "3", "title": "Study Program Structure", "page": first, "credits": None,
            "overview": [], "groups": [], "electionNotes": None, "modeledConditions": None, "children": []}
    cur = root
    mode = None
    bounds = None
    group = None
    text_buf: list[Line] = []

    def flush_text():
        nonlocal text_buf, mode
        if text_buf and mode in ("electionNotes", "modeledConditions"):
            t = reflow(text_buf)
            cur[mode] = (cur[mode] + "\n\n" + t) if cur[mode] else t
        elif text_buf:
            cur.setdefault("otherText", []).append(reflow(text_buf))
        text_buf = []

    i = 0
    while i < len(region):
        ln = region[i]
        t = ln.text.strip()
        heads = [s for s in ln.spans if s.bold and s.size >= 8.9 and s.x0 < 500]
        if heads and heads[0].x0 < 140 and re.match(r"^3(?:\.\d+)* \S", join_spans(heads).strip()):
            htxt = join_spans(heads).strip()
            m = STRUCT_HEAD.match(htxt)
            if m and m.group(1) != "3":
                flush_text()
                node = {"number": m.group(1), "title": m.group(2).strip(), "page": ln.page, "credits": None,
                        "partOf": None, "groups": [], "electionNotes": None, "modeledConditions": None, "children": []}
                nodes.append(node)
                cur = node
                mode, bounds, group = None, None, None
                i += 1
                continue
            if m and m.group(1) == "3":
                i += 1
                continue
        if cur is root and root is not None and not nodes:
            # overview list on first page: "Mandatory", field rows with credits
            if t not in ("Mandatory", "Voluntary"):
                root["overview"].append(t)
            else:
                root["overview"].append(f"[{t}]")
            i += 1
            continue
        if t.startswith("Part of:") and ln.size < 9.0 + 0.01:
            cur["partOf"] = re.sub(r"\s+", " ", join_spans([s for s in ln.spans if s.x0 < 500])).replace("Part of:", "").strip()
            cr = [s.text.strip() for s in ln.spans if s.x0 >= 500 and s.text.strip()]
            if cr:
                cur["credits"] = parse_credits(cr[0])
            # small-font continuation line(s) of a wrapped "Part of"
            while i + 1 < len(region) and region[i + 1].page == ln.page and (
                    (region[i + 1].size < 8.0 and region[i + 1].bold) or
                    (region[i + 1].x0 > 500 and re.fullmatch(r"\d+(-\d+)?", region[i + 1].text.strip()))):
                i += 1
                if region[i].x0 > 500:
                    cur["credits"] = parse_credits(region[i].text.strip())
                else:
                    cur["partOf"] += " " + region[i].text.strip()
            i += 1
            continue
        if t in ("Credits",) or (ln.x0 > 500 and re.fullmatch(r"\d+(-\d+)?", t)):
            if re.fullmatch(r"\d+(-\d+)?", t):
                cur["credits"] = parse_credits(t)
            i += 1
            continue
        if ln.bold and t in ("Election notes", "Election Notes"):
            flush_text()
            mode = "electionNotes"
            i += 1
            continue
        if ln.bold and t in ("Modelled Conditions", "Modeled Conditions"):
            flush_text()
            mode = "modeledConditions"
            i += 1
            continue
        if ln.bold and t == "Term" and ln.x0 > 400:
            i += 1
            continue
        if ln.bold and t.startswith("ID Name"):
            flush_text()
            sp = {s.text.strip(): s.x0 for s in ln.spans if s.text.strip()}
            bounds = [("id", 0), ("name", sp["Name"] - 6), ("language", sp["Language"] - 2),
                      ("term", sp["offered"] - 4), ("credits", sp["Credits"] - 2)]
            mode = "table"
            i += 1
            continue
        first_sp = next((s for s in ln.spans if s.text.strip()), None)
        if mode == "table" and first_sp and re.fullmatch(MODULE_ID, first_sp.text.strip()):
            row = {"moduleId": first_sp.text.strip(), "name": "", "language": "", "termOffered": "", "credits": "",
                   "notes": [], "page": ln.page}
            for s in ln.spans[ln.spans.index(first_sp) + 1:]:
                c = column_of(s.x0, bounds)
                key = {"term": "termOffered"}.get(c, c)
                if key != "id":
                    row[key] += s.text
            if group is None:
                group = {"label": None, "name": None, "kind": "other", "constraint": None, "page": ln.page, "entries": []}
                cur["groups"].append(group)
            group["entries"].append(row)
            i += 1
            continue
        if mode == "table" and ln.bold and ln.size >= 8.5 and bounds and ln.x0 < bounds[1][1]:
            group = group_label(t)
            group["page"] = ln.page
            group["entries"] = []
            cur["groups"].append(group)
            i += 1
            continue
        if mode == "table" and group and group["entries"] and ln.size < 8.5:
            group["entries"][-1]["notes"].append(t)
            i += 1
            continue
        if mode == "table" and group and group["entries"] and bounds and ln.x0 >= bounds[1][1] - 1:
            e = group["entries"][-1]
            for s in ln.spans:
                key = {"term": "termOffered"}.get(column_of(s.x0, bounds), column_of(s.x0, bounds))
                if key == "id":
                    continue
                e[key] = (e[key].rstrip() + ("" if e[key].endswith("-") else " ") + s.text.strip()).strip()
            i += 1
            continue
        # child-node listing rows (e.g. profile list "Business and Economics  16-32 CP")
        if ln.bold and re.search(r"\((Elective|Election):", t):
            flush_text()
            group = group_label(t)
            group["page"] = ln.page
            group["entries"] = []
            cur["groups"].append(group)
            mode = "childlist"
            i += 1
            continue
        if mode == "childlist" and not ln.bold and re.search(r"\d+(-\d+)? CP$", t):
            m = re.match(r"^(.*?)\s+(\d+(?:-\d+)? CP)$", t)
            group["entries"].append({"moduleId": None, "name": m.group(1), "credits": m.group(2), "childNode": True,
                                     "page": ln.page, "language": None, "termOffered": None, "notes": []})
            i += 1
            continue
        if mode == "childlist":
            mode = None
        text_buf.append(ln)
        i += 1
    flush_text()

    # nest nodes by numbering depth (the PDF numbers two sibling nodes "3.5.3.6.1",
    # so the numbers are not unique; nesting uses document order + depth)
    seen = Counter()
    stack: list[dict] = []
    for n in nodes:
        seen[n["number"]] += 1
        n["uid"] = n["number"] if seen[n["number"]] == 1 else f'{n["number"]}#{seen[n["number"]]}'
        if seen[n["number"]] > 1:
            R.amb("DUPLICATE_STRUCTURE_NUMBER", "Structure section number used twice in the handbook; disambiguated",
                  number=n["number"], title=n["title"], uid=n["uid"], page=n["page"])
        depth = n["number"].count(".")
        while stack and stack[-1]["number"].count(".") >= depth:
            stack.pop()
        parent = stack[-1] if stack else root
        n["parentUid"] = parent.get("uid")
        parent["children"].append(n["uid"])
        stack.append(n)
    # clean entries
    for n in nodes:
        for g in n["groups"]:
            for e in g["entries"]:
                for k in ("name", "language", "termOffered", "credits"):
                    if isinstance(e.get(k), str):
                        e[k] = re.sub(r"\s+", " ", e[k]).strip()
                if e.get("termOffered") is not None:
                    e["termNormalized"] = norm_term(e["termOffered"])
                e["creditsParsed"] = parse_credits(e.get("credits"))
    return {"root": root, "nodes": nodes}


def node_path(node: dict, by_uid: dict) -> list[str]:
    parts = []
    n = node
    while n is not None:
        parts.append(n["title"])
        n = by_uid.get(n.get("parentUid"))
    return list(reversed(parts))


# --------------------------------------------------------------------------- eligibility categories

SEE_PROFILES = [
    "Business and Economics", "Computational Chemistry", "Computational Earth System Sciences",
    "Computational Mechanics and Thermodynamics", "Computational Physics",
    "Electrical Engineering and Information Technology", "Process Engineering", "Robotics and Autonomous Systems",
]


def categorize_path(path: list[str]) -> dict:
    """Map a structure path to an accounting subject and profile/focus metadata."""
    top = path[0] if path else ""
    info = {"subject": None, "profile": None, "focus": None, "specialization": None}
    if top == "Mathematics for Computational and Data Science":
        info["subject"] = "MATH"
    elif top == "Computer Science":
        info["subject"] = "CS"
    elif top == "Sciences, Engineering, Economics":
        info["subject"] = "SEE"
        info["profile"] = path[1] if len(path) > 1 else None
        info["focus"] = path[2] if len(path) > 2 else None
    elif top == "Specialization":
        info["subject"] = "SPEC"
        sub = path[1] if len(path) > 1 else ""
        if sub.startswith("Specialization Mathematics"):
            info["specialization"] = "MATH"
        elif sub == "Specialization Computer Science":
            info["specialization"] = "CS"
        elif sub.startswith("Specialization Sciences"):
            info["specialization"] = "SEE"
            info["profile"] = path[2] if len(path) > 2 else None
            info["focus"] = path[3] if len(path) > 3 else None
    elif top.startswith("Hackathon"):
        info["subject"] = "HPC_RDM"
    elif top == "Interdisciplinary Qualifications":
        info["subject"] = "IQ"
    elif top == "Master's Thesis":
        info["subject"] = "THESIS"
    elif top == "Additional Examinations":
        info["subject"] = "ADDITIONAL"
    return info


# --------------------------------------------------------------------------- regulations (chapters 1-2)

def typical_gap(lines: list[Line]) -> float:
    gaps = sorted(b.y - a.y for a, b in zip(lines, lines[1:]) if a.page == b.page and 5 < b.y - a.y < 30)
    return gaps[len(gaps) // 2] if gaps else 13.0


def parse_regulations(doc: pymupdf.Document, lines: list[Line]) -> dict:
    disclaimer = [ln for ln in lines if ln.page == 18]
    plan = [ln for ln in lines if 19 <= ln.page <= 32]
    # drop the repeating "E Studienplan ..." page title and the trailing file-name footers
    plan = [ln for ln in plan if not ln.text.startswith("E Studienplan Master Computational and Data Science")
            and not ln.text.startswith("2 E_Studienplan")]
    disclaimer = [ln for ln in disclaimer if not ln.text.startswith("1 DISCLAIMER")]
    # chapter split: numbered headings appear as a line "N" or "N.N" followed by the heading line
    chapters, cur = [], {"number": None, "title": "Preamble", "page": 19, "lines": []}
    i = 0
    while i < len(plan):
        ln = plan[i]
        t = ln.text.strip()
        m = re.fullmatch(r"(\d+(?:\.\d+)*)\.?", t)
        m2 = re.match(r"^(\d+\.\d+(?:\.\d+)?)\.?\s+(\S.*)$", t)
        if m and i + 1 < len(plan) and len(plan[i + 1].text) < 110:
            chapters.append(cur)
            cur = {"number": m.group(1), "title": plan[i + 1].text.strip(), "page": ln.page, "lines": []}
            i += 2
            continue
        m3 = re.match(r"^(\d+(?:\.\d+)*)\.?\s+(\S.{2,90})$", t) if ln.bold else None
        if m3 and not m2:
            chapters.append(cur)
            cur = {"number": m3.group(1), "title": m3.group(2).strip(), "page": ln.page, "lines": []}
            i += 1
            continue
        if m2 and len(t) < 80 and not t.endswith("."):
            chapters.append(cur)
            cur = {"number": m2.group(1), "title": m2.group(2).strip(), "page": ln.page, "lines": []}
            i += 1
            continue
        cur["lines"].append(ln)
        i += 1
    chapters.append(cur)
    out_ch = [{"number": c["number"], "title": c["title"], "page": c["page"],
               "text": reflow(c["lines"], wrap_x=430, line_gap=typical_gap(plan))} for c in chapters if c["lines"] or c["number"]]
    # Tables 1-5 of the study plan are embedded images without a text layer
    image_pages = []
    for pno in range(19, 33):
        imgs = doc[pno - 1].get_images(full=True)
        if imgs:
            image_pages.append({"page": pno, "images": len(imgs)})
    return {
        "disclaimer": {"page": 18, "text": reflow(disclaimer, wrap_x=380, line_gap=typical_gap(disclaimer))},
        "studyPlan": {"pages": {"start": 19, "end": 32}, "chapters": out_ch,
                      "imageOnlyContent": image_pages,
                      "imageNote": "Tables 1-5 of the study plan (program structure overview and exemplary semester plans) are "
                                   "embedded as images without a text layer. They are not machine-extracted; consult the PDF pages listed."},
    }


# --------------------------------------------------------------------------- main

def main(pdf_path: Path) -> int:
    doc = pymupdf.open(pdf_path)
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    lines = document_lines(doc)
    outline = doc.get_toc()
    printed_toc = parse_printed_toc(lines)
    toc_by_id = {e["id"]: e for e in printed_toc if e.get("id")}

    def outline_page(title_prefix: str) -> int:
        for lvl, t, p in outline:
            if lvl == 1 and t.strip().startswith(title_prefix):
                return p
        raise SystemExit(f"Outline entry {title_prefix!r} not found")

    p_struct, p_mod, p_comp = outline_page("Study Program Structure"), outline_page("Modules"), outline_page("Module components")
    links_by_page = {p: page_links(doc[p - 1]) for p in range(p_comp, doc.page_count + 1)}

    # ---- chapter 3
    structure = parse_structure(lines, p_struct, p_mod - 1)
    by_uid = {n["uid"]: n for n in structure["nodes"]}
    for n in structure["nodes"]:
        n["path"] = node_path(n, by_uid)
        n["category"] = categorize_path(n["path"])

    # ---- chapter 4
    modules = []
    for tl, body in split_records(lines, p_mod, p_comp - 1):
        title = parse_title(tl)
        if title.get("kind") != "Module":
            R.err("MODULE_TITLE_UNPARSED", "Could not parse module heading", raw=title.get("raw"), page=tl[0].page)
            continue
        modules.append(parse_module(title, tl, body, toc_by_id))

    # ---- chapter 5
    components = []
    for tl, body in split_records(lines, p_comp, doc.page_count):
        title = parse_title(tl)
        if title.get("kind") != "Module component":
            R.err("COMPONENT_TITLE_UNPARSED", "Could not parse component heading", raw=title.get("raw"), page=tl[0].page)
            continue
        components.append(parse_component(title, tl, body, links_by_page))

    # ---- eligibility from structure (independent of module 'Part of')
    elig: dict[str, list[dict]] = defaultdict(list)
    struct_rows: dict[str, list[dict]] = defaultdict(list)
    for n in structure["nodes"]:
        for g in n["groups"]:
            for e in g["entries"]:
                if e.get("moduleId"):
                    item = {"node": n["uid"], "path": n["path"], "pathLabel": " / ".join(n["path"]),
                            "group": g.get("label"), "groupKind": g.get("kind"),
                            "groupConstraint": g.get("constraint"), **n["category"], "page": e["page"]}
                    elig[e["moduleId"]].append(item)
                    struct_rows[e["moduleId"]].append(e)

    comp_by_id = {c["id"]: c for c in components}
    for m in modules:
        m["eligibility"] = elig.get(m["id"], [])
        m["structureListings"] = [{"node": x["node"], "language": r["language"], "termOffered": r["termOffered"],
                                   "termNormalized": r.get("termNormalized"), "credits": r["credits"], "notes": r["notes"]}
                                  for x, r in zip(elig.get(m["id"], []), struct_rows.get(m["id"], []))]
        # winter offering evidence
        rec = m["recurrence"]["normalized"]
        sched_ws, sched_courses, types = False, [], set()
        for cr in m["components"]:
            c = comp_by_id.get(cr["id"])
            if not c:
                continue
            for co in c["courses"]:
                types.update(co["types"])
                if co["semester"]["label"] == "WS 2026/27":
                    sched_ws = True
                    sched_courses.append({"componentId": c["id"], "number": co["number"], "title": co["title"],
                                          "types": co["types"], "mode": co["mode"]})
        m["offering"] = {
            "recurrence": rec,
            "structureTerms": sorted({r.get("termNormalized") for r in struct_rows.get(m["id"], []) if r.get("termNormalized")}),
            "scheduledWS2026": sched_ws,
            "scheduledCoursesWS2026": sched_courses,
        }
        m["activityTypes"] = sorted(types)

    # ------------------------------------------------------------------ validation
    validate(doc, printed_toc, outline, structure, modules, components)

    # ------------------------------------------------------------------ write
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    meta = doc.metadata
    handbook = {
        "university": "Karlsruhe Institute of Technology",
        "program": "Computational and Data Science (M.Sc.)",
        "regulations": "SPO 2026",
        "semester": "Winter Semester 2026/27",
        "handbookDate": "2026-10-20",
        "handbookDateRaw": "Module Handbook as of 20/10/2026",
        "pdf": {"file": pdf_path.name, "pages": doc.page_count, "sha256": sha,
                "title": meta.get("title"), "author": meta.get("author"), "creationDate": meta.get("creationDate")},
        "chapters": [{"title": t.strip(), "page": p} for lvl, t, p in outline if lvl == 1],
        "outline": [{"level": lvl, "title": t.strip(), "page": p} for lvl, t, p in outline],
        "printedToc": printed_toc,
        "counts": {"modules": len(modules), "components": len(components), "structureNodes": len(structure["nodes"])},
        "extractor": {"script": "extraction/extract_handbook.py", "pymupdf": pymupdf.VersionBind},
    }
    pages = [{"page": i + 1, "text": doc[i].get_text()} for i in range(doc.page_count)]
    regulations = parse_regulations(doc, lines)

    def dump(name, obj):
        (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=None, separators=(",", ":")), encoding="utf-8")

    # the app links to PDF pages, so it serves its own copy of the source PDF
    pdf_copy = ROOT / "public" / pdf_path.name
    if not pdf_copy.exists() or hashlib.sha256(pdf_copy.read_bytes()).hexdigest() != sha:
        shutil.copy2(pdf_path, pdf_copy)
    dump("handbook.json", handbook)
    dump("program-structure.json", structure)
    dump("modules.json", modules)
    dump("module-components.json", components)
    dump("regulations.json", regulations)
    dump("handbook-pages.json", pages)
    report = build_report(handbook, modules, components, structure)
    dump("extraction-report.json", report)
    (REPORT_DIR / "extraction-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPORT_DIR / "extraction-report.md").write_text(report_md(report), encoding="utf-8")
    print(f"modules={len(modules)} components={len(components)} nodes={len(structure['nodes'])} "
          f"errors={len(R.errors)} warnings={len(R.warnings)} ambiguities={len(R.ambiguities)}")
    return 1 if R.errors else 0


# --------------------------------------------------------------------------- validation

REQUIRED_MODULE = ["name", "credits", "grading", "recurrence", "language", "coordinators", "organisation"]
REQUIRED_MODULE_SECTIONS = ["assessment", "prerequisites", "competenceGoal", "content", "workload"]
REQUIRED_COMPONENT = ["name", "type", "credits", "grading"]


def validate(doc, printed_toc, outline, structure, modules, components):
    mod_ids = [m["id"] for m in modules]
    comp_ids = [c["id"] for c in components]
    for kind, ids in (("module", mod_ids), ("component", comp_ids)):
        for i, n in Counter(ids).items():
            if n > 1:
                R.err("DUPLICATE_ID", f"Duplicate {kind} ID", id=i, count=n)
    mod_by = {m["id"]: m for m in modules}
    comp_by = {c["id"]: c for c in components}

    # TOC comparison (printed TOC and PDF outline)
    toc_mod = {e["id"]: e for e in printed_toc if e.get("id", "").startswith("M-")}
    toc_comp = {e["id"]: e for e in printed_toc if e.get("id", "").startswith("T-")}
    out_ids = {}
    for lvl, t, p in outline:
        m = re.search(r"\[((?:M|T)-[A-Z]+-\d+)\]\s*$", t.strip())
        if m:
            out_ids[m.group(1)] = p
    R.info["toc"] = {"printedModules": len(toc_mod), "printedComponents": len(toc_comp),
                     "outlineIds": len(out_ids)}
    for i in set(toc_mod) - set(mod_ids):
        R.err("TOC_MODULE_MISSING", "Module listed in table of contents but not extracted", id=i, page=toc_mod[i]["page"])
    for i in set(toc_comp) - set(comp_ids):
        R.err("TOC_COMPONENT_MISSING", "Component listed in table of contents but not extracted", id=i, page=toc_comp[i]["page"])
    for i in set(mod_ids) - set(toc_mod):
        R.err("MODULE_NOT_IN_TOC", "Extracted module not in printed table of contents", id=i)
    for i in set(comp_ids) - set(toc_comp):
        R.err("COMPONENT_NOT_IN_TOC", "Extracted component not in printed table of contents", id=i)
    for i in set(out_ids) - set(mod_ids) - set(comp_ids):
        R.err("OUTLINE_ID_MISSING", "ID in PDF bookmarks not extracted", id=i)

    # page references
    for rec in modules + components:
        toc = toc_mod.get(rec["id"]) or toc_comp.get(rec["id"])
        p = rec["pages"]["start"]
        if not (1 <= p <= doc.page_count):
            R.err("PAGE_OUT_OF_RANGE", "Page reference outside PDF", id=rec["id"], page=p)
        if toc and toc["page"] != p:
            R.err("PAGE_MISMATCH_TOC", "Start page differs from table of contents", id=rec["id"], page=p, toc=toc["page"])
        if rec["id"] in out_ids and out_ids[rec["id"]] != p:
            R.err("PAGE_MISMATCH_OUTLINE", "Start page differs from PDF bookmark", id=rec["id"], page=p, outline=out_ids[rec["id"]])
        if rec["id"] not in doc[p - 1].get_text():
            R.err("PAGE_ID_NOT_ON_PAGE", "Record ID not present in text of its start page", id=rec["id"], page=p)
        if toc and rec.get("name") and toc.get("name") and rec["name"] != toc["name"]:
            R.amb("NAME_DIFFERS_TOC", "Name differs between heading and table of contents",
                  id=rec["id"], heading=rec["name"], toc=toc["name"])

    # value-on-page verification: every extracted header value must occur verbatim
    # (whitespace-normalised) in the text of the record's pages
    def page_text(rec):
        return re.sub(r"\s+", " ", " ".join(doc[p - 1].get_text() for p in range(rec["pages"]["start"], rec["pages"]["end"] + 1)))
    checked = 0
    for rec in modules + components:
        txt = page_text(rec)
        vals = [rec["credits"]["raw"], rec.get("grading")]
        vals += [rec["recurrence"]["raw"], rec["language"]["raw"]] if "recurrence" in rec else [rec["termOffered"]["raw"], rec.get("type")]
        vals += [x["id"] for x in rec.get("components", [])]
        vals += [co["number"] for co in rec.get("courses", []) if co["number"]]
        for v in vals:
            if v is None:
                continue
            checked += 1
            if re.sub(r"\s+", " ", v) not in txt:
                R.err("VALUE_NOT_ON_PAGE", "Extracted value not found verbatim on the record's pages", id=rec["id"], value=v)
    R.info["valuesVerifiedOnPage"] = checked

    # missing fields
    missing = defaultdict(list)
    for m in modules:
        for f in REQUIRED_MODULE:
            v = m.get(f)
            if v is None or (isinstance(v, dict) and (v.get("raw") is None)):
                missing[f].append(m["id"])
        for s in REQUIRED_MODULE_SECTIONS:
            if s not in m["sections"]:
                missing["section:" + s].append(m["id"])
        if "unassigned" in m["sections"]:
            R.warn("MODULE_UNASSIGNED_TEXT", "Text before first section heading kept as 'unassigned'",
                   id=m["id"], page=m["sections"]["unassigned"]["page"], preview=m["sections"]["unassigned"]["text"][:120])
        if m["recurrence"]["normalized"] == "UNKNOWN":
            R.amb("RECURRENCE_UNNORMALIZED", "Recurrence value could not be normalised", id=m["id"], raw=m["recurrence"]["raw"])
        if m["otherFields"]:
            R.info.setdefault("moduleOtherFields", {})[m["id"]] = m["otherFields"]
    cmissing = defaultdict(list)
    for c in components:
        for f in REQUIRED_COMPONENT:
            v = c.get(f)
            if v is None or (isinstance(v, dict) and v.get("raw") is None):
                cmissing[f].append(c["id"])
        if "unassigned" in c["sections"]:
            R.warn("COMPONENT_UNASSIGNED_TEXT", "Text before first section heading kept as 'unassigned'",
                   id=c["id"], page=c["sections"]["unassigned"]["page"], preview=c["sections"]["unassigned"]["text"][:120])
        for co in c["courses"]:
            if co["semester"]["term"] is None:
                R.warn("COURSE_SEMESTER_UNPARSED", "Course semester label not recognised", id=c["id"], raw=co["semester"]["raw"])
            if co["sws"] and not re.fullmatch(r"\d+(?:[.,]\d+)? SWS", co["sws"]):
                R.warn("COURSE_SWS_UNPARSED", "Course SWS cell not in expected format", id=c["id"], raw=co["sws"])
        for ex in c["excerpts"]:
            if not ex.get("meta"):
                R.warn("EXCERPT_META_MISSING", "Course excerpt without meta line", id=c["id"], title=ex["title"])
    R.info["missingModuleFields"] = {k: v for k, v in missing.items()}
    R.info["missingComponentFields"] = {k: v for k, v in cmissing.items()}

    # referential integrity + linkage
    for m in modules:
        for cr in m["components"]:
            c = comp_by.get(cr["id"])
            if not c:
                R.err("MODULE_COMPONENT_MISSING", "Module references a component that has no description",
                      id=m["id"], component=cr["id"])
                continue
            if m["id"] not in [p["moduleId"] for p in c["partOf"]]:
                R.err("LINK_NOT_RECIPROCAL", "Component does not list module in 'Part of'", id=m["id"], component=cr["id"])
            if cr["creditsParsed"]["value"] is not None and c["credits"]["value"] is not None and \
                    cr["creditsParsed"]["value"] != c["credits"]["value"]:
                R.err("COMPONENT_CREDIT_MISMATCH", "Component credits differ between module table and component page",
                      id=m["id"], component=cr["id"], inModule=cr["credits"], inComponent=c["credits"]["raw"])
        if not m["components"]:
            R.warn("MODULE_WITHOUT_COMPONENTS", "Module lists no module components", id=m["id"])
    for c in components:
        if not c["partOf"]:
            R.warn("COMPONENT_ORPHAN", "Component lists no parent module", id=c["id"])
        for p in c["partOf"]:
            mm = mod_by.get(p["moduleId"])
            if not mm:
                R.amb("COMPONENT_PARENT_OUTSIDE_HANDBOOK", "Component's parent module is not described in this handbook",
                      id=c["id"], module=p["moduleId"])
            elif c["id"] not in [x["id"] for x in mm["components"]]:
                R.err("LINK_NOT_RECIPROCAL", "Module does not list component", id=p["moduleId"], component=c["id"])

    # credit consistency
    for m in modules:
        mc = m["credits"]["value"]
        comps = m["components"]
        if mc is None:
            continue
        mand = [c for c in comps if (c.get("group") or "").strip() == "Mandatory"]
        groups = {g["label"]: g for g in m["componentGroups"]}
        has_elective = any(g["kind"] != "mandatory" for g in m["componentGroups"])
        tot_mand = sum(c["creditsParsed"]["value"] or 0 for c in mand)
        if not has_elective:
            if tot_mand != mc and comps:
                R.warn("CREDIT_SUM_MISMATCH", "Sum of mandatory component credits differs from module credits",
                       id=m["id"], module=mc, components=tot_mand)
        elif tot_mand > mc:
            R.warn("CREDIT_SUM_EXCEEDS", "Mandatory component credits exceed module credits", id=m["id"], module=mc, components=tot_mand)
        for lst in m["structureListings"]:
            sc = parse_credits(lst["credits"])
            if sc["value"] is not None and sc["value"] != mc:
                R.err("STRUCTURE_CREDIT_MISMATCH", "Module credits differ between structure table and module page",
                      id=m["id"], node=lst["node"], structure=lst["credits"], module=m["credits"]["raw"])
    # structure references
    for n in structure["nodes"]:
        for g in n["groups"]:
            for e in g["entries"]:
                if e.get("moduleId") and e["moduleId"] not in mod_by:
                    R.err("STRUCTURE_MODULE_MISSING", "Structure lists a module with no description", id=e["moduleId"], node=n["number"])
    # Part-of vs structure cross-check
    for m in modules:
        struct_paths = {" / ".join(x["path"]) for x in m["eligibility"]}
        struct_pairs = {(" / ".join(x["path"]), x["group"]) for x in m["eligibility"]}
        for p in m["partOf"]:
            if p["path"] not in struct_paths:
                R.err("PARTOF_NOT_IN_STRUCTURE", "'Part of' entry on module page does not match a structure node",
                      id=m["id"], partOf=p["raw"])
            elif p["group"] and not any(path == p["path"] and g and (g.lower() == p["group"].lower() or g.startswith(p["group"] + " ("))
                                        for path, g in struct_pairs):
                R.amb("PARTOF_GROUP_DIFFERS", "'Part of' group name not found in the structure node's groups",
                      id=m["id"], partOf=p["raw"])
        for path in struct_paths - {p["path"] for p in m["partOf"]}:
            R.warn("STRUCTURE_NOT_IN_PARTOF", "Structure lists module in a node that its 'Part of' does not mention",
                   id=m["id"], node=path)
        if not m["eligibility"]:
            R.warn("MODULE_NOT_IN_STRUCTURE", "Module is described but not listed in any structure table", id=m["id"])
    # any record parsed with zero body text
    for rec in modules + components:
        if not rec["sections"]:
            R.warn("NO_DESCRIPTION_SECTIONS", "Handbook entry contains no description sections (only header data)",
                   id=rec["id"], page=rec["pages"]["start"])


def build_report(handbook, modules, components, structure):
    codes = Counter(w["code"] for w in R.warnings)
    acodes = Counter(a["code"] for a in R.ambiguities)
    ecodes = Counter(e["code"] for e in R.errors)
    return {
        "pdf": handbook["pdf"],
        "summary": {
            "modulesExtracted": len(modules),
            "componentsExtracted": len(components),
            "structureNodes": len(structure["nodes"]),
            "modulesInToc": R.info["toc"]["printedModules"],
            "componentsInToc": R.info["toc"]["printedComponents"],
            "errors": len(R.errors), "warnings": len(R.warnings), "ambiguities": len(R.ambiguities),
            "errorCodes": dict(ecodes), "warningCodes": dict(codes), "ambiguityCodes": dict(acodes),
            "modulesWithWinterRecurrence": sum(m["recurrence"]["normalized"] in ("WT", "WT+ST") for m in modules),
            "modulesScheduledWS2026": sum(m["offering"]["scheduledWS2026"] for m in modules),
            "pagesProcessed": handbook["pdf"]["pages"],
            "glyphsNormalized": sum(GLYPH_STATS.values()),
            "valuesVerifiedOnPage": R.info.get("valuesVerifiedOnPage"),
        },
        "missingModuleFields": {k: {"count": len(v), "ids": v} for k, v in R.info["missingModuleFields"].items()},
        "missingComponentFields": {k: {"count": len(v), "ids": v} for k, v in R.info["missingComponentFields"].items()},
        "errors": R.errors,
        "warnings": R.warnings,
        "ambiguities": R.ambiguities,
        "notes": [
            "Study plan Tables 1-5 (pages 21, 29-32) are images without a text layer and are referenced by page only.",
            "Recurring offering (module 'Recurrence') is distinct from a course actually listed for 'WT 26/27' in a component's Courses table.",
            "No weekly meeting times are present in the handbook; none are extracted.",
            "Ligature/symbol glyphs were normalised (e.g. U+FB01 'ﬁ' -> 'fi', U+01AF -> 'ff' in the disclaimer font, U+F0B7 -> '•'): "
            + ", ".join(f"U+{ord(k):04X}×{v}" for k, v in sorted(GLYPH_STATS.items())) + ". handbook-pages.json keeps the raw PDF text.",
        ],
    }


def report_md(r):
    s = r["summary"]
    out = ["# Extraction report", "", f"Source: `{r['pdf']['file']}` ({r['pdf']['pages']} pages, sha256 `{r['pdf']['sha256'][:16]}…`)", "",
           "## Summary", "", "| Metric | Value |", "|---|---|"]
    for k, v in s.items():
        if not isinstance(v, dict):
            out.append(f"| {k} | {v} |")
    for title, key in (("Errors", "errorCodes"), ("Warnings", "warningCodes"), ("Ambiguities", "ambiguityCodes")):
        out += ["", f"### {title} by code", ""]
        out += [f"- `{k}`: {v}" for k, v in sorted(s[key].items())] or ["- none"]
    out += ["", "## Missing module fields", ""]
    out += [f"- `{k}`: {v['count']} ({', '.join(v['ids'][:12])}{' …' if v['count'] > 12 else ''})"
            for k, v in r["missingModuleFields"].items()] or ["- none"]
    out += ["", "## Missing component fields", ""]
    out += [f"- `{k}`: {v['count']} ({', '.join(v['ids'][:12])}{' …' if v['count'] > 12 else ''})"
            for k, v in r["missingComponentFields"].items()] or ["- none"]
    for title, key in (("Errors", "errors"), ("Warnings", "warnings"), ("Unresolved ambiguities", "ambiguities")):
        out += ["", f"## {title}", ""]
        items = r[key]
        if not items:
            out.append("- none")
        for it in items:
            ctx = ", ".join(f"{k}={v}" for k, v in it.items() if k not in ("code", "message"))
            out.append(f"- **{it['code']}** {it['message']} ({ctx})")
    out += ["", "## Notes", ""] + [f"- {n}" for n in r["notes"]]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    default = ROOT / "mhb-master-cds.pdf"
    if not default.exists():  # the repository only ships the copy served by the app
        default = ROOT / "public" / "mhb-master-cds.pdf"
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    sys.exit(main(pdf))
