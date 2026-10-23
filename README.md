# CDS Study Planner

A local-first web app for choosing modules for **Winter Semester 2026/27** in the
**M.Sc. Computational and Data Science (KIT, SPO 2026)**. All academic data is extracted from
the official Module Handbook PDF (`mhb-master-cds.pdf`, 1,168 pages, dated 20/10/2026).

This is a personal planning aid. It is **not** an enrollment system, and it grants no official approval.

## Setup

Requirements: Node.js 20+ and Python 3.10+ (only needed to re-run the extraction).

```bash
npm install
npm run dev
```

Open http://localhost:5173. The extracted data is already in `public/data/`, so you don't need
to run the extraction just to use the app.

## Extraction

```bash
python -m pip install -r extraction/requirements.txt
npm run extract
```

`npm run extract` runs `python extraction/extract_handbook.py`. You can also pass a PDF path
directly: `python extraction/extract_handbook.py path/to/mhb-master-cds.pdf`.

The pipeline is deterministic: the same PDF always produces the same output. It reads every page
with PyMuPDF and works from text positions and font styles (headings, label/value grids, table
columns), not from guessed prose.

Output files in `public/data/`:

| File | Content |
|---|---|
| `handbook.json` | Metadata, PDF hash, chapters, PDF bookmarks, parsed printed table of contents |
| `program-structure.json` | Chapter 3 structure tree: subjects, SEE profiles, foci, specializations, elective groups and their constraints, election notes, modelled conditions |
| `modules.json` | 375 modules: header fields, all description sections (with page numbers), component table, "Part of", eligibility derived from the structure tables, offering evidence |
| `module-components.json` | 531 module components: type, credits, term, courses table (semester, number, SWS, type, mode, lecturers, study-portal link), sections, course excerpts |
| `regulations.json` | Disclaimer (p. 18) and study plan (pp. 19–32) split by chapter |
| `handbook-pages.json` | Verbatim text of every PDF page (fallback / "original text" view) |
| `extraction-report.json` | Validation report (also in `extraction/report/extraction-report.md`) |

The script also copies the PDF to `public/` so the app can link to a specific page (`/mhb-master-cds.pdf#page=N`).

### Validation

The extractor runs these checks and writes the results to the report:

- duplicate module and component IDs
- comparison against the printed table of contents and the PDF bookmarks (missing or extra IDs, start-page mismatches)
- page references: in range, and the record's ID appears on its start page
- **verbatim value checks**: 4,735 extracted values (credits, grading, recurrence, language, type, component IDs, course numbers) are confirmed to appear on the record's PDF pages
- module ↔ component linkage in both directions, plus component credits in the module table vs. the component page
- module credits vs. structure-table credits, and the sum of mandatory component credits
- every structure entry resolves to a described module; module "Part of" entries are cross-checked with the structure tree
- missing fields per module and component

Current result: **0 errors**; 92 warnings, all of which are handbook entries that contain only
header data and no description sections; 1 ambiguity (see Limitations).

## Features

- **Module Explorer**: search (name, module ID, component ID, coordinator) and filters for semester, handbook offering pattern, language, subject, SEE profile, specialization, credits, mandatory/elective/research project, course type (taken from the handbook's course tables) and saved modules. The default view is WS 2026/27, English-taught, CDS subjects, and every default can be removed.
- **Module details**: a template-based overview built only from extracted fields; every handbook section with its page number; components with assessments, course listings and course descriptions; the complete original page text; and links to the PDF page.
- **Compare**: up to 3 modules side by side, with differing rows highlighted.
- **Winter Semester Planner**: add/remove modules, assign each module to exactly one subject (no double counting), total ECTS and ECTS per subject, warnings, notes, manually entered course times with conflict detection, and JSON export/import. Everything is saved in `localStorage`.
- **External courses**: courses outside the Module Handbook (for example Language Center courses) can be added in the planner with a title, course number, ECTS, subject, registration status, room, start date and weekly times. They count once in the planned total and take part in conflict detection. Their credits stay "recognition pending" and are never counted as completed, so a requirement met only through them shows "Requires manual approval". **Add from file** merges a file into the current plan without changing existing entries (for example `german-course-a2-1.json`); **Import JSON** replaces the whole plan.
- **Degree Requirements**: checks subject ranges, the 80-ECTS rule with its one-time final overrun, HPC/RDM and IQ, the SEE profile and EE&IT focus, specialization requirements (Math seminar, CS seminar + lab, SEE profile research projects) and approval notes. Statuses: Valid / Incomplete / Potential conflict / Requires manual approval / Cannot be verified. Every rule cites PDF pages.
- **Handbook & Data**: study plan text, the browsable program structure, a module-component index, a page-text viewer and the extraction report.
- **Settings**: preferred language, SEE profile (plus EE&IT focus), intended specialization and target ECTS. Changing a profile warns if planned modules would become ineligible; nothing is deleted.

## Tests

```bash
npm test
```

25 tests cover dataset integrity against the TOC, ID uniqueness, module ↔ component links,
sample handbook facts, winter filtering, search, duplicate prevention, ECTS accounting, the
SEE-profile eligibility check, time-conflict detection, "schedule not verified", persistence
round-trips, the 80-ECTS overrun rule, group limits for the CS research project, and the
handling of incomplete data.

## How offering information is interpreted

| Label | Meaning |
|---|---|
| **Course listed for WS 26/27** | A component's course table lists a course for `WT 26/27`. This is the strongest evidence in the handbook, but it still contains no meeting times. |
| **Recurring winter offering** | Module recurrence is "Each winter term" or "Each term", but no WT 26/27 course is listed. |
| **Summer term only** | Recurrence is "Each summer term" and no WT 26/27 course is listed. |
| **Irregular / unknown** | "Irregular", "see Annotations", or not specified, and no WT 26/27 course is listed. This is never treated as available. |

Original values are always kept next to normalised ones (`WT`, `ST`, `WT+ST`, `IRREGULAR`, `SEE_NOTES`, `UNKNOWN`).

## Limitations

- **No meeting times.** The handbook has no weekly schedules, so the app never shows any. You enter times manually, and conflicts are checked only between those times. A module without times is shown as "Schedule not verified".
- **Study plan Tables 1–5** (PDF pp. 21, 29–32) are images without a text layer. They are not extracted; the app links to those pages.
- **92 handbook entries have no description sections** (mostly Informatics modules and some components). The app shows "Not specified in handbook" and links to the PDF page.
- **Inconsistent offering data in the handbook:** for example, 7 modules have recurrence "Each summer term" while a component lists a WT 26/27 course (such as an announcement block or the first part of a two-term module). These cases are shown as "Cannot be verified" instead of being resolved automatically.
- **Duplicate section number:** the handbook numbers two structure sections `3.5.3.6.1` (EE&IT foci in the specialization). The second one is stored as `3.5.3.6.1#2`.
- **The overview text is template-based**, built from handbook fields plus the first sentence of the Competence Goal quoted verbatim. No AI-generated summaries are used.
- **The rules checker is simplified.** It works on your tentative plan only (no previous semesters or grades). It approximates exam-registration order by the order in which you added modules (for the 80-ECTS rule). Prerequisites are shown as text to check; they are not evaluated. Examination Committee decisions, recognition of external modules, and CESS foci balance cannot be verified.
- Four glyph-encoding artefacts in the embedded study-plan PDFs (ligatures such as `ﬁ`, a font that maps "ff" to `Ư`, and a symbol-font bullet) are normalised in the structured text. `handbook-pages.json` keeps the raw text.
- Data stays in this browser (`localStorage`). Use Export JSON for backups or to move to another device.

## Deploying to GitHub Pages

The repository includes `.github/workflows/deploy.yml`. Every push to `main` runs the tests,
builds the app and publishes `dist/` to GitHub Pages.

1. On GitHub, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions** (one-time setup).
2. Push to `main`. The site appears at `https://<user>.github.io/<repo>/`.

The build uses relative asset paths (`base: './'`) and hash-based routes (`#/module/…`), so it
works under any sub-path without server configuration. Plans are stored in each visitor's own
browser (`localStorage`), so nothing personal is published. Use Export / Import / Add from file to move a plan.

Personal files (exported plans, `german-course-*.json`, `*.private.json`) are git-ignored.
The source PDF is shipped once, as `public/mhb-master-cds.pdf`; the extractor uses it when the root copy is absent.

## KIT Campus schedules

`npm run sync:campus` rebuilds `src/data/campus-events.json` and `src/data/module-event-mappings.json`
from the handbook course tables and the manually verified records in `scripts/campus-manual.json`.
It does **not** contact KIT Campus unless you pass `--fetch`. Automated retrieval is not possible:
the Campus host answers every event request with a browser-verification challenge, which this project
does not bypass. The report is in `scripts/report/campus-sync-report.md`.
