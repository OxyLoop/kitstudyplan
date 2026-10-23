# CDS Study Planner — Claude Code Project Instructions

## Project Goal

Build a clean, fast, local-first web application called **CDS Study Planner**.

The application is designed for one student enrolled in the **M.Sc. Computational and Data Science at Karlsruhe Institute of Technology (KIT)** under **SPO 2026**, starting in **Winter Semester 2026/27**.

The student has a 1,168-page official Module Handbook PDF dated October 20, 2026.

**Main objective:** Make it dramatically easier to explore available modules, understand their requirements, compare options, and choose courses for the current winter semester.

This is a personal academic decision-support tool, not a university portal, enrollment system, or full student management application.

Prioritize simplicity, accuracy, reliability, and usability over additional features.

## 1. Technology Stack

Use:

- React + TypeScript + Vite
- Tailwind CSS
- Lucide React icons
- React Router if needed
- Python + PyMuPDF for one-time PDF data extraction
- Static JSON files for extracted data
- localStorage for personal selections

Do not use:
- Backend servers or external databases
- Authentication
- AI APIs or LLM integration inside the application
- Paid services
- Cloud storage
- Unnecessary frameworks or dependencies

The application must work locally and start with `npm install` followed by `npm run dev`.

## 2. Source of Truth

The provided PDF is the **only academic data source**.

File: `mhb-master-cds.pdf`

Important handbook metadata:
- University: Karlsruhe Institute of Technology
- Program: Computational and Data Science (M.Sc.)
- Regulations: SPO 2026
- Semester: Winter Semester 2026/27
- Handbook date: October 20, 2026

Read the supplied PDF directly. Do not rely on invented data or external academic catalogs.

Preserve the original academic terminology and factual details.

The PDF contains:
1. Disclaimer and academic notices
2. Official study plan and academic regulations
3. Study program structure and eligible modules
4. Detailed module descriptions
5. Module components and examination descriptions

Extract and preserve all sections, including modules outside the student's current preferred subjects.

The application should expose the complete handbook while prioritizing winter-term course selection.

Do not silently discard unknown fields. Preserve original source text in a structured form.

## 3. PDF Data Extraction

Implement a deterministic Python extraction pipeline.

The extraction should produce structured files such as:

- `handbook.json`
- `program-structure.json`
- `modules.json`
- `module-components.json`
- `regulations.json`

For each module, capture as many available fields as possible:

- Module ID
- Official module name
- ECTS credits
- Academic categories and eligible study fields
- SEE profile and specialization eligibility
- Mandatory/elective classification
- Language
- Winter/summer/irregular availability
- Coordinator
- Lecturer information
- Department
- Grading
- Module duration
- Module level and version
- Assessment
- Prerequisites
- Recommendations
- Competence goals
- Content
- Workload
- Associated module components
- Related examinations
- Course listings and identifiers
- PDF page references
- Any additional information included in the handbook

Some fields may exist only at the module-component level.

Store module and component information separately, linking them through their official IDs.

Do not treat a module component as an independent selectable module unless the handbook explicitly requires it.

Extract the program structure independently from module descriptions. A module may be eligible in more than one field, so represent these relationships as arrays rather than a single category.

Use stable official identifiers.

Normalize terms such as WT, ST, WT+ST and Irregular without removing the original values.

Do not interpret an irregular offering as confirmed availability.

### Data quality requirements

The handbook must be processed in full, not just the first few pages.

Implement:
- Duplicate-ID detection
- Missing-field reporting
- Referential integrity checks
- Module-to-component linkage checks
- Credit consistency checks
- PDF page-reference validation
- Comparison of extracted module IDs against the handbook's table of contents

Create an extraction report showing successful records, missing records, warnings and unresolved ambiguities.

If parsing fails for certain content, preserve the extracted raw text and flag the affected records.

Do not fabricate missing descriptions, prerequisites, credits or scheduling details.

## 4. Interface Design

Create a professional, minimalist, English-language interface.

Visual direction:
- Modern university dashboard
- Light theme by default
- Clean typography
- Soft borders
- Comfortable spacing
- Subtle accent colors
- Responsive desktop and mobile layout
- Minimal animations

Avoid oversized cards, unnecessary charts, complicated navigation and decorative clutter.

Use a sidebar or compact navigation with four main sections:

1. Module Explorer
2. Compare Modules
3. Winter Semester Planner
4. Degree Requirements

## 5. Module Explorer

This is the most important screen.

Provide a searchable and filterable catalog of all modules in the handbook.

Default filters:
- Winter Semester 2026/27
- English-language modules
- Modules available within the CDS program

The user must be able to remove these filters and explore the complete catalog.

Implement filters for:
- Name and module ID
- Subject / academic field
- Mathematics
- Computer Science
- SEE and individual SEE profiles
- Specialization
- Credits
- Language
- Semester availability
- Mandatory / elective
- Seminar, laboratory, lecture or other supported activity type

Course type filters must be derived from actual data, not guessed from course titles.

Allow filtering by:
- Confirmed handbook winter offering
- Both winter and summer
- Summer only
- Irregular or unknown

Distinguish a recurring winter offering from a confirmed, currently scheduled course.

Each module card should show:
- Official name
- Module ID
- ECTS
- Language
- Semester offering
- Eligible academic categories
- Selection status

Actions:
- View Details
- Add to Semester
- Add to Compare
- Save for Later

### Module Details

Display all available original handbook information, organized into readable sections.

At the top, show a short, easy-to-read explanation of the module.

The simplified explanation must be grounded in the extracted handbook content. For the initial offline implementation, prefer deterministic summaries or carefully maintained text. Do not invent an AI-generated summary service.

If a reliable summary is unavailable, display the original text clearly instead.

Include the linked module components and their assessments.

Add a source reference, such as:

`Source: Module Handbook WS 2026/27 — Page 321`

Allow navigation to the corresponding page in the original PDF.

The complete original content must remain accessible.

## 6. Compare Modules

Allow comparison of up to three modules.

Provide a side-by-side table comparing:

- Name
- Credits
- Academic field eligibility
- Language
- Semester availability
- Workload
- Prerequisites
- Recommendations
- Assessment
- Grading
- Content and learning objectives

Highlight actual differences where possible.

Allow adding a compared module directly to the semester planner.

## 7. Winter Semester Planner

This is the second most important feature.

The user should be able to create a tentative course selection for Winter Semester 2026/27.

Provide:
- Selected module list
- Module removal
- Total ECTS
- ECTS by academic category
- Categorization of each selected module
- Warnings for prerequisites and academic requirements
- Personal notes
- Optional manually entered course times

A module eligible for multiple categories must be assigned to exactly one category for credit accounting.

Do not double-count its ECTS.

Save all personal selections locally using localStorage.

The plan must survive a browser refresh.

Allow exporting and importing the plan as JSON.

### Schedule Conflict Detection

The PDF does not consistently provide exact weekly meeting times.

Therefore:
- Never invent days or times.
- Use official timetable information only if explicitly present in the uploaded PDF.
- Let the student enter day and start/end time manually.
- Detect conflicts between explicitly entered times.
- If times are missing, display "Schedule not verified".

Do not call a schedule conflict-free merely because timetable information is unavailable.

## 8. Degree Requirements

Implement a lightweight academic rules checker based on the provided study plan.

Relevant structure:

- Mathematics for CDS: 16–32 ECTS
- Computer Science: 16–32 ECTS
- Sciences, Engineering, Economics: 16–32 ECTS
- Specialization: 16–32 ECTS
- Four variable-credit subjects: normally 80 ECTS in total
- Hackathon and HPC/RDM: 6 ECTS
- Interdisciplinary Qualifications: 4 ECTS
- Master's Thesis: 30 ECTS
- Overall degree: 120 ECTS

Account for the official permitted final-module overrun of the 80-credit variable-subject allocation. Do not implement an unconditional hard rejection at exactly 80 ECTS.

Represent SEE profile restrictions and applicable specialization requirements.

Important:
- Exactly one SEE profile can be selected.
- Specialization may be Mathematics, Computer Science or SEE.
- SEE specialization must follow the same SEE profile.
- Computer Science specialization includes seminar and laboratory requirements.
- Other profiles have their own mandatory module or research-project rules.
- Some selections may require faculty or examination committee approval.

Use the PDF rules to implement these checks.

Distinguish between:
- Valid
- Incomplete
- Potential conflict
- Requires manual approval
- Cannot be verified

Do not claim official academic approval or enrollment.

For the current winter planner, show only relevant progress and warnings. Avoid overwhelming the user with future graduation requirements.

## 9. User Preferences

Add a small local Settings section for:

- Current semester: WS 2026/27
- Preferred language: English
- Preferred SEE profile
- Intended specialization
- Optional target semester ECTS

The SEE profile and specialization should initially be unselected.

Allow changes without data loss.

When changing a profile, warn if existing selected modules may become ineligible.

## 10. Out of Scope

Do not implement:
- User accounts
- Campus portal login
- Actual enrollment
- Exam registration
- Google Calendar integration
- Automated university timetable scraping
- AI chatbot
- University-wide course discovery
- Grade tracking
- Complex multi-year graduation simulation
- Backend services

Focus exclusively on making informed module-selection decisions.

## 11. Development Approach

Work in clear phases.

### Phase 1 — Data extraction
- Inspect the PDF structure
- Create the extraction scripts
- Generate the complete structured dataset
- Produce validation reports

### Phase 2 — Core interface
- Build navigation
- Build the Module Explorer
- Build detailed module pages
- Implement filtering and search

### Phase 3 — Course planning
- Add comparisons
- Add semester selections
- Add ECTS calculations
- Add local persistence

### Phase 4 — Academic validation
- Add subject eligibility checks
- Add SEE profile rules
- Add specialization requirements
- Add prerequisite notices
- Add schedule conflict detection for known or manually entered times

### Phase 5 — Testing and polish
- Verify PDF data accuracy
- Test winter-term filtering
- Test all ECTS calculations
- Test duplicate selection prevention
- Test localStorage persistence
- Test module-component relationships
- Test mobile responsiveness
- Test unknown and incomplete data handling

## 12. Acceptance Criteria

The implementation is complete when:

1. All modules and components from the provided handbook have been extracted or explicitly reported as unresolved.
2. The complete handbook information is accessible through the interface.
3. Users can quickly identify modules relevant to Winter Semester 2026/27.
4. Search and filters work accurately.
5. Module details contain traceable PDF references.
6. Users can compare courses.
7. Users can build a semester selection.
8. ECTS calculations avoid duplicate counting.
9. Academic restrictions generate useful warnings.
10. Timetable information is never fabricated.
11. Everything works locally without cloud services.
12. User selections persist after refreshing.

## 13. Important Instructions

Do not prioritize fancy features over correctness.

Keep the interface clean and simple.

Treat the PDF as authoritative for handbook information, but distinguish what it proves from what it does not prove.

When a fact is missing, display "Not specified in handbook".

Prefer explicit academic source references over unsupported assumptions.

Do not silently omit any handbook content merely because it does not fit the initial user interface.

Build a practical tool that a student can use immediately when choosing courses.

Start by inspecting the supplied PDF and implementing the extraction and validation pipeline. Then build the complete application in the defined phases.

Do not substitute mock course data for the actual dataset.

Finally, provide a README containing setup instructions, the extraction command, the development command, and documented limitations.