"""KIT Campus schedule synchronisation for the CDS Study Planner (WS 2026/27).

Usage:
    python scripts/sync-campus.py                         # default: NO network; rebuild outputs from handbook data + manual records
    python scripts/sync-campus.py --fetch --feasibility   # opt-in fetch attempt, Reinforcement Learning + Distributed Computing only
    python scripts/sync-campus.py --fetch                 # opt-in fetch attempt for all mapped events

The site is never contacted unless --fetch is given.

What it does
  1. Selects eligible modules from the extracted Module Handbook (public/data/*.json):
     creditable in a CDS subject, recurrence "Each winter term"/"Each term", language EN or DE/EN.
  2. Maps modules to KIT Campus events using the explicit course numbers and event GUIDs printed in the
     handbook's course tables (component level). No name guessing; shared events are flagged for review.
  3. Applies schedule records verified manually by the student (scripts/campus-manual.json). These always
     take precedence over automated results.
  4. Tries to retrieve public event pages from cascampus.studium.kit.edu politely (one request at a time,
     delay, timeout, retry with exponential backoff for transient errors, on-disk cache, resumable).
     If the site answers with its browser-verification (anti-bot) challenge, the network phase stops at once.
     The challenge is never solved or bypassed.
  5. Writes src/data/campus-events.json, src/data/module-event-mappings.json and
     scripts/report/campus-sync-report.{json,md}. Previously stored schedule data is never replaced by empty data.

Only the Python standard library is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HB = ROOT / "public" / "data"
OUT_EVENTS = ROOT / "src" / "data" / "campus-events.json"
OUT_MAP = ROOT / "src" / "data" / "module-event-mappings.json"
MANUAL = ROOT / "scripts" / "campus-manual.json"
CACHE = ROOT / ".cache" / "campus"
REPORT = ROOT / "scripts" / "report"

CAMPUS_EVENT = "https://cascampus.studium.kit.edu/campus/all/event.asp?gguid={gguid}&lang=en"
PUBLIC_URL = "https://campus.studium.kit.edu/events/catalog.php#!campus/all/event.asp?gguid={gguid}"
USER_AGENT = "CDS-Study-Planner/1.0 (personal study planning tool; local use; low request rate)"
CHALLENGE_MARKERS = ("Verifying your browser", "JavaScript is required to continue")
PROGRAM_SUBJECTS = {"MATH", "CS", "SEE", "SPEC", "HPC_RDM", "IQ"}
FEASIBILITY_MODULES = {"M-INFO-105623", "M-INFO-107215"}  # Reinforcement Learning, Distributed Computing
SEMESTER_RAW = "WT 26/27"


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def gguid_of(url: str | None) -> str | None:
    m = re.search(r"gguid=(0x[0-9A-Fa-f]{32})", url or "")
    return m.group(1) if m else None


# --------------------------------------------------------------------------- eligibility + mapping

def eligible_modules(modules: list[dict]) -> list[dict]:
    out = []
    for m in modules:
        subjects = {e["subject"] for e in m["eligibility"]}
        if not subjects & PROGRAM_SUBJECTS:
            continue
        if m["recurrence"]["normalized"] not in ("WT", "WT+ST"):
            continue
        codes = m["language"]["codes"]
        if "EN" not in codes:
            continue
        out.append(m)
    return out


def build_mapping(modules: list[dict], comps: dict[str, dict]) -> tuple[list[dict], dict[str, dict]]:
    """Return (mappings, event stubs keyed by event number)."""
    mappings: list[dict] = []
    events: dict[str, dict] = {}
    for m in eligible_modules(modules):
        linked = []
        lang_status = "confirmed-handbook" if m["language"]["codes"] == ["EN"] else "unverified"
        for row in m["components"]:
            c = comps.get(row["id"])
            if not c:
                continue
            excerpts = {e["number"]: e for e in c["excerpts"] if e.get("number")}
            for co in c["courses"]:
                if co["semester"]["raw"] != SEMESTER_RAW or not co["number"]:
                    continue
                num = co["number"]
                ex = excerpts.get(num)
                ev_lang = ex.get("language") if ex else None
                gg = gguid_of(co.get("url"))
                ev = events.setdefault(num, {
                    "eventNumber": num,
                    "gguid": gg,
                    "url": PUBLIC_URL.format(gguid=gg) if gg else None,
                    "title": co["title"],
                    "types": co["types"],
                    "mode": co["mode"],
                    "lecturers": co["lecturers"],
                    "department": m["organisation"],
                    "semester": "WS 2026/27",
                    "language": {"value": ev_lang, "source": "handbook course excerpt (snapshot 20/10/2026)" if ev_lang else None},
                    "moduleIds": [],
                    "componentIds": [],
                    "appointments": [],
                    "groups": [],
                    "scheduleStatus": "unavailable",
                    "source": "handbook",
                    "verifiedAt": None,
                    "verifiedBy": None,
                    "notes": [],
                })
                if m["id"] not in ev["moduleIds"]:
                    ev["moduleIds"].append(m["id"])
                if row["id"] not in ev["componentIds"]:
                    ev["componentIds"].append(row["id"])
                prev = next((l for l in linked if l["eventNumber"] == num), None)
                if prev:  # same event listed by several components of this module
                    if row["id"] not in prev["componentIds"]:
                        prev["componentIds"].append(row["id"])
                else:
                    linked.append({"eventNumber": num, "componentIds": [row["id"]], "types": co["types"], "title": co["title"]})
                # DE/EN modules: English only counts as confirmed when the event record says so
                if lang_status == "unverified" and ev_lang and "english" in ev_lang.lower() and "german" not in ev_lang.lower():
                    lang_status = "confirmed-event-excerpt"
        mappings.append({
            "moduleId": m["id"],
            "moduleName": m["name"],
            "ects": m["credits"]["value"],
            "languageRaw": m["language"]["raw"],
            "languageStatus": lang_status,
            "events": linked,
            "match": "handbook-course-number" if linked else "unmatched",
            "confidence": "exact" if linked else None,
            "review": [] if linked else ["No WT 26/27 course is listed in the handbook for this module."],
        })
    # events shared by several modules are legitimate but worth a look
    for mp in mappings:
        for l in mp["events"]:
            ev = events[l["eventNumber"]]
            if len(ev["moduleIds"]) > 1:
                note = f"Event {ev['eventNumber']} is shared by modules {', '.join(ev['moduleIds'])}."
                if note not in mp["review"]:
                    mp["review"].append(note)
    return mappings, events


# --------------------------------------------------------------------------- manual records

def apply_manual(events: dict[str, dict], manual: dict, issues: list[dict]) -> None:
    for rec in manual.get("events", []):
        num = rec["eventNumber"]
        ev = events.get(num)
        if ev is None:
            ev = events[num] = {
                "eventNumber": num, "gguid": None, "url": None, "title": rec.get("title"), "types": [],
                "mode": None, "lecturers": None, "department": None, "semester": "WS 2026/27",
                "language": {"value": None, "source": None}, "moduleIds": list(rec.get("moduleIds", [])),
                "componentIds": [], "appointments": [], "groups": [], "scheduleStatus": "unavailable",
                "source": "manual", "verifiedAt": None, "verifiedBy": None, "notes": [],
            }
            issues.append({"code": "MANUAL_EVENT_NOT_IN_HANDBOOK", "eventNumber": num,
                           "message": "Manually recorded event is not listed in the handbook's WT 26/27 course tables."})
        for mid in rec.get("moduleIds", []):
            if mid not in ev["moduleIds"]:
                issues.append({"code": "MANUAL_MODULE_MISMATCH", "eventNumber": num, "moduleId": mid,
                               "message": "Manual record links this event to a module the handbook does not link it to — review."})
                ev["moduleIds"].append(mid)
        apps = rec.get("appointments", [])
        if apps:
            ev["appointments"] = [
                {"id": f"{num}-{i}", "status": "scheduled", **a} for i, a in enumerate(apps)
            ]
            ev["scheduleStatus"] = "verified"
            ev["source"] = "manual"
            ev["verifiedAt"] = rec.get("verifiedAt")
            ev["verifiedBy"] = rec.get("verifiedBy")
        if rec.get("type"):
            ev["typeLabel"] = rec["type"]
        if rec.get("exam"):
            ev["exam"] = rec["exam"]
        if rec.get("note"):
            ev["notes"].append(rec["note"])


# --------------------------------------------------------------------------- network

class Blocked(Exception):
    pass


def fetch(url: str, delay: float, retries: int = 3, timeout: float = 20.0) -> tuple[int, str]:
    """GET with timeout and exponential backoff for transient failures. Raises Blocked on the anti-bot page."""
    attempt = 0
    while True:
        time.sleep(delay)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
                code = r.status
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            code = e.code
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            attempt += 1
            if attempt > retries:
                raise
            time.sleep(2 ** attempt)
            continue
        if any(mk in body for mk in CHALLENGE_MARKERS):
            raise Blocked(f"HTTP {code}: browser-verification challenge")
        if code >= 500 and attempt < retries:
            attempt += 1
            time.sleep(2 ** attempt)
            continue
        return code, body


def network_phase(events: dict[str, dict], targets: list[str], delay: float, report: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    net = report["network"]
    for num in targets:
        ev = events[num]
        if not ev.get("gguid"):
            net["skipped"].append({"eventNumber": num, "reason": "no Campus GUID in handbook"})
            continue
        cache_file = CACHE / f"{ev['gguid']}.html"
        if cache_file.exists():
            net["cached"].append(num)  # resume: never re-request an already retrieved page
            continue
        url = CAMPUS_EVENT.format(gguid=ev["gguid"])
        try:
            code, body = fetch(url, delay)
        except Blocked as b:
            net["status"] = "blocked"
            net["message"] = (f"{b}. The public KIT Campus host requires an interactive browser check before serving event "
                              "pages. Automated retrieval stops here; the challenge is not bypassed.")
            net["blockedAt"] = {"eventNumber": num, "url": url}
            return
        except Exception as e:  # noqa: BLE001
            net["errors"].append({"eventNumber": num, "error": repr(e)})
            continue
        if code != 200:
            net["errors"].append({"eventNumber": num, "error": f"HTTP {code}"})
            continue
        cache_file.write_text(body, encoding="utf-8")
        # The event page markup has never been observable (see report), so no parser can be validated against it.
        # Raw HTML is cached for review; schedule data is left untouched.
        net["fetchedUnparsed"].append(num)
        ev["notes"].append("Event page retrieved and cached, but not parsed (no validated parser).")
    if net["status"] == "not-run":
        net["status"] = "completed"


# --------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--feasibility", action="store_true", help="only try Reinforcement Learning and Distributed Computing")
    ap.add_argument("--fetch", action="store_true", help="opt in to contacting KIT Campus (off by default)")
    ap.add_argument("--offline", action="store_true", help="kept for compatibility; offline is the default")
    ap.add_argument("--delay", type=float, default=3.0, help="seconds between requests (default 3)")
    args = ap.parse_args()
    args.offline = args.offline or not args.fetch

    modules = load(HB / "modules.json")
    comps = {c["id"]: c for c in load(HB / "module-components.json")}
    manual = load(MANUAL, {"events": []})
    previous = load(OUT_EVENTS, {"meta": {}, "events": []})

    issues: list[dict] = []
    mappings, events = build_mapping(modules, comps)

    # keep previously stored, non-empty schedule data (never replace with empty appointments)
    for old in previous.get("events", []):
        ev = events.get(old["eventNumber"])
        if ev is not None and old.get("appointments") and old.get("source") not in ("handbook", "manual"):
            ev.update({k: old[k] for k in ("appointments", "groups", "scheduleStatus", "source", "verifiedAt") if k in old})

    apply_manual(events, manual, issues)

    report = {
        "generatedAt": now(),
        "semester": "WS 2026/27",
        "network": {"status": "not-run", "message": None, "cached": [], "fetchedUnparsed": [], "errors": [], "skipped": []},
        "issues": issues,
    }
    prev_meta = previous.get("meta", {})
    if not args.offline:
        targets = [n for n, e in events.items() if set(e["moduleIds"]) & FEASIBILITY_MODULES] if args.feasibility else sorted(events)
        network_phase(events, targets, args.delay, report)
    else:
        report["network"]["status"] = "offline"

    ev_list = sorted(events.values(), key=lambda e: e["eventNumber"])
    verified = [e for e in ev_list if e["scheduleStatus"] == "verified"]
    meta = {
        "source": "KIT Campus (campus.studium.kit.edu)",
        "semester": "WS 2026/27",
        "lastSyncAttempt": report["generatedAt"] if not args.offline else prev_meta.get("lastSyncAttempt"),
        "lastSyncStatus": report["network"]["status"] if not args.offline else prev_meta.get("lastSyncStatus", "offline"),
        "lastSyncMessage": report["network"]["message"] if not args.offline else prev_meta.get("lastSyncMessage"),
        # only set when schedule data was actually retrieved from KIT Campus — never so far
        "lastSuccessfulSync": prev_meta.get("lastSuccessfulSync"),
        "verifiedEvents": len(verified),
        "events": len(ev_list),
        "manualRecordsFile": "scripts/campus-manual.json",
        "handbookSha256": load(HB / "handbook.json")["pdf"]["sha256"],
    }
    OUT_EVENTS.parent.mkdir(parents=True, exist_ok=True)
    OUT_EVENTS.write_text(json.dumps({"meta": meta, "events": ev_list, "externalCourses": manual.get("externalCourses", [])},
                                     ensure_ascii=False, indent=1), encoding="utf-8")
    OUT_MAP.write_text(json.dumps({"meta": {"generatedFrom": "public/data (Module Handbook 20/10/2026)", "semester": "WS 2026/27"},
                                   "mappings": mappings}, ensure_ascii=False, indent=1), encoding="utf-8")

    matched = [m for m in mappings if m["events"]]
    unmatched = [m for m in mappings if not m["events"]]
    review = [m for m in mappings if m["review"] and m["events"]]
    with_schedule = {mid for e in verified for mid in e["moduleIds"]}
    report["summary"] = {
        "eligibleModules": len(mappings),
        "matchedModules": len(matched),
        "unmatchedModules": len(unmatched),
        "modulesNeedingReview": len(review),
        "languageUnverified": sum(m["languageStatus"] == "unverified" for m in mappings),
        "events": len(ev_list),
        "eventsWithVerifiedSchedule": len(verified),
        "eligibleModulesWithVerifiedSchedule": sum(m["moduleId"] in with_schedule for m in mappings),
    }
    report["matched"] = [{"moduleId": m["moduleId"], "name": m["moduleName"], "events": [e["eventNumber"] for e in m["events"]],
                          "languageStatus": m["languageStatus"], "schedule": "verified" if m["moduleId"] in with_schedule else "unavailable"}
                         for m in matched]
    report["unmatched"] = [{"moduleId": m["moduleId"], "name": m["moduleName"], "reason": m["review"][0]} for m in unmatched]
    report["ambiguous"] = [{"moduleId": m["moduleId"], "name": m["moduleName"], "review": m["review"]} for m in review]
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / "campus-sync-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    (REPORT / "campus-sync-report.md").write_text(report_md(report, meta), encoding="utf-8")
    s = report["summary"]
    print(f"network={report['network']['status']} eligible={s['eligibleModules']} matched={s['matchedModules']} "
          f"unmatched={s['unmatchedModules']} review={s['modulesNeedingReview']} verified-schedules={s['eventsWithVerifiedSchedule']}")
    if report["network"]["message"]:
        print(report["network"]["message"])
    return 0


def report_md(r: dict, meta: dict) -> str:
    s = r["summary"]
    n = r["network"]
    out = ["# KIT Campus sync report", "", f"Generated: {r['generatedAt']} · Semester: {r['semester']}", "",
           "## Network", "", f"- Status: **{n['status']}**"]
    if n["message"]:
        out.append(f"- {n['message']}")
    out += [f"- Last successful sync: {meta['lastSuccessfulSync'] or 'never'}",
            f"- Cached pages: {len(n['cached'])}, fetched but unparsed: {len(n['fetchedUnparsed'])}, errors: {len(n['errors'])}", "",
            "## Summary", "", "| Metric | Value |", "|---|---|"] + [f"| {k} | {v} |" for k, v in s.items()]
    out += ["", "## Matched modules", "", "| Module | Name | Events | Language | Schedule |", "|---|---|---|---|---|"]
    out += [f"| {m['moduleId']} | {m['name']} | {', '.join(m['events'])} | {m['languageStatus']} | {m['schedule']} |" for m in r["matched"]]
    out += ["", "## Unmatched modules", ""] + ([f"- {m['moduleId']} {m['name']}: {m['reason']}" for m in r["unmatched"]] or ["- none"])
    out += ["", "## Needs manual review", ""] + ([f"- {m['moduleId']} {m['name']}: {' '.join(m['review'])}" for m in r["ambiguous"]] or ["- none"])
    out += ["", "## Issues", ""] + ([f"- **{i['code']}** {i['message']} ({i.get('eventNumber', '')})" for i in r["issues"]] or ["- none"])
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    sys.exit(main())
