import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { SUBJECT_LABEL, SUBJECT_ORDER } from '../lib/domain'
import {
  DAYS,
  RECOGNITION_LABEL,
  REGISTRATION_LABEL,
  sanitizeExternal,
  slotValid,
  type Day,
  type ExternalCourse,
  type RecognitionStatus,
  type RegistrationStatus,
} from '../lib/planner'
import type { Check } from '../lib/rules'
import type { Subject } from '../lib/types'
import { useStore } from '../state/store'
import { TimesEditor, newSlot } from './TimesEditor'
import { Badge, Button, Card, StatusBadge, cx } from './ui'

const input = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-accent-500 focus:outline-none'

/** A manually entered course outside the Module Handbook. */
export function ExternalCard({ x, checks, conflictSlotIds }: { x: ExternalCourse; checks: Check[]; conflictSlotIds: Set<string> }) {
  const store = useStore()
  const up = (p: Partial<ExternalCourse>) => store.updateExternal(x.id, p)
  const rejected = x.registration === 'rejected'

  return (
    <Card className={cx('border-dashed p-4', rejected && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{x.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {x.courseNumber && <span className="font-mono">Course {x.courseNumber}</span>}
            <Badge tone="violet" title="Entered manually — not part of the Module Handbook">External course</Badge>
            <Badge tone={x.registration === 'accepted' ? 'accent' : rejected ? 'red' : 'slate'}>{REGISTRATION_LABEL[x.registration]}</Badge>
            <Badge tone={x.recognition === 'confirmed' ? 'accent' : x.recognition === 'rejected' ? 'red' : 'amber'}>
              {x.recognition === 'pending' ? 'Recognition pending' : x.recognition === 'confirmed' ? 'Recognised' : 'Not recognised'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cx('text-sm font-semibold', rejected && 'line-through')}>{x.ects} ECTS</span>
          <Button size="sm" variant="ghost" onClick={() => confirm(`Remove "${x.title}" from your plan?`) && store.removeExternal(x.id)} aria-label={`Remove ${x.title}`}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {rejected
          ? 'Not counted in planned ECTS.'
          : `Counted in planned ECTS. Not completed${x.recognition !== 'confirmed' ? ' and not yet recognised for the degree' : ''}.`}
      </p>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Counts towards</span>
          <select value={x.category ?? ''} onChange={(e) => up({ category: (e.target.value || null) as Subject | null })} className={cx(input, !x.category && 'border-amber-400')}>
            <option value="">— choose one subject —</option>
            {SUBJECT_ORDER.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Registration</span>
          <select value={x.registration} onChange={(e) => up({ registration: e.target.value as RegistrationStatus })} className={input}>
            {Object.entries(REGISTRATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Credit recognition</span>
          <select value={x.recognition} onChange={(e) => up({ recognition: e.target.value as RecognitionStatus })} className={input}>
            {Object.entries(RECOGNITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v.replace('Credit recognition ', '')}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {x.provider && <span>Provider: {x.provider}</span>}
        {x.room && <span>Room: {x.room}</span>}
        {x.startDate && <span>Starts: {x.startDate}</span>}
      </div>

      {checks.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              <StatusBadge status={c.status} />
              <span className="text-slate-600">
                {c.title.replace(`${x.title}: `, '')}
                <span className="block text-slate-400">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">
            Course times {x.times.some(slotValid) ? '' : <Badge tone="amber">Schedule not verified</Badge>}
          </span>
          <Button size="sm" variant="ghost" onClick={() => up({ times: [...x.times, newSlot(x.id)] })}><Plus size={13} /> Add time</Button>
        </div>
        <TimesEditor times={x.times} onChange={(times) => up({ times })} conflictSlotIds={conflictSlotIds} />
        <textarea
          value={x.note}
          onChange={(e) => up({ note: e.target.value })}
          rows={2}
          placeholder="Personal note"
          className="mt-2 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-accent-500 focus:outline-none"
          aria-label="Note"
        />
      </div>
    </Card>
  )
}

/** Form for adding a course that is not in the Module Handbook (e.g. a Language Center course). */
export function AddExternalForm({ onDone }: { onDone: () => void }) {
  const store = useStore()
  const [f, setF] = useState({
    title: '', courseNumber: '', ects: '', category: 'IQ', provider: '', room: '', startDate: '',
    days: [] as Day[], start: '', end: '', registration: 'planned' as RegistrationStatus,
  })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const id = `ext-${f.courseNumber.trim() || Date.now()}`
    if (store.state.externals.some((x) => x.id === id)) return setErr('A course with this course number is already in your plan.')
    const label = [f.room.trim(), f.startDate && `from ${f.startDate}`].filter(Boolean).join(', ')
    const x = sanitizeExternal({
      id, title: f.title, courseNumber: f.courseNumber.trim(), ects: Number(f.ects), category: f.category || null,
      provider: f.provider, room: f.room, startDate: f.startDate, registration: f.registration, recognition: 'pending',
      times: f.start && f.end ? f.days.map((d) => newSlot(id, d, f.start, f.end, label)) : [],
      note: '', addedAt: Date.now(),
    })
    if (!x) return setErr('Enter a title and a valid ECTS value.')
    store.addExternal(x)
    onDone()
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div>
          <h2 className="font-semibold text-slate-900">Add external course</h2>
          <p className="text-xs text-slate-500">For courses outside the Module Handbook, such as Language Center (SPZ), HoC or FORUM courses. All details are your own entries.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Title *"><input required value={f.title} onChange={(e) => set('title', e.target.value)} className={cx(input, 'w-full')} /></Field>
          <Field label="Course number"><input value={f.courseNumber} onChange={(e) => set('courseNumber', e.target.value)} className={cx(input, 'w-full')} /></Field>
          <Field label="ECTS *"><input required type="number" min={0} step={0.5} value={f.ects} onChange={(e) => set('ects', e.target.value)} className={cx(input, 'w-full')} /></Field>
          <Field label="Counts towards">
            <select value={f.category} onChange={(e) => set('category', e.target.value)} className={cx(input, 'w-full')}>
              <option value="">— choose later —</option>
              {SUBJECT_ORDER.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Provider"><input value={f.provider} onChange={(e) => set('provider', e.target.value)} placeholder="e.g. Language Center (SPZ)" className={cx(input, 'w-full')} /></Field>
          <Field label="Room"><input value={f.room} onChange={(e) => set('room', e.target.value)} className={cx(input, 'w-full')} /></Field>
          <Field label="Start date"><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} className={cx(input, 'w-full')} /></Field>
          <Field label="Registration">
            <select value={f.registration} onChange={(e) => set('registration', e.target.value)} className={cx(input, 'w-full')}>
              {Object.entries(REGISTRATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="text-xs text-slate-500">Weekly times (optional)</legend>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" checked={f.days.includes(d)} onChange={() => set('days', f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d])} /> {d}
              </label>
            ))}
            <input type="time" value={f.start} onChange={(e) => set('start', e.target.value)} className={input} aria-label="Start time" />
            <span className="text-slate-400">–</span>
            <input type="time" value={f.end} onChange={(e) => set('end', e.target.value)} className={input} aria-label="End time" />
          </div>
        </fieldset>
        <p className="text-xs text-slate-500">Credit recognition starts as “pending verification”; the course is never counted as completed.</p>
        {err && <p className="text-xs text-red-700">{err}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary">Add to plan</Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  )
}
