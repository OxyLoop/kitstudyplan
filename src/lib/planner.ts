import { SUBJECT_ORDER } from './domain'
import type { CampusEvent } from './timetable'
import type { Module, SpecType, Subject } from './types'

// ------------------------------------------------------------------ state shapes

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'
export const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface TimeSlot {
  id: string
  day: Day
  start: string // HH:MM, entered manually by the student
  end: string
  label?: string
}

export interface PlanEntry {
  moduleId: string
  /** The single subject this module's credits are accounted to (null = not yet assigned). */
  category: Subject | null
  note: string
  times: TimeSlot[]
  addedAt: number
}

export type RegistrationStatus = 'planned' | 'applied' | 'waitlisted' | 'accepted' | 'rejected'
export type RecognitionStatus = 'pending' | 'confirmed' | 'rejected'

export const REGISTRATION_LABEL: Record<RegistrationStatus, string> = {
  planned: 'Planned',
  applied: 'Applied',
  waitlisted: 'Waitlisted',
  accepted: 'Accepted',
  rejected: 'Rejected',
}
export const RECOGNITION_LABEL: Record<RecognitionStatus, string> = {
  pending: 'Credit recognition pending verification',
  confirmed: 'Credit recognition confirmed',
  rejected: 'Credit recognition rejected',
}

/**
 * A course entered manually by the student that is not part of the Module Handbook
 * (e.g. a Language Center course). Nothing about it is handbook data.
 */
export interface ExternalCourse {
  id: string // "ext-<course number or timestamp>"
  title: string
  courseNumber: string
  ects: number
  /** Subject the student intends to count it towards (one only). */
  category: Subject | null
  provider: string
  room: string
  startDate: string // YYYY-MM-DD
  times: TimeSlot[]
  registration: RegistrationStatus
  recognition: RecognitionStatus
  /** Always false while planning: planned credits are never completed credits. */
  completed: boolean
  note: string
  addedAt: number
}

export interface TimetablePrefs {
  /** Owner IDs (module or external course) hidden in the calendar. */
  hidden: string[]
  /** Selected alternative group per event number. */
  groupChoice: Record<string, string>
  /** Events imported by the student from an exported calendar file (.ics). */
  imported: CampusEvent[]
  /** Event numbers whose import was accepted although a manually verified record exists. */
  acceptedImports: string[]
}

export const EMPTY_TIMETABLE: TimetablePrefs = { hidden: [], groupChoice: {}, imported: [], acceptedImports: [] }

export interface Settings {
  semester: 'WS 2026/27'
  preferredLanguage: 'EN' | 'ANY'
  seeProfile: string | null
  eeFocus: string | null
  specialization: SpecType | null
  targetEcts: number | null
}

export interface AppState {
  version: 1
  plan: PlanEntry[]
  /** Manually entered courses outside the Module Handbook (optional in older saved data). */
  externals: ExternalCourse[]
  /** Timetable display choices and imported schedules (optional in older saved data). */
  timetable: TimetablePrefs
  planNotes: string
  saved: string[]
  compare: string[]
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  semester: 'WS 2026/27',
  preferredLanguage: 'EN',
  seeProfile: null,
  eeFocus: null,
  specialization: null,
  targetEcts: null,
}

export const EMPTY_STATE: AppState = {
  version: 1,
  plan: [],
  externals: [],
  timetable: EMPTY_TIMETABLE,
  planNotes: '',
  saved: [],
  compare: [],
  settings: DEFAULT_SETTINGS,
}

export const MAX_COMPARE = 3

// ------------------------------------------------------------------ assignment options

export interface AssignmentOption {
  subject: Subject
  valid: boolean
  reason?: string
}

/**
 * Subjects a module may be accounted to, given the student's settings.
 * Derived only from the handbook's program structure listings.
 */
export function assignmentOptions(m: Module, s: Settings): AssignmentOption[] {
  const out: AssignmentOption[] = []
  for (const subject of SUBJECT_ORDER) {
    const el = m.eligibility.filter((e) => e.subject === subject)
    if (!el.length) continue
    if (subject === 'SEE') {
      if (!s.seeProfile) {
        out.push({ subject, valid: true, reason: `Eligible in SEE profile(s): ${unique(el.map((e) => e.profile)).join(', ')}` })
      } else {
        const match = el.filter((e) => e.profile === s.seeProfile)
        if (!match.length) {
          out.push({ subject, valid: false, reason: `Only eligible in SEE profile(s) ${unique(el.map((e) => e.profile)).join(', ')} — your profile is ${s.seeProfile}` })
        } else if (s.seeProfile === 'Electrical Engineering and Information Technology' && s.eeFocus && !match.some((e) => e.focus === s.eeFocus)) {
          out.push({ subject, valid: false, reason: `Not listed in your focus (${s.eeFocus})` })
        } else out.push({ subject, valid: true })
      }
      continue
    }
    if (subject === 'SPEC') {
      if (!s.specialization) {
        out.push({ subject, valid: true, reason: `Eligible in: ${unique(el.map(specLabel)).join(', ')}` })
        continue
      }
      const match = el.filter((e) => e.specialization === s.specialization && (s.specialization !== 'SEE' || !s.seeProfile || e.profile === s.seeProfile))
      if (!match.length) {
        out.push({ subject, valid: false, reason: `Not listed in your specialization (eligible in: ${unique(el.map(specLabel)).join(', ')})` })
      } else if (s.specialization === 'SEE' && s.seeProfile === 'Electrical Engineering and Information Technology' && s.eeFocus && !match.some((e) => e.focus === s.eeFocus)) {
        out.push({ subject, valid: false, reason: `Not listed in your focus (${s.eeFocus})` })
      } else out.push({ subject, valid: true })
      continue
    }
    out.push({ subject, valid: true })
  }
  return out
}

function specLabel(e: { specialization: SpecType | null; profile: string | null }) {
  if (e.specialization === 'SEE') return `SEE · ${e.profile}`
  return e.specialization === 'MATH' ? 'Mathematics' : 'Computer Science'
}

function unique<T>(xs: (T | null)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x !== null))]
}

/** Auto-assign only when exactly one valid subject exists; otherwise the student decides. */
export function defaultCategory(m: Module, s: Settings): Subject | null {
  const valid = assignmentOptions(m, s).filter((o) => o.valid)
  return valid.length === 1 ? valid[0].subject : null
}

// ------------------------------------------------------------------ plan operations

export function addToPlan(state: AppState, m: Module, now = Date.now()): AppState {
  if (state.plan.some((e) => e.moduleId === m.id)) return state // duplicate selection prevented
  const entry: PlanEntry = { moduleId: m.id, category: defaultCategory(m, state.settings), note: '', times: [], addedAt: now }
  return { ...state, plan: [...state.plan, entry] }
}

export function removeFromPlan(state: AppState, id: string): AppState {
  return { ...state, plan: state.plan.filter((e) => e.moduleId !== id) }
}

export function toggleList(list: string[], id: string, max?: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id)
  if (max !== undefined && list.length >= max) return list
  return [...list, id]
}

// ------------------------------------------------------------------ ECTS accounting

export interface EctsSummary {
  /** Planned ECTS of this semester (handbook modules + external courses not rejected). */
  total: number
  /** Planned ECTS per assigned subject; each item is counted exactly once. */
  bySubject: Record<Subject, number>
  /** Part of bySubject that comes from external courses whose recognition is not confirmed. */
  unverifiedBySubject: Record<Subject, number>
  unassigned: number
  /** External ECTS whose credit recognition is still pending (included in total). */
  pendingRecognition: number
  /** ECTS from external courses (included in total). */
  externalTotal: number
  /** Completed ECTS. The planner never marks anything completed, so this stays 0. */
  completed: number
  unknownCredits: string[] // module IDs whose credits are not a single number
}

const zeroSubjects = () => Object.fromEntries(SUBJECT_ORDER.map((s) => [s, 0])) as Record<Subject, number>

/** Counts planned credits; external courses only count if their registration was not rejected. */
export function externalCounts(x: ExternalCourse): boolean {
  return x.registration !== 'rejected' && Number.isFinite(x.ects) && x.ects > 0
}

/** Each planned module or external course is counted exactly once, in its assigned subject. */
export function ectsSummary(plan: PlanEntry[], byId: Map<string, Module>, externals: ExternalCourse[] = []): EctsSummary {
  const bySubject = zeroSubjects()
  const unverifiedBySubject = zeroSubjects()
  let total = 0
  let unassigned = 0
  let pendingRecognition = 0
  let externalTotal = 0
  const unknownCredits: string[] = []
  for (const e of plan) {
    const m = byId.get(e.moduleId)
    if (!m) continue
    const v = m.credits.value
    if (v === null) {
      unknownCredits.push(m.id)
      continue
    }
    total += v
    if (e.category) bySubject[e.category] += v
    else unassigned += v
  }
  for (const x of externals) {
    if (!externalCounts(x)) continue
    total += x.ects
    externalTotal += x.ects
    if (x.recognition === 'pending') pendingRecognition += x.ects
    if (x.category) {
      bySubject[x.category] += x.ects
      if (x.recognition !== 'confirmed') unverifiedBySubject[x.category] += x.ects
    } else unassigned += x.ects
  }
  return { total, bySubject, unverifiedBySubject, unassigned, pendingRecognition, externalTotal, completed: 0, unknownCredits }
}

// ------------------------------------------------------------------ schedule

export const toMinutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

export function slotValid(s: TimeSlot): boolean {
  const a = toMinutes(s.start)
  const b = toMinutes(s.end)
  return !Number.isNaN(a) && !Number.isNaN(b) && b > a
}

export interface Conflict {
  a: { moduleId: string; slot: TimeSlot }
  b: { moduleId: string; slot: TimeSlot }
}

/** Overlaps between manually entered time slots only. Touching slots (10:00–11:30 / 11:30–13:00) do not conflict. */
/** Anything with manually entered times: a plan entry, or an external course mapped via scheduleItems(). */
export type Scheduled = Pick<PlanEntry, 'moduleId' | 'times'>

export function scheduleItems(plan: PlanEntry[], externals: ExternalCourse[] = []): Scheduled[] {
  return [...plan, ...externals.filter((x) => x.registration !== 'rejected').map((x) => ({ moduleId: x.id, times: x.times }))]
}

export function findConflicts(plan: Scheduled[]): Conflict[] {
  const slots = plan.flatMap((e) => e.times.filter(slotValid).map((slot) => ({ moduleId: e.moduleId, slot })))
  const out: Conflict[] = []
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++) {
      const x = slots[i]
      const y = slots[j]
      if (x.slot.day !== y.slot.day) continue
      if (toMinutes(x.slot.start) < toMinutes(y.slot.end) && toMinutes(y.slot.start) < toMinutes(x.slot.end))
        out.push({ a: x, b: y })
    }
  return out
}

export type ScheduleStatus =
  | { kind: 'empty' }
  | { kind: 'conflicts'; conflicts: Conflict[]; unverified: string[] }
  | { kind: 'unverified'; unverified: string[] }
  | { kind: 'clear' }

export function scheduleStatus(plan: Scheduled[]): ScheduleStatus {
  if (!plan.length) return { kind: 'empty' }
  const conflicts = findConflicts(plan)
  const unverified = plan.filter((e) => !e.times.some(slotValid)).map((e) => e.moduleId)
  if (conflicts.length) return { kind: 'conflicts', conflicts, unverified }
  if (unverified.length) return { kind: 'unverified', unverified }
  return { kind: 'clear' }
}

// ------------------------------------------------------------------ persistence / import / export

export const STORAGE_KEY = 'cds-study-planner/v1'

function sanitizeTimes(xs: unknown, owner: string): TimeSlot[] {
  if (!Array.isArray(xs)) return []
  return xs
    .filter((t) => t && typeof t.start === 'string' && typeof t.end === 'string')
    .map((t, i) => ({
      id: typeof t.id === 'string' ? t.id : `t${i}-${owner}`,
      day: (DAYS.includes(t.day) ? t.day : 'Mon') as Day,
      start: t.start,
      end: t.end,
      label: typeof t.label === 'string' ? t.label : undefined,
    }))
}

const REG: RegistrationStatus[] = ['planned', 'applied', 'waitlisted', 'accepted', 'rejected']
const REC: RecognitionStatus[] = ['pending', 'confirmed', 'rejected']
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function sanitizeExternal(raw: unknown): ExternalCourse | null {
  const x = (raw ?? {}) as Partial<ExternalCourse>
  const title = str(x.title).trim()
  const ects = Number(x.ects)
  if (!title || !Number.isFinite(ects) || ects < 0) return null
  const id = str(x.id) || `ext-${str(x.courseNumber) || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return {
    id: id.startsWith('ext-') ? id : `ext-${id}`,
    title,
    courseNumber: str(x.courseNumber),
    ects,
    category: SUBJECT_ORDER.includes(x.category as Subject) ? (x.category as Subject) : null,
    provider: str(x.provider),
    room: str(x.room),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(str(x.startDate)) ? str(x.startDate) : '',
    times: sanitizeTimes(x.times, id),
    registration: REG.includes(x.registration as RegistrationStatus) ? (x.registration as RegistrationStatus) : 'planned',
    recognition: REC.includes(x.recognition as RecognitionStatus) ? (x.recognition as RecognitionStatus) : 'pending',
    completed: false, // the planner never records completed credits
    note: str(x.note),
    addedAt: typeof x.addedAt === 'number' ? x.addedAt : 0,
  }
}

function sanitizeTimetable(raw: unknown): TimetablePrefs {
  const t = (raw ?? {}) as Partial<TimetablePrefs>
  const strings = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : [])
  const groupChoice: Record<string, string> = {}
  if (t.groupChoice && typeof t.groupChoice === 'object')
    for (const [k, v] of Object.entries(t.groupChoice)) if (typeof v === 'string') groupChoice[k] = v
  const imported = Array.isArray(t.imported)
    ? t.imported.filter((e): e is CampusEvent => !!e && typeof e.eventNumber === 'string' && Array.isArray(e.appointments))
    : []
  return { hidden: strings(t.hidden), groupChoice, imported, acceptedImports: strings(t.acceptedImports) }
}

export function sanitizeState(raw: unknown, knownIds?: Set<string>): AppState {
  const r = (raw ?? {}) as Partial<AppState>
  const ids = (xs: unknown) =>
    Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === 'string' && (!knownIds || knownIds.has(x))))] : []
  const seen = new Set<string>()
  const plan: PlanEntry[] = []
  for (const e of Array.isArray(r.plan) ? r.plan : []) {
    if (!e || typeof e.moduleId !== 'string' || seen.has(e.moduleId)) continue
    if (knownIds && !knownIds.has(e.moduleId)) continue
    seen.add(e.moduleId)
    plan.push({
      moduleId: e.moduleId,
      category: SUBJECT_ORDER.includes(e.category as Subject) ? (e.category as Subject) : null,
      note: typeof e.note === 'string' ? e.note : '',
      times: sanitizeTimes(e.times, e.moduleId),
      addedAt: typeof e.addedAt === 'number' ? e.addedAt : 0,
    })
  }
  const externals: ExternalCourse[] = []
  for (const raw of Array.isArray(r.externals) ? r.externals : []) {
    const x = sanitizeExternal(raw)
    if (x && !externals.some((y) => y.id === x.id)) externals.push(x)
  }
  const s = (r.settings ?? {}) as Partial<Settings>
  return {
    version: 1,
    plan,
    externals,
    timetable: sanitizeTimetable(r.timetable),
    planNotes: typeof r.planNotes === 'string' ? r.planNotes : '',
    saved: ids(r.saved),
    compare: ids(r.compare).slice(0, MAX_COMPARE),
    settings: {
      semester: 'WS 2026/27',
      preferredLanguage: s.preferredLanguage === 'ANY' ? 'ANY' : 'EN',
      seeProfile: typeof s.seeProfile === 'string' ? s.seeProfile : null,
      eeFocus: typeof s.eeFocus === 'string' ? s.eeFocus : null,
      specialization: s.specialization === 'MATH' || s.specialization === 'CS' || s.specialization === 'SEE' ? s.specialization : null,
      targetEcts: typeof s.targetEcts === 'number' && s.targetEcts > 0 ? s.targetEcts : null,
    },
  }
}

/**
 * Additive import: adds plan entries and external courses that are not present yet.
 * Existing entries, notes, saved modules, comparison and settings are left untouched.
 */
export function mergeState(current: AppState, incoming: AppState): { state: AppState; added: string[] } {
  const added: string[] = []
  const plan = [...current.plan]
  for (const e of incoming.plan)
    if (!plan.some((p) => p.moduleId === e.moduleId)) {
      plan.push(e)
      added.push(e.moduleId)
    }
  const externals = [...current.externals]
  for (const x of incoming.externals)
    if (!externals.some((y) => y.id === x.id)) {
      externals.push(x)
      added.push(x.title)
    }
  return { state: { ...current, plan, externals }, added }
}

export function addExternal(state: AppState, x: ExternalCourse): AppState {
  if (state.externals.some((y) => y.id === x.id)) return state
  return { ...state, externals: [...state.externals, x] }
}

export function exportPlan(state: AppState) {
  return JSON.stringify(
    { app: 'CDS Study Planner', exportedFor: 'WS 2026/27', handbookDate: '2026-10-20', ...state },
    null,
    2,
  )
}
