/**
 * Timetable model: KIT Campus event appointments (verified manually or imported by the student),
 * manually entered module times and external courses, expanded into concrete intervals for
 * conflict detection. Nothing here invents dates or times; missing data stays "not verified".
 */
import campusData from '../data/campus-events.json'
import { DAYS, EMPTY_TIMETABLE, slotValid, toMinutes, type AppState, type Day, type ExternalCourse, type PlanEntry, type TimetablePrefs } from './planner'
import type { Module, Subject } from './types'

// ------------------------------------------------------------------ types

export type ApptStatus = 'scheduled' | 'cancelled' | 'moved'

export interface Appointment {
  id: string
  kind: 'weekly' | 'single'
  day?: Day
  date?: string // YYYY-MM-DD, for single appointments
  start: string
  end: string
  startDate?: string
  endDate?: string
  sessions?: number
  /** Dates on which a weekly appointment does not take place (cancelled / moved). */
  exceptions?: string[]
  room?: string
  building?: string
  type?: string
  status: ApptStatus
  note?: string
}

export interface EventGroup {
  id: string
  label: string
  appointments: Appointment[]
}

export type EventSource = 'handbook' | 'manual' | 'ics-import' | 'campus-sync'

export interface CampusEvent {
  eventNumber: string
  gguid: string | null
  url: string | null
  title: string
  types: string[]
  typeLabel?: string
  mode?: string | null
  lecturers: string | null
  department: string | null
  semester: string
  language: { value: string | null; source: string | null }
  moduleIds: string[]
  componentIds: string[]
  appointments: Appointment[]
  groups: EventGroup[]
  scheduleStatus: 'verified' | 'imported' | 'unavailable'
  source: EventSource
  verifiedAt: string | null
  verifiedBy: string | null
  notes: string[]
  exam?: { number: string; type: string; registered: boolean }
}

export interface CampusMeta {
  source: string
  semester: string
  lastSyncAttempt: string | null
  lastSyncStatus: string
  lastSyncMessage: string | null
  lastSuccessfulSync: string | null
  verifiedEvents: number
  events: number
  manualRecordsFile: string
}

export { EMPTY_TIMETABLE, type TimetablePrefs }

const base = campusData as unknown as {
  meta: CampusMeta
  events: CampusEvent[]
  externalCourses: Partial<ExternalCourse>[]
}
export const CAMPUS_META = base.meta
export const BASE_EVENTS = base.events
export const VERIFIED_EXTERNALS = base.externalCourses

// ------------------------------------------------------------------ effective events

export interface EffectiveEvents {
  byNumber: Map<string, CampusEvent>
  byModule: Map<string, CampusEvent[]>
  /** Imports that differ from a manually verified record and wait for the student's decision. */
  review: { manual: CampusEvent; imported: CampusEvent }[]
}

/**
 * Base data (handbook mapping + manually verified records) overlaid with the student's imports.
 * Manually verified schedules are never replaced silently by an import.
 */
export function effectiveEvents(prefs: TimetablePrefs = EMPTY_TIMETABLE, baseEvents: CampusEvent[] = BASE_EVENTS): EffectiveEvents {
  const byNumber = new Map(baseEvents.map((e) => [e.eventNumber, e]))
  const review: EffectiveEvents['review'] = []
  for (const imp of prefs.imported) {
    const cur = byNumber.get(imp.eventNumber)
    if (cur && cur.scheduleStatus === 'verified' && cur.source === 'manual' && !prefs.acceptedImports.includes(imp.eventNumber)) {
      if (!sameAppointments(cur.appointments, imp.appointments)) review.push({ manual: cur, imported: imp })
      continue
    }
    if (!imp.appointments.length && cur?.appointments.length) continue // never replace data with empty appointments
    byNumber.set(imp.eventNumber, cur ? { ...cur, ...imp, moduleIds: [...new Set([...cur.moduleIds, ...imp.moduleIds])] } : imp)
  }
  const byModule = new Map<string, CampusEvent[]>()
  for (const e of byNumber.values())
    for (const m of e.moduleIds) byModule.set(m, [...(byModule.get(m) ?? []), e])
  return { byNumber, byModule, review }
}

function sameAppointments(a: Appointment[], b: Appointment[]) {
  const key = (x: Appointment) => `${x.kind}|${x.day ?? ''}|${x.date ?? ''}|${x.start}|${x.end}`
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort())
}

export function hasSchedule(e: CampusEvent) {
  return e.appointments.length > 0 || e.groups.some((g) => g.appointments.length > 0)
}

// ------------------------------------------------------------------ timetable items

export type ItemCategory = 'lecture' | 'tutorial' | 'lab' | 'other'
export type ItemSource = 'campus-verified' | 'campus-imported' | 'manual' | 'external'

export interface TItem {
  key: string // unique; for manual/external slots equals the TimeSlot id
  ownerId: string // module ID or external course ID
  ownerName: string
  ownerKind: 'module' | 'external'
  subject: Subject | null
  eventNumber?: string
  eventTitle: string
  category: ItemCategory
  groupLabel?: string
  appt: Appointment
  source: ItemSource
  url?: string | null
}

export function categoryOf(types: string[], label?: string): ItemCategory {
  const t = `${types.join(' ')} ${label ?? ''}`.toLowerCase()
  if (t.includes('lecture')) return 'lecture'
  if (t.includes('practical course') || t.includes('lab')) return 'lab'
  if (t.includes('practice') || t.includes('tutorial') || t.includes('exercise')) return 'tutorial'
  return 'other'
}

function campusItems(ownerId: string, ownerName: string, subject: Subject | null, events: CampusEvent[], prefs: TimetablePrefs): TItem[] {
  const out: TItem[] = []
  for (const e of events) {
    const src: ItemSource = e.source === 'manual' || e.scheduleStatus === 'verified' ? 'campus-verified' : 'campus-imported'
    const push = (a: Appointment, groupLabel?: string) =>
      out.push({
        key: `${ownerId}|${e.eventNumber}|${a.id}`,
        ownerId, ownerName, ownerKind: 'module', subject,
        eventNumber: e.eventNumber, eventTitle: e.title,
        category: a.type ? categoryOf([a.type]) : categoryOf(e.types, e.typeLabel),
        groupLabel, appt: a, source: src, url: e.url,
      })
    e.appointments.forEach((a) => push(a))
    if (e.groups.length) {
      const chosen = e.groups.find((g) => g.id === prefs.groupChoice[e.eventNumber])
      if (chosen) chosen.appointments.forEach((a) => push({ ...a, type: a.type ?? 'Tutorial' }, chosen.label))
    }
  }
  return out
}

const manualAppt = (t: { id: string; day: Day; start: string; end: string; label?: string }, startDate?: string): Appointment => ({
  id: t.id, kind: 'weekly', day: t.day, start: t.start, end: t.end, room: t.label || undefined, status: 'scheduled',
  ...(startDate ? { startDate } : {}),
})

function sameSlot(a: Appointment, b: Appointment) {
  return a.kind === 'weekly' && b.kind === 'weekly' && a.day === b.day && a.start === b.start && a.end === b.end
}

export interface Timetable {
  items: TItem[]
  /** Planned owners for which no appointment at all is known. */
  unverified: string[]
  events: EffectiveEvents
}

/** Everything in the current WS 2026/27 plan that has times: campus appointments, manual times, external courses. */
export function buildTimetable(
  state: Pick<AppState, 'plan' | 'externals'> & { timetable?: TimetablePrefs },
  moduleById: Map<string, Module>,
  ev: EffectiveEvents = effectiveEvents(state.timetable),
): Timetable {
  const prefs = state.timetable ?? EMPTY_TIMETABLE
  const items: TItem[] = []
  const unverified: string[] = []
  for (const e of state.plan) {
    const name = moduleById.get(e.moduleId)?.name ?? e.moduleId
    const camp = campusItems(e.moduleId, name, e.category, ev.byModule.get(e.moduleId) ?? [], prefs)
    const manual = e.times.filter(slotValid).map((t) => manualAppt(t))
      .filter((a) => !camp.some((c) => sameSlot(c.appt, a))) // identical to a campus slot: show once
      .map<TItem>((a) => ({
        key: a.id, ownerId: e.moduleId, ownerName: name, ownerKind: 'module', subject: e.category,
        eventTitle: name, category: 'other', appt: a, source: 'manual',
      }))
    if (!camp.length && !manual.length) unverified.push(e.moduleId)
    items.push(...camp, ...manual)
  }
  for (const x of state.externals) {
    if (x.registration === 'rejected') continue
    const slots = x.times.filter(slotValid)
    if (!slots.length) unverified.push(x.id)
    for (const t of slots)
      items.push({
        key: t.id, ownerId: x.id, ownerName: x.title, ownerKind: 'external', subject: x.category,
        eventTitle: x.title, category: 'other', appt: manualAppt(t, x.startDate || undefined), source: 'external',
      })
  }
  return { items, unverified, events: ev }
}

/** Items of a single module as if it were planned (Explorer / module page). */
export function moduleItems(m: Module, ev: EffectiveEvents, prefs: TimetablePrefs, entry?: PlanEntry): TItem[] {
  const tt = buildTimetable({ plan: [entry ?? { moduleId: m.id, category: null, note: '', times: [], addedAt: 0 }], externals: [], timetable: prefs }, new Map([[m.id, m]]), ev)
  return tt.items
}

// ------------------------------------------------------------------ dates

export const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => fmtDate(new Date(parseDate(s).getTime() + n * 86400000))
export const weekdayOf = (s: string): Day | 'Sun' => (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const)[parseDate(s).getUTCDay()]
export const mondayOf = (s: string) => {
  const wd = parseDate(s).getUTCDay()
  return addDays(s, wd === 0 ? -6 : 1 - wd)
}

/** Last date of a weekly appointment if it can be derived without guessing (explicit end date only). */
export function weeklyEnd(a: Appointment): string | null {
  return a.endDate ?? null
}

/** Does this appointment take place on this date? Unknown ranges are treated as "possibly" (true). */
export function occursOn(a: Appointment, date: string): boolean {
  if (a.status === 'cancelled') return false
  if (a.kind === 'single') return a.date === date
  if (weekdayOf(date) !== a.day) return false
  if (a.startDate && date < a.startDate) return false
  const end = weeklyEnd(a)
  if (end && date > end) return false
  if (a.exceptions?.includes(date)) return false
  return true
}

// ------------------------------------------------------------------ conflicts

export interface TConflict {
  a: TItem
  b: TItem
  day: Day
  overlapStart: string
  overlapEnd: string
  /** true: overlaps every week both run; false: only on the listed dates */
  recurring: boolean
  dates: string[]
  /** From/until when a recurring overlap applies, if known */
  from?: string
  until?: string
  alternatives: string[]
}

const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function timeOverlap(a: Appointment, b: Appointment): [number, number] | null {
  const s = Math.max(toMinutes(a.start), toMinutes(b.start))
  const e = Math.min(toMinutes(a.end), toMinutes(b.end))
  return s < e ? [s, e] : null
}

const maxDate = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b)
const minDate = (a?: string | null, b?: string | null) => (!a ? b ?? undefined : !b ? a : a < b ? a : b)

/**
 * Compares concrete appointment intervals. Touching intervals (11:15 / 11:15) do not conflict.
 * Items of the same event and group never conflict with each other. Cancelled appointments are ignored.
 */
export function detectConflicts(items: TItem[], ev?: EffectiveEvents): TConflict[] {
  const live = items.filter((i) => i.appt.status !== 'cancelled' && toMinutes(i.appt.start) < toMinutes(i.appt.end))
  const out: TConflict[] = []
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (a.ownerId === b.ownerId && a.eventNumber && a.eventNumber === b.eventNumber && a.groupLabel === b.groupLabel) continue
      const ov = timeOverlap(a.appt, b.appt)
      if (!ov) continue
      const alternatives = alternativesFor(a, b, ev)
      const base = { a, b, overlapStart: minToHHMM(ov[0]), overlapEnd: minToHHMM(ov[1]), alternatives }
      const A = a.appt
      const B = b.appt
      if (A.kind === 'weekly' && B.kind === 'weekly') {
        if (A.day !== B.day) continue
        const from = maxDate(A.startDate, B.startDate)
        const until = minDate(weeklyEnd(A), weeklyEnd(B))
        if (from && until && from > until) continue // the two series never run at the same time
        out.push({ ...base, day: A.day!, recurring: true, dates: [], from, until })
      } else if (A.kind === 'single' && B.kind === 'single') {
        if (A.date && A.date === B.date) out.push({ ...base, day: weekdayOf(A.date) as Day, recurring: false, dates: [A.date] })
      } else {
        const single = A.kind === 'single' ? A : B
        const weekly = A.kind === 'single' ? B : A
        if (single.date && occursOn(weekly, single.date))
          out.push({ ...base, day: weekdayOf(single.date) as Day, recurring: false, dates: [single.date] })
      }
    }
  return out
}

function alternativesFor(a: TItem, b: TItem, ev?: EffectiveEvents): string[] {
  if (!ev) return []
  const out: string[] = []
  for (const it of [a, b]) {
    if (!it.groupLabel || !it.eventNumber) continue
    const e = ev.byNumber.get(it.eventNumber)
    e?.groups.filter((g) => g.label !== it.groupLabel).forEach((g) =>
      out.push(`${e.title}: ${g.label} (${g.appointments.map(fmtAppt).join(', ')})`))
  }
  return out
}

export function fmtAppt(a: Appointment): string {
  const when = a.kind === 'weekly' ? `${a.day} ${a.start}–${a.end}` : `${a.date} ${a.start}–${a.end}`
  return a.status === 'cancelled' ? `${when} (cancelled)` : when
}

// ------------------------------------------------------------------ explorer helpers

export type TimeOfDay = 'morning' | 'midday' | 'afternoon' | 'evening'
export const TIME_OF_DAY: Record<TimeOfDay, [number, number, string]> = {
  morning: [0, 12 * 60, 'Morning (before 12:00)'],
  midday: [12 * 60, 14 * 60, 'Midday (12:00–14:00)'],
  afternoon: [14 * 60, 17 * 60, 'Afternoon (14:00–17:00)'],
  evening: [17 * 60, 24 * 60, 'Evening (from 17:00)'],
}
export const timeOfDay = (start: string): TimeOfDay => {
  const m = toMinutes(start)
  return (Object.keys(TIME_OF_DAY) as TimeOfDay[]).find((k) => m >= TIME_OF_DAY[k][0] && m < TIME_OF_DAY[k][1]) ?? 'evening'
}

export const WEEKDAYS: Day[] = DAYS.filter((d) => d !== 'Sat')
