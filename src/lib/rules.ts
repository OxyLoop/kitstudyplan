/**
 * Lightweight academic rules checker based on the study plan (PDF pages 18–32) and the
 * program structure (PDF pages 33–66). It never claims official approval: results are
 * planning hints with explicit source pages.
 */
import {
  EE_FOCI,
  SUBJECT_LABEL,
  VARIABLE_SUBJECTS,
  isNone,
  languageClass,
  winterStatus,
} from './domain'
import {
  RECOGNITION_LABEL,
  REGISTRATION_LABEL,
  assignmentOptions,
  ectsSummary,
  externalCounts,
  scheduleItems,
  scheduleStatus,
  type AppState,
  type ExternalCourse,
  type PlanEntry,
} from './planner'
import type { Dataset, Module, StructureNode, Subject } from './types'

export type Status = 'valid' | 'incomplete' | 'conflict' | 'approval' | 'unverifiable'

export const STATUS_LABEL: Record<Status, string> = {
  valid: 'Valid',
  incomplete: 'Incomplete',
  conflict: 'Potential conflict',
  approval: 'Requires manual approval',
  unverifiable: 'Cannot be verified',
}

export interface Check {
  id: string
  title: string
  status: Status
  detail: string
  /** PDF pages supporting the rule */
  pages: number[]
  moduleIds?: string[]
  scope: 'semester' | 'degree'
}

export const REQUIREMENTS: { subject: Subject; min: number; max: number; page: number }[] = [
  { subject: 'MATH', min: 16, max: 32, page: 34 },
  { subject: 'CS', min: 16, max: 32, page: 37 },
  { subject: 'SEE', min: 16, max: 32, page: 38 },
  { subject: 'SPEC', min: 16, max: 32, page: 46 },
  { subject: 'HPC_RDM', min: 6, max: 6, page: 66 },
  { subject: 'IQ', min: 4, max: 4, page: 66 },
  { subject: 'THESIS', min: 30, max: 30, page: 33 },
]
export const VARIABLE_TOTAL = 80
export const DEGREE_TOTAL = 120

const HACKATHON = 'M-MATH-107479'
const DISTRIBUTED_COMPUTING = 'M-INFO-107215'
const KEY_COMPETENCES = 'M-MATH-107752'
const MATH_SEMINAR = 'M-MATH-102730'

let externalNames = new Map<string, string>()
const name = (d: Dataset, id: string) => d.moduleById.get(id)?.name ?? externalNames.get(id) ?? id

// ------------------------------------------------------------------ 80-credit rule

export interface OverrunResult {
  /** module that first surpasses 80 (permitted once) */
  overrunModule: string | null
  /** modules added after the threshold was passed (would not be recognised) */
  beyond: string[]
  total: number
}

/**
 * Study plan p. 21–22 / disclaimer p. 18: the 80 credits of the four variable subjects may be
 * exceeded only once, by the final module that first surpasses the threshold. Order = order in
 * which modules were added to the plan (a proxy for exam registration order).
 */
export function variableOverrun(plan: PlanEntry[], d: Dataset, priorCredits = 0, externals: ExternalCourse[] = []): OverrunResult {
  // external courses assigned to a variable subject take part in the same ordering
  const ext = new Map(externals.filter(externalCounts).map((x) => [x.id, x.ects]))
  const ordered = [
    ...plan,
    ...externals.filter(externalCounts).map((x) => ({ moduleId: x.id, category: x.category, addedAt: x.addedAt })),
  ].sort((a, b) => a.addedAt - b.addedAt)
  let total = priorCredits
  let overrunModule: string | null = null
  const beyond: string[] = []
  for (const e of ordered) {
    if (!e.category || !VARIABLE_SUBJECTS.includes(e.category)) continue
    const c = d.moduleById.get(e.moduleId)?.credits.value ?? ext.get(e.moduleId) ?? 0
    if (total >= VARIABLE_TOTAL) {
      beyond.push(e.moduleId)
    } else if (total + c > VARIABLE_TOTAL) {
      overrunModule = e.moduleId
    }
    total += c
  }
  return { overrunModule, beyond, total }
}

// ------------------------------------------------------------------ helpers

function profileNodes(d: Dataset, spec: boolean, profile: string): StructureNode[] {
  return d.structure.nodes.filter((n) =>
    spec
      ? n.category.subject === 'SPEC' && n.category.specialization === 'SEE' && n.category.profile === profile
      : n.category.subject === 'SEE' && n.category.profile === profile,
  )
}

function plannedIn(plan: PlanEntry[], subject: Subject) {
  return plan.filter((e) => e.category === subject)
}

function moduleInGroup(m: Module | undefined, uid: string, groupLabel: string | null) {
  return !!m?.eligibility.some((e) => e.node === uid && e.group === groupLabel)
}

/** Requirement groups of a node: "Mandatory" groups and Research Oriented Study Project groups. */
function requirementGroups(n: StructureNode) {
  return n.groups.filter((g) => g.kind === 'mandatory' || /Research Oriented Study Project/i.test(g.label ?? ''))
}

// ------------------------------------------------------------------ main

export function runChecks(state: AppState, d: Dataset): Check[] {
  const { plan, settings } = state
  const externals = state.externals ?? []
  externalNames = new Map(externals.map((x) => [x.id, x.title]))
  const checks: Check[] = []
  const add = (c: Check) => checks.push(c)
  const summary = ectsSummary(plan, d.moduleById, externals)

  // ---------------- manually entered external courses (not handbook data)
  for (const x of externals) {
    if (x.registration === 'rejected') {
      add({
        id: `ext-rejected-${x.id}`, scope: 'semester', status: 'conflict', pages: [], moduleIds: [x.id],
        title: `${x.title}: registration rejected`,
        detail: 'Rejected courses are not counted in the planned ECTS.',
      })
      continue
    }
    if (x.registration !== 'accepted')
      add({
        id: `ext-reg-${x.id}`, scope: 'semester', status: 'incomplete', pages: [], moduleIds: [x.id],
        title: `${x.title}: registration ${REGISTRATION_LABEL[x.registration].toLowerCase()}`,
        detail: 'A place in the course is not confirmed yet.',
      })
    if (!x.category)
      add({
        id: `ext-cat-${x.id}`, scope: 'semester', status: 'incomplete', pages: [], moduleIds: [x.id],
        title: `${x.title}: choose a subject`,
        detail: 'Choose the one subject you intend to count this course towards.',
      })
    if (x.recognition !== 'confirmed')
      add({
        id: `ext-rec-${x.id}`, scope: 'semester', status: x.recognition === 'rejected' ? 'conflict' : 'approval',
        pages: x.category === 'IQ' ? [28] : [22], moduleIds: [x.id],
        title: `${x.title}: ${RECOGNITION_LABEL[x.recognition].toLowerCase()}`,
        detail:
          (x.recognition === 'rejected'
            ? 'The credits will not be recognised for the degree'
            : `This course is not in the Module Handbook. Its ${x.ects} ECTS are planned but not counted as completed or recognised until the recognition is confirmed`) +
          (x.category === 'IQ'
            ? ' (Interdisciplinary Qualifications may be acquired at the Language Center, study plan p. 28).'
            : x.category && x.category !== 'ADDITIONAL'
              ? ' (modules outside the handbook need Examination Committee approval, study plan p. 22).'
              : '.'),
      })
  }

  // ---------------- per-module semester checks
  for (const e of plan) {
    const m = d.moduleById.get(e.moduleId)
    if (!m) continue
    const opts = assignmentOptions(m, settings)
    if (!e.category) {
      add({
        id: `assign-${m.id}`, scope: 'semester', status: 'incomplete', pages: [m.pages.start], moduleIds: [m.id],
        title: `${m.name}: choose a subject`,
        detail: `Eligible in ${opts.filter((o) => o.valid).map((o) => SUBJECT_LABEL[o.subject]).join(', ') || 'no subject matching your settings'}. A module can count in only one subject; the assignment becomes binding when you register for the examination (study plan p. 22).`,
      })
    } else {
      const opt = opts.find((o) => o.subject === e.category)
      if (!opt || !opt.valid)
        add({
          id: `assign-invalid-${m.id}`, scope: 'semester', status: 'conflict', pages: [m.pages.start], moduleIds: [m.id],
          title: `${m.name}: not eligible in ${SUBJECT_LABEL[e.category]}`,
          detail: opt?.reason ?? 'The handbook does not list this module in the assigned subject.',
        })
    }
    const ws = winterStatus(m)
    if (ws === 'summer')
      add({
        id: `term-${m.id}`, scope: 'semester', status: 'conflict', pages: [m.pages.start], moduleIds: [m.id],
        title: `${m.name}: summer-term module`,
        detail: `Recurrence: "${m.recurrence.raw}". No course for WT 26/27 is listed in the handbook.`,
      })
    else if (ws === 'scheduled' && m.recurrence.normalized !== 'WT' && m.recurrence.normalized !== 'WT+ST')
      add({
        id: `term-${m.id}`, scope: 'semester', status: 'unverifiable', pages: [m.pages.start], moduleIds: [m.id],
        title: `${m.name}: offering information is inconsistent`,
        detail: `Recurrence: "${m.recurrence.raw ?? 'Not specified in handbook'}", but a component lists a WT 26/27 course (${[...new Set(m.offering.scheduledCoursesWS2026.map((c) => c.title))].join('; ')}). Check whether the full module is actually offered this winter.`,
      })
    else if (ws === 'uncertain')
      add({
        id: `term-${m.id}`, scope: 'semester', status: 'unverifiable', pages: [m.pages.start], moduleIds: [m.id],
        title: `${m.name}: winter offering not confirmed`,
        detail: `Recurrence: "${m.recurrence.raw ?? 'Not specified in handbook'}" and no WT 26/27 course is listed. Check the KIT course catalogue.`,
      })
    const pre = m.sections.prerequisites?.text
    const modeled = m.sections.modeledPrerequisites?.text
    if ((pre && !isNone(pre)) || modeled)
      add({
        id: `prereq-${m.id}`, scope: 'semester', status: 'unverifiable', pages: [m.sections.prerequisites?.page ?? m.pages.start], moduleIds: [m.id],
        title: `${m.name}: prerequisites to check`,
        detail: [pre && !isNone(pre) ? pre : null, modeled].filter(Boolean).join('\n\n').slice(0, 700),
      })
    // component-level prerequisites (e.g. coursework required before the exam)
    const compPre = m.components
      .map((c) => d.componentById.get(c.id))
      .filter((c) => c && (c.sections.modeledPrerequisites || (c.sections.prerequisites && !isNone(c.sections.prerequisites.text))))
    if (compPre.length)
      add({
        id: `cprereq-${m.id}`, scope: 'semester', status: 'unverifiable', pages: compPre.map((c) => c!.pages.start), moduleIds: [m.id],
        title: `${m.name}: component prerequisites`,
        detail: compPre.map((c) => `${c!.name} (${c!.id}): ${(c!.sections.modeledPrerequisites?.text ?? c!.sections.prerequisites?.text ?? '').slice(0, 220)}`).join('\n'),
      })
    if (settings.preferredLanguage === 'EN' && languageClass(m) === 'DE')
      add({
        id: `lang-${m.id}`, scope: 'semester', status: 'conflict', pages: [m.pages.start], moduleIds: [m.id],
        title: `${m.name}: taught in German`,
        detail: `Language: "${m.language.raw}". Your preferred language is English.`,
      })
    if (m.credits.value === null)
      add({
        id: `credits-${m.id}`, scope: 'semester', status: 'unverifiable', pages: [m.pages.start], moduleIds: [m.id],
        title: `${m.name}: credits not a single value`,
        detail: `Credits: "${m.credits.raw ?? 'Not specified in handbook'}". The module is not included in ECTS totals.`,
      })
    // department-specific approvals (study plan chapter 5)
    if (e.category === 'SEE' || e.category === 'SPEC') {
      const prof = m.eligibility.find((x) => x.subject === e.category && (!settings.seeProfile || x.profile === settings.seeProfile))?.profile
      if (prof === 'Computational Earth System Sciences')
        add({
          id: `appr-cess-${m.id}`, scope: 'semester', status: 'approval', pages: [24, 26], moduleIds: [m.id],
          title: `${m.name}: manual approval (CESS)`,
          detail: 'Modules selected in the Computational Earth System Sciences profile and specialization are approved manually in the Campus system if the choice meets the requirements (study plan 5.3 / 6.3.3).',
        })
      if (prof === 'Computational Chemistry')
        add({
          id: `appr-chem-${m.id}`, scope: 'semester', status: 'approval', pages: [24],
          moduleIds: [m.id], title: `${m.name}: consult the Department of Chemistry`,
          detail: 'Modules of the Computational Chemistry profile must be selected in consultation with the KIT Department of Chemistry and Biosciences; the profile is taught in German (study plan 5.2).',
        })
      if (prof === 'Computational Physics')
        add({
          id: `appr-phys-${m.id}`, scope: 'semester', status: 'approval', pages: [24], moduleIds: [m.id],
          title: `${m.name}: register at the Physics examination office`,
          detail: 'Central online registration is presently impossible at the KIT Department of Physics; students register for examinations in its examination office (study plan 5.5).',
        })
    }
  }

  // ---------------- subject maxima and 80-credit rule (semester-relevant)
  for (const r of REQUIREMENTS) {
    const v = summary.bySubject[r.subject]
    if (v > r.max)
      add({
        id: `max-${r.subject}`, scope: 'semester', status: 'conflict', pages: [r.page, 21],
        title: `${SUBJECT_LABEL[r.subject]}: ${v} ECTS exceeds ${r.max}`,
        detail: `At most ${r.max} ECTS can be credited in ${SUBJECT_LABEL[r.subject]}.`,
        moduleIds: plannedIn(plan, r.subject).map((e) => e.moduleId),
      })
  }
  const over = variableOverrun(plan, d, 0, externals)
  if (over.beyond.length)
    add({
      id: 'eighty', scope: 'semester', status: 'conflict', pages: [18, 21, 22],
      title: 'Variable subjects exceed 80 ECTS more than once',
      detail: `The 80-credit total may be exceeded only once, by the module that first surpasses it (${over.overrunModule ? name(d, over.overrunModule) : 'an earlier module'}). Modules added afterwards would not be recognised: ${over.beyond.map((id) => name(d, id)).join(', ')}.`,
      moduleIds: over.beyond,
    })
  else if (over.overrunModule)
    add({
      id: 'eighty', scope: 'semester', status: 'valid', pages: [18, 21, 22],
      title: 'Permitted one-time overrun of 80 ECTS',
      detail: `${name(d, over.overrunModule)} is the module that first surpasses 80 ECTS, which is permitted once. No further variable-subject modules may be added.`,
    })

  // ---------------- SEE profile consistency
  const seeEntries = plan.filter((e) => e.category === 'SEE' || (e.category === 'SPEC' && settings.specialization === 'SEE'))
  if (seeEntries.length && !settings.seeProfile)
    add({
      id: 'see-profile-missing', scope: 'semester', status: 'incomplete', pages: [23, 38],
      title: 'Choose your SEE profile',
      detail: 'Exactly one SEE profile may be attended. Set it in Settings so eligibility can be checked.',
      moduleIds: seeEntries.map((e) => e.moduleId),
    })
  if (!settings.seeProfile && seeEntries.length) {
    const profiles = new Set<string>()
    for (const e of plan.filter((x) => x.category === 'SEE')) {
      const ps = d.moduleById.get(e.moduleId)?.eligibility.filter((x) => x.subject === 'SEE').map((x) => x.profile)
      if (ps && ps.length === 1 && ps[0]) profiles.add(ps[0])
    }
    if (profiles.size > 1)
      add({
        id: 'see-multi', scope: 'semester', status: 'conflict', pages: [23],
        title: 'SEE modules from different profiles',
        detail: `Planned SEE modules belong only to different profiles (${[...profiles].join(', ')}). Exactly one SEE profile may be attended.`,
      })
  }
  if (settings.seeProfile === 'Electrical Engineering and Information Technology' && !settings.eeFocus && seeEntries.length)
    add({
      id: 'ee-focus', scope: 'semester', status: 'incomplete', pages: [25, 44],
      title: 'Choose your EE&IT focus',
      detail: 'One of the two foci must be chosen and all modules must come from the same focus; the focus is continued in an SEE specialization.',
    })

  // ---------------- "Elective: 1 item" groups (e.g. ROSP seminar) must not be over-filled
  for (const n of d.structure.nodes) {
    for (const g of n.groups) {
      const lim = /^(?:at most )?(\d+) items?$/.exec(g.constraint ?? '')
      if (!lim || g.entries.every((x) => !x.moduleId)) continue
      const subject = n.category.subject
      if (!subject) continue
      const relevant = plannedIn(plan, subject).filter((e) => {
        const m = d.moduleById.get(e.moduleId)
        if (!moduleInGroup(m, n.uid, g.label)) return false
        // a module also listed in another group of the same node may count there instead
        return !m!.eligibility.some((x) => x.node === n.uid && x.group !== g.label)
      })
      if (subject === 'SPEC' && settings.specialization && n.category.specialization !== settings.specialization) continue
      if (relevant.length > Number(lim[1]))
        add({
          id: `group-${n.uid}-${g.label}`, scope: 'semester', status: 'conflict', pages: [g.page],
          title: `${g.name}: more than ${lim[1]} selected`,
          detail: `The handbook allows "${g.constraint}" in "${g.label}" (${n.path.join(' / ')}). Planned: ${relevant.map((e) => name(d, e.moduleId)).join(', ')}.`,
          moduleIds: relevant.map((e) => e.moduleId),
        })
    }
  }

  // ---------------- schedule
  const sch = scheduleStatus(scheduleItems(plan, externals))
  if (sch.kind === 'conflicts')
    add({
      id: 'schedule', scope: 'semester', status: 'conflict', pages: [],
      title: `${sch.conflicts.length} time conflict${sch.conflicts.length > 1 ? 's' : ''} in entered times`,
      detail: sch.conflicts.map((c) => `${name(d, c.a.moduleId)} (${c.a.slot.day} ${c.a.slot.start}–${c.a.slot.end}) overlaps ${name(d, c.b.moduleId)} (${c.b.slot.day} ${c.b.slot.start}–${c.b.slot.end})`).join('\n'),
      moduleIds: [...new Set(sch.conflicts.flatMap((c) => [c.a.moduleId, c.b.moduleId]))],
    })
  if (sch.kind === 'conflicts' || sch.kind === 'unverified')
    if (sch.unverified.length)
      add({
        id: 'schedule-unverified', scope: 'semester', status: 'unverifiable', pages: [],
        title: 'Schedule not verified',
        detail: `The handbook contains no weekly meeting times. No times entered for: ${sch.unverified.map((id) => name(d, id)).join(', ')}.`,
        moduleIds: sch.unverified,
      })

  // ================= degree-level checks (Degree Requirements page) =================
  for (const r of REQUIREMENTS) {
    const v = summary.bySubject[r.subject]
    if (v > r.max) continue // reported above
    const unverified = summary.unverifiedBySubject[r.subject]
    // credits from unrecognised external courses never make a requirement "valid" on their own
    const status: Status = v - unverified >= r.min ? 'valid' : v >= r.min ? 'approval' : 'incomplete'
    add({
      id: `range-${r.subject}`, scope: 'degree', pages: [r.page],
      status,
      title: `${SUBJECT_LABEL[r.subject]}: ${v} of ${r.min === r.max ? r.min : `${r.min}–${r.max}`} ECTS planned`,
      detail:
        (status === 'valid'
          ? 'Planned credits are within the permitted range.'
          : v >= r.min
            ? 'Reached only with external credits whose recognition is not confirmed.'
            : `${r.min - v} ECTS still needed (over the whole degree).`) +
        (unverified ? ` Includes ${unverified} ECTS from external courses pending recognition (not completed).` : ''),
    })
  }
  const varTotal = VARIABLE_SUBJECTS.reduce((a, s) => a + summary.bySubject[s], 0)
  add({
    id: 'variable-total', scope: 'degree', pages: [18, 21], status: varTotal >= VARIABLE_TOTAL ? 'valid' : 'incomplete',
    title: `Four variable subjects: ${varTotal} of 80 ECTS`,
    detail: 'Mathematics, Computer Science, SEE and Specialization must total 80 ECTS, with at least 16 in each. The total may be exceeded once by the module that first surpasses it.',
  })
  const degreeTotal = summary.total - summary.bySubject.ADDITIONAL - summary.unassigned
  add({
    id: 'degree-total', scope: 'degree', pages: [20, 21], status: degreeTotal >= DEGREE_TOTAL ? 'valid' : 'incomplete',
    title: `Degree total: ${degreeTotal} of 120 ECTS planned`,
    detail: 'Includes assigned modules only. Additional Examinations do not count towards the 120 ECTS.',
  })

  // generic skills
  const has = (id: string) => plan.some((e) => e.moduleId === id)
  add({
    id: 'hpc', scope: 'degree', pages: [27, 66], status: has(HACKATHON) && has(DISTRIBUTED_COMPUTING) ? 'valid' : 'incomplete',
    title: 'Hackathon and Distributed Computing (6 ECTS)',
    detail: `Mandatory: ${name(d, HACKATHON)} (2 ECTS) — ${has(HACKATHON) ? 'planned' : 'not planned'}; ${name(d, DISTRIBUTED_COMPUTING)} (4 ECTS) — ${has(DISTRIBUTED_COMPUTING) ? 'planned' : 'not planned'}.`,
  })
  const iqExternal = externals.filter((x) => x.category === 'IQ' && externalCounts(x))
  const iqConfirmed = iqExternal.filter((x) => x.recognition === 'confirmed').reduce((a, x) => a + x.ects, 0)
  add({
    id: 'iq', scope: 'degree', pages: [28, 66],
    status: iqConfirmed >= 4 ? 'valid' : has(KEY_COMPETENCES) || iqExternal.length ? 'approval' : 'incomplete',
    title: 'Interdisciplinary Qualifications (4 ECTS)',
    detail: iqExternal.length
      ? `Planned: ${iqExternal.map((x) => `${x.title} (${x.ects} ECTS, ${REGISTRATION_LABEL[x.registration].toLowerCase()}, ${RECOGNITION_LABEL[x.recognition].toLowerCase()})`).join('; ')}. Not counted as completed until the credits are recognised (module Key Competences, ${KEY_COMPETENCES}).`
      : has(KEY_COMPETENCES)
        ? 'Key Competences is planned. Courses from HoC, ARRTI, the Language Center or FORUM are chosen each semester; check that the selected courses are recognised.'
        : 'At least 4 ECTS from HoC, ARRTI, the Language Center or FORUM (module Key Competences).',
  })

  // SEE profile
  if (!settings.seeProfile)
    add({
      id: 'see-profile', scope: 'degree', pages: [23, 38], status: 'incomplete',
      title: 'SEE profile not selected',
      detail: 'Exactly one of the eight SEE profiles must be chosen. The profile is fixed when you register for the first examination in it.',
    })
  else {
    add({
      id: 'see-profile', scope: 'degree', pages: [23, 38], status: 'valid',
      title: `SEE profile: ${settings.seeProfile}`,
      detail: 'Exactly one SEE profile may be attended. Changing it later requires an application to the Examination Committee.',
    })
    for (const n of profileNodes(d, false, settings.seeProfile)) checkRequirementGroups(n, 'SEE', plan, d, add)
    if (settings.seeProfile === 'Business and Economics') {
      const v = summary.bySubject.SEE
      add({
        id: 'bwl-18', scope: 'degree', pages: [23], status: v >= 18 ? 'valid' : 'incomplete',
        title: `Business and Economics: ${v} of at least 18 ECTS in SEE`,
        detail: 'Due to the module scope (9 credits each), at least 18 credits must be reached in this profile (study plan 5.1).',
      })
    }
    if (settings.seeProfile === 'Computational Earth System Sciences')
      add({
        id: 'cess-foci', scope: 'degree', pages: [24], status: 'approval',
        title: 'CESS: modules from two of the five foci',
        detail: 'Modules must be chosen from two of the five foci in roughly equal proportions; deviations must be agreed in the orientation module. Selections are approved manually.',
      })
    if (settings.seeProfile === 'Electrical Engineering and Information Technology')
      add({
        id: 'ee-focus-degree', scope: 'degree', pages: [25, 44], status: settings.eeFocus ? 'valid' : 'incomplete',
        title: settings.eeFocus ? `EE&IT focus: ${settings.eeFocus.replace('Focus: ', '')}` : 'EE&IT focus not selected',
        detail: `One of the foci (${EE_FOCI.map((f) => f.replace('Focus: ', '')).join(' / ')}) must be chosen; all modules must come from it, and it is continued in an SEE specialization.`,
      })
  }

  // Specialization
  const sp = settings.specialization
  if (!sp)
    add({
      id: 'spec', scope: 'degree', pages: [25, 46], status: 'incomplete',
      title: 'Specialization not selected',
      detail: 'A specialization must be chosen in Mathematics for CDS, Computer Science or SEE (16–32 ECTS). The master’s thesis is usually written in it.',
    })
  else {
    if (sp === 'SEE' && !settings.seeProfile)
      add({
        id: 'spec', scope: 'degree', pages: [25, 53], status: 'incomplete',
        title: 'SEE specialization needs an SEE profile',
        detail: 'When specializing in SEE, the previously selected SEE profile must be continued.',
      })
    else
      add({
        id: 'spec', scope: 'degree', pages: [25, 46], status: 'valid',
        title: `Specialization: ${sp === 'SEE' ? `SEE · ${settings.seeProfile}` : sp === 'MATH' ? 'Mathematics for CDS' : 'Computer Science'}`,
        detail: sp === 'SEE' ? 'The SEE specialization continues your SEE profile (and EE&IT focus, if applicable).' : 'Modules may be attended once only, either in the subject or in the specialization.',
      })
    if (sp === 'MATH') {
      add({
        id: 'spec-math-seminar', scope: 'degree', pages: [25, 47], status: has(MATH_SEMINAR) ? 'valid' : 'incomplete',
        title: 'Specialization Mathematics: mathematical seminar (3 ECTS)',
        detail: `The ungraded seminar ${name(d, MATH_SEMINAR)} (${MATH_SEMINAR}) is mandatory and counts as Research Oriented Study Project — ${has(MATH_SEMINAR) ? 'planned' : 'not planned'}.`,
      })
    }
    const specNodes =
      sp === 'SEE' && settings.seeProfile
        ? profileNodes(d, true, settings.seeProfile)
        : d.structure.nodes.filter((n) => n.category.subject === 'SPEC' && n.category.specialization === sp && sp !== 'SEE')
    for (const n of specNodes) {
      if (sp === 'SEE' && settings.seeProfile === 'Electrical Engineering and Information Technology' && settings.eeFocus && n.category.focus && n.category.focus !== settings.eeFocus) continue
      checkRequirementGroups(n, 'SPEC', plan, d, add, sp === 'MATH' ? [MATH_SEMINAR] : [])
    }
  }

  add({
    id: 'binding', scope: 'degree', pages: [22], status: 'unverifiable',
    title: 'Subject assignment becomes binding at exam registration',
    detail: 'The planner’s subject assignments are tentative. Official assignment happens in the Campus system and can later only be changed by application to the Examination Committee.',
  })
  return checks
}

function checkRequirementGroups(
  n: StructureNode,
  subject: Subject,
  plan: PlanEntry[],
  d: Dataset,
  add: (c: Check) => void,
  skip: string[] = [],
) {
  for (const g of requirementGroups(n)) {
    const ids = g.entries.map((e) => e.moduleId).filter((x): x is string => !!x && !skip.includes(x))
    if (!ids.length) continue
    const planned = plan.filter((e) => ids.includes(e.moduleId) && e.category === subject)
    const need = g.kind === 'mandatory' ? ids.length : Number(/(\d+) item/.exec(g.constraint ?? '')?.[1] ?? 1)
    const ok = planned.length >= need
    add({
      id: `req-${n.uid}-${g.label}`, scope: 'degree', pages: [g.page], status: ok ? 'valid' : 'incomplete',
      title: `${n.title}: ${g.kind === 'mandatory' ? 'mandatory module' : g.name}`,
      detail: g.kind === 'mandatory'
        ? `${ids.map((id) => `${name(d, id)} (${id})`).join(', ')} — ${ok ? 'planned' : 'not yet planned'} in ${SUBJECT_LABEL[subject]}.`
        : `Choose ${g.constraint} from "${g.label}" (${ids.length} options). ${planned.length ? `Planned: ${planned.map((e) => name(d, e.moduleId)).join(', ')}.` : 'None planned yet.'}`,
      moduleIds: planned.map((e) => e.moduleId),
    })
  }
}

export const STATUS_ORDER: Status[] = ['conflict', 'approval', 'unverifiable', 'incomplete', 'valid']
