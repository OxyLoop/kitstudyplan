import { X } from 'lucide-react'
import { DAYS, slotValid, type Day, type TimeSlot } from '../lib/planner'
import { cx } from './ui'

/** Editable list of manually entered weekly time slots. */
export function TimesEditor({
  times,
  onChange,
  conflictSlotIds,
}: {
  times: TimeSlot[]
  onChange: (times: TimeSlot[]) => void
  conflictSlotIds: Set<string>
}) {
  const patch = (id: string, p: Partial<TimeSlot>) => onChange(times.map((t) => (t.id === id ? { ...t, ...p } : t)))
  return (
    <>
      {times.map((t) => (
        <div key={t.id} className={cx('mt-2 flex flex-wrap items-center gap-2 rounded-md p-1.5 text-sm', conflictSlotIds.has(t.id) && 'bg-red-50 ring-1 ring-red-200')}>
          <select value={t.day} onChange={(ev) => patch(t.id, { day: ev.target.value as Day })} className="rounded border border-slate-300 bg-white px-1.5 py-1" aria-label="Day">
            {DAYS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <input type="time" value={t.start} onChange={(ev) => patch(t.id, { start: ev.target.value })} className="rounded border border-slate-300 px-1.5 py-1" aria-label="Start time" />
          <span className="text-slate-400">–</span>
          <input type="time" value={t.end} onChange={(ev) => patch(t.id, { end: ev.target.value })} className="rounded border border-slate-300 px-1.5 py-1" aria-label="End time" />
          <input value={t.label ?? ''} onChange={(ev) => patch(t.id, { label: ev.target.value })} placeholder="Lecture, exercise, room…" className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1" aria-label="Label" />
          {t.start && t.end && !slotValid(t) && <span className="text-xs text-red-700">End must be after start</span>}
          {conflictSlotIds.has(t.id) && <span className="text-xs font-medium text-red-700">Conflict</span>}
          <button onClick={() => onChange(times.filter((x) => x.id !== t.id))} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Remove time"><X size={14} /></button>
        </div>
      ))}
    </>
  )
}

export const newSlot = (owner: string, day: Day = 'Mon', start = '', end = '', label = ''): TimeSlot => ({
  id: `${owner}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  day,
  start,
  end,
  label,
})
