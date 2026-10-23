/**
 * iCalendar (.ics) import for schedules exported by the student (e.g. from their own KIT Campus
 * timetable or any calendar). Matching to handbook modules uses KIT event numbers first and exact
 * titles second; anything else is reported, never guessed.
 */
import type { Day } from './planner'
import { addDays, weekdayOf, type Appointment, type CampusEvent } from './timetable'

interface RawEvent {
  uid?: string
  summary: string
  description: string
  location?: string
  dtstart?: { date: string; time?: string }
  dtend?: { date: string; time?: string }
  rrule?: Record<string, string>
  exdates: string[]
  status?: string
  recurrenceId?: string
}

export interface IcsImportResult {
  events: CampusEvent[]
  matched: { eventNumber: string; title: string; method: 'event-number' | 'exact-title'; appointments: number }[]
  ambiguous: { summary: string; candidates: string[] }[]
  unmatched: string[]
  skipped: string[]
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/** Local wall-clock date/time. UTC values ("Z") are converted to Europe/Berlin. */
function parseDateTime(value: string): { date: string; time?: string } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return undefined
  const [, y, mo, d, h, mi, , z] = m
  if (!h) return { date: `${y}-${mo}-${d}` }
  if (!z) return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(dt).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` }
}

export function parseIcs(text: string): RawEvent[] {
  const out: RawEvent[] = []
  let cur: RawEvent | null = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = { summary: '', description: '', exdates: [] }
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur) out.push(cur)
      cur = null
      continue
    }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const [name] = line.slice(0, idx).split(';')
    const value = line.slice(idx + 1)
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value; break
      case 'SUMMARY': cur.summary = unescape(value).trim(); break
      case 'DESCRIPTION': cur.description = unescape(value); break
      case 'LOCATION': cur.location = unescape(value).trim(); break
      case 'DTSTART': cur.dtstart = parseDateTime(value); break
      case 'DTEND': cur.dtend = parseDateTime(value); break
      case 'STATUS': cur.status = value.trim().toUpperCase(); break
      case 'RECURRENCE-ID': cur.recurrenceId = parseDateTime(value)?.date; break
      case 'EXDATE':
        value.split(',').forEach((v) => {
          const d = parseDateTime(v)
          if (d) cur!.exdates.push(d.date)
        })
        break
      case 'RRULE':
        cur.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=') as [string, string]))
        break
    }
  }
  return out
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Turn raw VEVENTs into appointments (weekly series, single dates, cancellations, moved occurrences). */
function toAppointments(raws: RawEvent[], key: string): Appointment[] {
  const out: Appointment[] = []
  const moved: RawEvent[] = []
  const singles: Appointment[] = []
  raws.forEach((r, i) => {
    if (!r.dtstart?.time || !r.dtend?.time) return // all-day entries carry no class time
    if (r.recurrenceId) return moved.push(r)
    const base = { start: r.dtstart.time, end: r.dtend.time, room: r.location, status: (r.status === 'CANCELLED' ? 'cancelled' : 'scheduled') as Appointment['status'] }
    if (r.rrule && r.rrule.FREQ === 'WEEKLY') {
      const interval = Number(r.rrule.INTERVAL ?? 1)
      const until = r.rrule.UNTIL ? parseDateTime(r.rrule.UNTIL)?.date : undefined
      const count = r.rrule.COUNT ? Number(r.rrule.COUNT) : undefined
      out.push({
        id: `${key}-w${i}`, kind: 'weekly', day: weekdayOf(r.dtstart.date) as Day, startDate: r.dtstart.date,
        endDate: until ?? (count ? addDays(r.dtstart.date, (count - 1) * 7 * interval) : undefined),
        sessions: count, exceptions: r.exdates.length ? r.exdates : undefined, ...base,
        ...(interval !== 1 ? { note: `every ${interval} weeks` } : {}),
      })
    } else {
      singles.push({ id: `${key}-s${i}`, kind: 'single', date: r.dtstart.date, ...base })
    }
  })
  // occurrences that were moved: the original date becomes an exception, the new date a single appointment
  for (const r of moved) {
    for (const a of out) if (a.kind === 'weekly' && a.day === weekdayOf(r.recurrenceId!)) a.exceptions = [...(a.exceptions ?? []), r.recurrenceId!]
    if (r.status !== 'CANCELLED' && r.dtstart?.time && r.dtend?.time)
      singles.push({ id: `${key}-m${singles.length}`, kind: 'single', date: r.dtstart.date, start: r.dtstart.time, end: r.dtend.time, room: r.location, status: 'moved', note: `moved from ${r.recurrenceId}` })
  }
  // calendars that list every occurrence separately: collapse identical weekday/time/room series
  const groups = new Map<string, Appointment[]>()
  for (const s of singles) {
    if (s.status !== 'scheduled') continue
    const k = `${weekdayOf(s.date!)}|${s.start}|${s.end}|${s.room ?? ''}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const collapsed = new Set<Appointment>()
  for (const g of groups.values()) {
    if (g.length < 3) continue
    const dates = g.map((x) => x.date!).sort()
    const exceptions: string[] = []
    for (let d = dates[0]; d < dates[dates.length - 1]; d = addDays(d, 7)) if (!dates.includes(d)) exceptions.push(d)
    if (exceptions.length > dates.length) continue // too irregular to call it a weekly series
    out.push({
      id: `${key}-c${out.length}`, kind: 'weekly', day: weekdayOf(dates[0]) as Day, start: g[0].start, end: g[0].end,
      startDate: dates[0], endDate: dates[dates.length - 1], sessions: dates.length, room: g[0].room, status: 'scheduled',
      exceptions: exceptions.length ? exceptions : undefined,
    })
    g.forEach((x) => collapsed.add(x))
  }
  out.push(...singles.filter((s) => !collapsed.has(s)))
  return out
}

/**
 * Match imported calendar entries to known KIT events (from the handbook mapping).
 * 1. a known event number in SUMMARY/DESCRIPTION/UID → exact
 * 2. SUMMARY equal to exactly one known event title → exact-title (flagged in the result)
 */
export function importIcs(text: string, known: CampusEvent[], importedAt = new Date().toISOString().slice(0, 10)): IcsImportResult {
  const raws = parseIcs(text)
  const byNumber = new Map(known.map((e) => [e.eventNumber, e]))
  const byTitle = new Map<string, CampusEvent[]>()
  for (const e of known) byTitle.set(norm(e.title), [...(byTitle.get(norm(e.title)) ?? []), e])

  const res: IcsImportResult = { events: [], matched: [], ambiguous: [], unmatched: [], skipped: [] }
  const buckets = new Map<string, { ev: CampusEvent; method: 'event-number' | 'exact-title'; raws: RawEvent[] }>()
  for (const r of raws) {
    if (!r.summary) continue
    const hay = `${r.summary} ${r.description} ${r.uid ?? ''}`
    const nums = [...new Set(hay.match(/\b\d{4,8}\b/g) ?? [])].filter((n) => byNumber.has(n))
    let ev: CampusEvent | undefined
    let method: 'event-number' | 'exact-title' = 'event-number'
    if (nums.length === 1) ev = byNumber.get(nums[0])
    else if (nums.length > 1) {
      res.ambiguous.push({ summary: r.summary, candidates: nums })
      continue
    } else {
      const title = norm(r.summary.replace(/^\s*\d{4,8}\s*[-–:]?\s*/, ''))
      const c = byTitle.get(title) ?? []
      if (c.length === 1) {
        ev = c[0]
        method = 'exact-title'
      } else if (c.length > 1) {
        res.ambiguous.push({ summary: r.summary, candidates: c.map((x) => x.eventNumber) })
        continue
      }
    }
    if (!ev) {
      if (!res.unmatched.includes(r.summary)) res.unmatched.push(r.summary)
      continue
    }
    const b = buckets.get(ev.eventNumber) ?? { ev, method, raws: [] }
    b.raws.push(r)
    buckets.set(ev.eventNumber, b)
  }
  for (const { ev, method, raws: rs } of buckets.values()) {
    const appointments = toAppointments(rs, `ics-${ev.eventNumber}`)
    if (!appointments.length) {
      res.skipped.push(`${ev.title}: no timed entries`)
      continue
    }
    res.events.push({
      ...ev,
      appointments,
      groups: [],
      scheduleStatus: 'imported',
      source: 'ics-import',
      verifiedAt: importedAt,
      verifiedBy: `calendar file import (${method === 'event-number' ? 'matched by event number' : 'matched by exact title — please review'})`,
      notes: [...ev.notes.filter((n) => !n.startsWith('Imported')), `Imported from calendar file on ${importedAt}.`],
    })
    res.matched.push({ eventNumber: ev.eventNumber, title: ev.title, method, appointments: appointments.length })
  }
  return res
}
