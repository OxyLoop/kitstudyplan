import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDataset } from '../lib/data'
import { eligibilityLabels, isNone, languageClass, winterStatus } from '../lib/domain'
import { defaultFilters, matches, searchText } from '../lib/filters'
import {
  EMPTY_STATE,
  addToPlan,
  assignmentOptions,
  ectsSummary,
  findConflicts,
  mergeState,
  sanitizeExternal,
  sanitizeState,
  scheduleItems,
  scheduleStatus,
  type AppState,
  type PlanEntry,
} from '../lib/planner'
import { runChecks, variableOverrun } from '../lib/rules'
import { moduleSummary } from '../lib/summary'

const dir = join(__dirname, '../../public/data')
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf-8'))
const data = buildDataset({
  meta: load('handbook.json'),
  modules: load('modules.json'),
  components: load('module-components.json'),
  structure: load('program-structure.json'),
  regulations: load('regulations.json'),
  report: load('extraction-report.json'),
})
const mod = (id: string) => data.moduleById.get(id)!
const entry = (moduleId: string, category: PlanEntry['category'], addedAt = 0, times: PlanEntry['times'] = []): PlanEntry => ({
  moduleId, category, note: '', times, addedAt,
})
const withPlan = (plan: PlanEntry[], settings: Partial<AppState['settings']> = {}): AppState => ({
  ...EMPTY_STATE,
  plan,
  settings: { ...EMPTY_STATE.settings, ...settings },
})

describe('extracted dataset', () => {
  it('contains every module and component listed in the table of contents', () => {
    const toc = load('handbook.json').printedToc as { id?: string }[]
    const tocMods = toc.filter((e) => e.id?.startsWith('M-')).map((e) => e.id)
    const tocComps = toc.filter((e) => e.id?.startsWith('T-')).map((e) => e.id)
    expect(data.modules).toHaveLength(375)
    expect(data.components).toHaveLength(531)
    expect(new Set(data.modules.map((m) => m.id))).toEqual(new Set(tocMods))
    expect(new Set(data.components.map((c) => c.id))).toEqual(new Set(tocComps))
    expect(data.report.errors).toHaveLength(0)
  })

  it('has unique IDs', () => {
    expect(new Set(data.modules.map((m) => m.id)).size).toBe(data.modules.length)
    expect(new Set(data.components.map((c) => c.id)).size).toBe(data.components.length)
  })

  it('links modules and components in both directions', () => {
    for (const m of data.modules)
      for (const c of m.components) {
        const comp = data.componentById.get(c.id)
        expect(comp, `${m.id} -> ${c.id}`).toBeDefined()
        expect(comp!.partOf.map((p) => p.moduleId)).toContain(m.id)
      }
    for (const c of data.components)
      for (const p of c.partOf) expect(mod(p.moduleId).components.map((x) => x.id)).toContain(c.id)
  })

  it('keeps page references inside the PDF and in order', () => {
    for (const r of [...data.modules, ...data.components]) {
      expect(r.pages.start).toBeGreaterThanOrEqual(67)
      expect(r.pages.end).toBeGreaterThanOrEqual(r.pages.start)
      expect(r.pages.end).toBeLessThanOrEqual(1168)
    }
  })

  it('matches handbook facts for a sample module (PDF p. 67)', () => {
    const m = mod('M-BGU-100340')
    expect(m.name).toBe('Groundwater Management')
    expect(m.code).toBe('bauiM2S08-HY8')
    expect(m.credits.value).toBe(6)
    expect(m.recurrence.raw).toBe('Each summer term')
    expect(m.duration).toBe('2 terms')
    expect(m.language.raw).toBe('English')
    expect(m.pages.start).toBe(67)
    expect(m.components.map((c) => c.id)).toEqual(['T-BGU-100624', 'T-BGU-100625'])
    expect(m.sections.prerequisites.text).toBe('none')
    expect(m.eligibility.map((e) => e.subject).sort()).toEqual(['SEE', 'SPEC'])
  })

  it('represents multi-field eligibility as arrays', () => {
    const rl = mod('M-INFO-105623') // Reinforcement Learning
    expect(new Set(rl.eligibility.map((e) => e.subject))).toEqual(new Set(['CS', 'SEE', 'SPEC']))
    expect(eligibilityLabels(rl).length).toBeGreaterThan(2)
  })

  it('assigns every structure entry to an existing module', () => {
    for (const n of data.structure.nodes)
      for (const g of n.groups) for (const e of g.entries) if (e.moduleId) expect(data.moduleById.has(e.moduleId)).toBe(true)
  })

  it('keeps the original term value next to the normalised one', () => {
    for (const m of data.modules) {
      if (m.recurrence.raw === 'Irregular') expect(m.recurrence.normalized).toBe('IRREGULAR')
      if (m.recurrence.raw === 'Each term') expect(m.recurrence.normalized).toBe('WT+ST')
    }
  })
})

describe('winter-term filtering', () => {
  const index = new Map(data.modules.map((m) => [m.id, searchText(m)]))
  const run = (f = defaultFilters()) => data.modules.filter((m) => matches(m, f, { saved: [], index }))

  it('default filter keeps only WS 2026/27, English-taught, CDS-creditable modules', () => {
    const res = run()
    expect(res.length).toBeGreaterThan(50)
    for (const m of res) {
      expect(['scheduled', 'recurring']).toContain(winterStatus(m))
      expect(['EN', 'DE/EN']).toContain(languageClass(m))
    }
  })

  it('never treats irregular modules without a WT 26/27 course as winter offerings', () => {
    for (const m of data.modules)
      if (!m.offering.scheduledWS2026 && ['IRREGULAR', 'SEE_NOTES', 'UNKNOWN'].includes(m.recurrence.normalized))
        expect(winterStatus(m)).toBe('uncertain')
  })

  it('removing filters exposes the complete catalog', () => {
    const all = run({ ...defaultFilters('ANY'), semester: 'any', programOnly: false })
    expect(all).toHaveLength(375)
  })

  it('searches by module ID and component ID', () => {
    const f = { ...defaultFilters('ANY'), semester: 'any' as const, programOnly: false }
    expect(run({ ...f, q: 'M-BGU-100340' }).map((m) => m.id)).toEqual(['M-BGU-100340'])
    expect(run({ ...f, q: 'T-BGU-100625' }).map((m) => m.id)).toEqual(['M-BGU-100340'])
  })
})

describe('planner', () => {
  it('prevents duplicate selections', () => {
    let s = addToPlan(EMPTY_STATE, mod('M-INFO-105623'))
    s = addToPlan(s, mod('M-INFO-105623'))
    expect(s.plan).toHaveLength(1)
  })

  it('auto-assigns only when exactly one subject is possible', () => {
    expect(addToPlan(EMPTY_STATE, mod('M-INFO-105623')).plan[0].category).toBeNull()
    const mathOnly = data.modules.find((m) => new Set(m.eligibility.map((e) => e.subject)).size === 1 && m.eligibility[0].subject === 'MATH')!
    expect(addToPlan(EMPTY_STATE, mathOnly).plan[0].category).toBe('MATH')
  })

  it('counts each module exactly once in its assigned subject', () => {
    const plan = [entry('M-INFO-105623', 'CS'), entry('M-BGU-100340', 'SEE'), entry('M-MATH-102919', null)]
    const s = ectsSummary(plan, data.moduleById)
    expect(s.total).toBe(6 + 6 + 8)
    expect(s.bySubject.CS).toBe(6)
    expect(s.bySubject.SEE).toBe(6)
    expect(s.bySubject.SPEC).toBe(0)
    expect(s.unassigned).toBe(8)
    const sumAssigned = Object.values(s.bySubject).reduce((a, b) => a + b, 0)
    expect(sumAssigned + s.unassigned).toBe(s.total)
  })

  it('marks SEE assignment invalid for a different SEE profile', () => {
    const opts = assignmentOptions(mod('M-BGU-100340'), { ...EMPTY_STATE.settings, seeProfile: 'Business and Economics' })
    expect(opts.find((o) => o.subject === 'SEE')?.valid).toBe(false)
  })

  it('detects overlaps only between entered times', () => {
    const plan = [
      entry('M-INFO-105623', 'CS', 0, [{ id: 'a', day: 'Mon', start: '10:00', end: '11:30' }]),
      entry('M-BGU-100340', 'SEE', 0, [{ id: 'b', day: 'Mon', start: '11:00', end: '12:30' }]),
      entry('M-MATH-102919', 'MATH', 0, [{ id: 'c', day: 'Mon', start: '11:30', end: '13:00' }]),
    ]
    const c = findConflicts(plan)
    expect(c).toHaveLength(2) // a–b and b–c; a–c only touch
    expect(scheduleStatus(plan).kind).toBe('conflicts')
  })

  it('never reports a verified schedule when times are missing', () => {
    const plan = [entry('M-INFO-105623', 'CS'), entry('M-BGU-100340', 'SEE', 0, [{ id: 'b', day: 'Tue', start: '08:00', end: '09:30' }])]
    const st = scheduleStatus(plan)
    expect(st.kind).toBe('unverified')
    if (st.kind === 'unverified') expect(st.unverified).toEqual(['M-INFO-105623'])
  })

  it('round-trips through persistence and drops invalid/duplicate data', () => {
    const state = withPlan([entry('M-INFO-105623', 'CS', 1, [{ id: 'x', day: 'Wed', start: '09:00', end: '10:00' }])], { seeProfile: 'Process Engineering', targetEcts: 30 })
    const restored = sanitizeState(JSON.parse(JSON.stringify(state)), new Set(data.modules.map((m) => m.id)))
    expect(restored).toEqual({ ...state, saved: [], compare: [] })
    const dirty = sanitizeState(
      { plan: [entry('M-INFO-105623', 'CS'), entry('M-INFO-105623', 'MATH'), entry('M-FAKE-000000', 'CS'), { moduleId: 5 }], compare: ['M-INFO-105623', 'M-BGU-100340', 'M-MATH-102919', 'M-INFO-100738'], settings: { specialization: 'XYZ' } },
      new Set(data.modules.map((m) => m.id)),
    )
    expect(dirty.plan.map((e) => e.moduleId)).toEqual(['M-INFO-105623'])
    expect(dirty.compare).toHaveLength(3)
    expect(dirty.settings.specialization).toBeNull()
  })
})

describe('academic rules', () => {
  it('allows exactly one overrun of the 80-credit variable total', () => {
    const big = data.modules.filter((m) => m.credits.value === 8 && m.eligibility.some((e) => e.subject === 'MATH')).slice(0, 12)
    const plan = big.map((m, i) => entry(m.id, 'MATH', i))
    // 10 × 8 = 80 exactly → the 11th module is beyond the threshold
    const r = variableOverrun(plan.slice(0, 10), data, 0)
    expect(r.beyond).toHaveLength(0)
    const r2 = variableOverrun(plan.slice(0, 11), data, 0)
    expect(r2.beyond).toHaveLength(1)
    // 76 + 8 crosses once: permitted, the next one is not
    const r3 = variableOverrun(plan.slice(0, 2), data, 76)
    expect(r3.overrunModule).toBe(plan[0].moduleId)
    expect(r3.beyond).toEqual([plan[1].moduleId])
  })

  it('flags more than one ROSP seminar in the CS specialization', () => {
    const node = data.structure.nodes.find((n) => n.uid === '3.5.2')!
    const sem = node.groups.find((g) => /Seminars/.test(g.label ?? ''))!
    const onlySeminar = sem.entries
      .map((e) => mod(e.moduleId!))
      .filter((m) => m.eligibility.filter((e) => e.node === '3.5.2').every((e) => e.group === sem.label))
      .slice(0, 2)
    const checks = runChecks(withPlan(onlySeminar.map((m, i) => entry(m.id, 'SPEC', i)), { specialization: 'CS' }), data)
    expect(checks.some((c) => c.status === 'conflict' && c.id.startsWith('group-3.5.2'))).toBe(true)
  })

  it('reports summer-only modules and unassigned modules', () => {
    const summer = data.modules.find((m) => winterStatus(m) === 'summer')!
    const checks = runChecks(withPlan([entry(summer.id, null)]), data)
    expect(checks.find((c) => c.id === `term-${summer.id}`)?.status).toBe('conflict')
    expect(checks.find((c) => c.id === `assign-${summer.id}`)?.status).toBe('incomplete')
  })

  it('requires a SEE specialization to follow the SEE profile', () => {
    const checks = runChecks(withPlan([], { specialization: 'SEE' }), data)
    expect(checks.find((c) => c.id === 'spec')?.status).toBe('incomplete')
  })
})

describe('incomplete data handling', () => {
  it('treats "none" prerequisites as none', () => {
    expect(isNone('none')).toBe(true)
    expect(isNone('None.')).toBe(true)
    expect(isNone('See partial achievements (Teilleistung)')).toBe(false)
  })

  it('builds summaries for modules without description sections', () => {
    const bare = data.modules.find((m) => m.sectionOrder.length === 0)!
    const s = moduleSummary(bare, data)
    expect(s.lead.length).toBeGreaterThan(10)
    expect(s.lines.find((l) => l.label === 'Prerequisites')?.text).toBe('Not specified in handbook')
    expect(s.firstGoal).toBeNull()
  })
})

describe('external courses (not in the Module Handbook)', () => {
  const german = sanitizeExternal({
    id: 'ext-9999001',
    title: 'Example Language Course',
    courseNumber: '9999001',
    ects: 4,
    category: 'IQ',
    room: 'Example room',
    startDate: '2026-11-03',
    registration: 'accepted',
    recognition: 'pending',
    times: [
      { id: 'g-tue', day: 'Tue', start: '15:45', end: '17:15' },
      { id: 'g-thu', day: 'Thu', start: '15:45', end: '17:15' },
    ],
    addedAt: 10,
  })!

  it('sanitizes a manually entered course without requiring a handbook ID', () => {
    expect(german.id).toBe('ext-9999001')
    expect(german.completed).toBe(false)
    expect(data.moduleById.has(german.id)).toBe(false)
    expect(sanitizeExternal({ title: '', ects: 4 })).toBeNull()
    expect(sanitizeExternal({ title: 'X', ects: 'abc' })).toBeNull()
  })

  it('adds its ECTS to the planned total once, as pending recognition and never as completed', () => {
    const plan = [entry('M-INFO-105623', 'CS'), entry('M-MATH-102919', 'MATH')]
    const before = ectsSummary(plan, data.moduleById, [])
    const after = ectsSummary(plan, data.moduleById, [german])
    expect(after.total).toBe(before.total + 4)
    expect(after.bySubject.IQ).toBe(4)
    expect(after.unverifiedBySubject.IQ).toBe(4)
    expect(after.pendingRecognition).toBe(4)
    expect(after.completed).toBe(0)
    expect(Object.values(after.bySubject).reduce((a, b) => a + b, 0) + after.unassigned).toBe(after.total)
  })

  it('does not count a rejected registration', () => {
    const s = ectsSummary([], data.moduleById, [{ ...german, registration: 'rejected' }])
    expect(s.total).toBe(0)
  })

  it('takes part in schedule conflict detection', () => {
    const clash = entry('M-INFO-105623', 'CS', 0, [{ id: 'rl', day: 'Thu', start: '16:00', end: '17:00' }])
    expect(findConflicts(scheduleItems([clash], [german]))).toHaveLength(1)
    const ok = entry('M-INFO-105623', 'CS', 0, [{ id: 'rl', day: 'Thu', start: '09:45', end: '11:15' }])
    expect(findConflicts(scheduleItems([ok], [german]))).toHaveLength(0)
  })

  it('keeps IQ at "requires manual approval" until recognition is confirmed', () => {
    const pending = runChecks({ ...withPlan([]), externals: [german] }, data)
    expect(pending.find((c) => c.id === 'iq')?.status).toBe('approval')
    expect(pending.find((c) => c.id === 'range-IQ')?.status).toBe('approval')
    expect(pending.find((c) => c.id === `ext-rec-${german.id}`)?.status).toBe('approval')
    const confirmed = runChecks({ ...withPlan([]), externals: [{ ...german, recognition: 'confirmed' }] }, data)
    expect(confirmed.find((c) => c.id === 'iq')?.status).toBe('valid')
  })

  it('loads older saved data without externals and merges additively', () => {
    const legacy = { version: 1, plan: [entry('M-INFO-105623', 'CS', 1)], planNotes: 'keep me', saved: ['M-BGU-100340'], compare: [], settings: { seeProfile: 'Process Engineering' } }
    const known = new Set(data.modules.map((m) => m.id))
    const current = sanitizeState(legacy, known)
    expect(current.externals).toEqual([])
    const { state, added } = mergeState(current, sanitizeState({ externals: [german], plan: [entry('M-INFO-105623', 'MATH')] }, known))
    expect(added).toEqual([german.title])
    expect(state.plan).toEqual(current.plan) // existing module untouched (category stays CS)
    expect(state.planNotes).toBe('keep me')
    expect(state.saved).toEqual(['M-BGU-100340'])
    expect(state.settings).toEqual(current.settings)
    expect(state.externals).toEqual([german])
    expect(mergeState(state, sanitizeState({ externals: [german] }, known)).added).toEqual([]) // no duplicates
  })
})
