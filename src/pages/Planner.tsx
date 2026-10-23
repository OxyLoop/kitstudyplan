import { AlertTriangle, CalendarRange, Clock, Download, FilePlus2, Plus, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AddExternalForm, ExternalCard } from '../components/ExternalCourses'
import { TimesEditor, newSlot } from '../components/TimesEditor'
import { Badge, Button, Card, EmptyState, PageHeader, StatusBadge, WinterBadge, cx } from '../components/ui'
import { useData } from '../lib/data'
import { SUBJECT_LABEL, SUBJECT_ORDER, fmtEcts, winterStatus } from '../lib/domain'
import {
  DAYS,
  assignmentOptions,
  ectsSummary,
  exportPlan,
  findConflicts,
  scheduleItems,
  scheduleStatus,
  slotValid,
  type PlanEntry,
  type Scheduled,
} from '../lib/planner'
import { REQUIREMENTS, STATUS_ORDER, runChecks, type Check } from '../lib/rules'
import type { Module, Subject } from '../lib/types'
import { useStore } from '../state/store'

export default function Planner() {
  const data = useData()
  const store = useStore()
  const { plan, externals, settings } = store.state
  const summary = useMemo(() => ectsSummary(plan, data.moduleById, externals), [plan, externals, data])
  const checks = useMemo(() => runChecks(store.state, data).filter((c) => c.scope === 'semester'), [store.state, data])
  const items = scheduleItems(plan, externals)
  const sched = scheduleStatus(items)
  const conflicts = findConflicts(items)
  const conflictSlotIds = new Set(conflicts.flatMap((c) => [c.a.slot.id, c.b.slot.id]))
  const target = settings.targetEcts
  const [adding, setAdding] = useState(false)
  const ownChecks = (id: string) => checks.filter((c) => c.moduleIds?.length === 1 && c.moduleIds[0] === id && c.status !== 'valid')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Winter Semester Planner"
        subtitle="Tentative course selection for WS 2026/27. Saved in this browser only. Not an enrollment or exam registration."
        actions={<ImportExport />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs font-medium text-slate-500">Total planned</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{summary.total} <span className="text-base font-normal text-slate-500">ECTS</span></div>
          <div className="mt-1 text-xs text-slate-500">
            {target ? `Target: ${target} ECTS (${summary.total - target >= 0 ? '+' : ''}${summary.total - target})` : 'The study plan suggests about 30 ECTS per semester (p. 20).'}
          </div>
          {summary.externalTotal > 0 && (
            <div className="mt-1 text-xs text-slate-500">
              Includes {summary.externalTotal} ECTS from external courses
              {summary.pendingRecognition > 0 && <span className="text-amber-700"> ({summary.pendingRecognition} ECTS recognition pending)</span>}.
            </div>
          )}
          <div className="mt-1 text-xs text-slate-500">Completed: {summary.completed} ECTS — planned credits are not completed credits.</div>
          {target ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
              <div className={cx('h-full', summary.total > target ? 'bg-amber-500' : 'bg-accent-500')} style={{ width: `${Math.min(100, (summary.total / target) * 100)}%` }} />
            </div>
          ) : null}
        </Card>
        <Card className="p-4 sm:col-span-2">
          <div className="text-xs font-medium text-slate-500">ECTS by subject (each module counted once)</div>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {SUBJECT_ORDER.filter((s) => summary.bySubject[s] > 0 || ['MATH', 'CS', 'SEE', 'SPEC'].includes(s)).map((s) => {
              const req = REQUIREMENTS.find((r) => r.subject === s)
              return (
                <div key={s} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-slate-600">{SUBJECT_LABEL[s]}</span>
                  <span className={cx('font-medium whitespace-nowrap', req && summary.bySubject[s] > req.max ? 'text-red-700' : 'text-slate-900')}>
                    {summary.bySubject[s]}
                    {summary.unverifiedBySubject[s] > 0 && <span className="text-xs font-normal text-amber-700" title="From external courses whose credit recognition is not confirmed"> ({summary.unverifiedBySubject[s]} pending)</span>}
                    {req && <span className="text-xs font-normal text-slate-400"> /{req.min === req.max ? req.min : `${req.min}–${req.max}`}</span>}
                  </span>
                </div>
              )
            })}
            {summary.unassigned > 0 && (
              <div className="flex items-baseline justify-between gap-2 text-amber-700">
                <span>Not yet assigned</span>
                <span className="font-medium">{summary.unassigned}</span>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">Ranges are degree totals over all semesters; they are shown for orientation only.</p>
        </Card>
      </div>

      <ScheduleBanner sched={sched} />

      {plan.length === 0 && externals.length === 0 ? (
        <>
          <EmptyState icon={<CalendarRange />} title="Your WS 2026/27 plan is empty">
            Add modules from the <Link to="/" className="text-accent-700 hover:underline">Module Explorer</Link>, or add an external course (e.g. a language course).
            <div className="mt-3">
              <Button size="sm" onClick={() => setAdding(true)}><FilePlus2 size={14} /> Add external course</Button>
            </div>
          </EmptyState>
          {adding && <AddExternalForm onDone={() => setAdding(false)} />}
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {plan.map((e) => {
              const m = data.moduleById.get(e.moduleId)
              return m ? (
                <EntryCard
                  key={e.moduleId}
                  e={e}
                  m={m}
                  checks={ownChecks(m.id)}
                  conflictSlotIds={conflictSlotIds}
                />
              ) : null
            })}
            {externals.length > 0 && (
              <h2 className="pt-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">External courses (not in the Module Handbook)</h2>
            )}
            {externals.map((x) => (
              <ExternalCard key={x.id} x={x} checks={ownChecks(x.id)} conflictSlotIds={conflictSlotIds} />
            ))}
            {adding ? (
              <AddExternalForm onDone={() => setAdding(false)} />
            ) : (
              <Button onClick={() => setAdding(true)}><FilePlus2 size={14} /> Add external course</Button>
            )}
          </div>
          <div className="space-y-5">
            <Warnings checks={checks} />
            <WeekView items={items} names={new Map(externals.map((x) => [x.id, x.title]))} conflictSlotIds={conflictSlotIds} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <label htmlFor="plan-notes" className="text-sm font-semibold text-slate-900">Personal notes</label>
          <textarea
            id="plan-notes"
            value={store.state.planNotes}
            onChange={(e) => store.setPlanNotes(e.target.value)}
            rows={4}
            placeholder="e.g. ask the Examination Committee about…"
            className="mt-2 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-accent-500 focus:outline-none"
          />
        </Card>
        <SavedList />
      </div>
    </div>
  )
}

function ScheduleBanner({ sched }: { sched: ReturnType<typeof scheduleStatus> }) {
  if (sched.kind === 'empty') return null
  if (sched.kind === 'conflicts')
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium">{sched.conflicts.length} schedule conflict{sched.conflicts.length > 1 ? 's' : ''}</span> between times you entered.
          {sched.unverified.length > 0 && ` ${sched.unverified.length} module(s) have no times — schedule not verified for them.`}
        </div>
      </div>
    )
  if (sched.kind === 'unverified')
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Clock size={16} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium">Schedule not verified.</span> The handbook contains no weekly meeting times. Enter times from the KIT course catalogue for {sched.unverified.length} module{sched.unverified.length > 1 ? 's' : ''} to check for conflicts.
        </div>
      </div>
    )
  return (
    <div className="flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-700">
      <Clock size={16} className="mt-0.5 shrink-0" />
      <div>No overlaps among the times you entered. Times are your own entries, not handbook data.</div>
    </div>
  )
}

function EntryCard({ e, m, checks, conflictSlotIds }: { e: PlanEntry; m: Module; checks: Check[]; conflictSlotIds: Set<string> }) {
  const store = useStore()
  const opts = assignmentOptions(m, store.state.settings)
  const [showNote, setShowNote] = useState(!!e.note)

  const addSlot = () => store.updateEntry(m.id, { times: [...e.times, newSlot(m.id)] })

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/module/${m.id}`} className="font-semibold text-slate-900 hover:text-accent-700">{m.name}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{m.id}</span>
            <WinterBadge status={winterStatus(m)} />
            <span>{m.language.raw ?? 'Language not specified'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{fmtEcts(m.credits.value)}</span>
          <Button size="sm" variant="ghost" onClick={() => store.removePlan(m.id)} aria-label={`Remove ${m.name}`} title="Remove from plan">
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`cat-${m.id}`} className="text-slate-600">Counts towards</label>
        <select
          id={`cat-${m.id}`}
          value={e.category ?? ''}
          onChange={(ev) => store.updateEntry(m.id, { category: (ev.target.value || null) as Subject | null })}
          className={cx('w-full max-w-full rounded-md border bg-white px-2 py-1 text-sm sm:w-auto', e.category ? 'border-slate-300' : 'border-amber-400')}
        >
          <option value="">— choose one subject —</option>
          {opts.map((o) => (
            <option key={o.subject} value={o.subject} disabled={!o.valid && e.category !== o.subject}>
              {SUBJECT_LABEL[o.subject]}{!o.valid ? ' (not eligible with your settings)' : ''}
            </option>
          ))}
        </select>
        {opts.length > 1 && <span className="text-xs text-slate-400">Eligible in {opts.length} subjects — credits count in one only</span>}
      </div>

      {checks.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              <StatusBadge status={c.status} />
              <span className="text-slate-600">
                {c.title.replace(`${m.name}: `, '')}
                {c.id.startsWith('prereq') || c.id.startsWith('cprereq') ? (
                  <details className="mt-0.5">
                    <summary className="cursor-pointer text-slate-400">Show handbook text</summary>
                    <span className="source-text block text-slate-600">{c.detail}</span>
                  </details>
                ) : (
                  <span className="block text-slate-400">{c.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">
            Course times {e.times.some(slotValid) ? '' : <Badge tone="amber">Schedule not verified</Badge>}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={addSlot}><Plus size={13} /> Add time</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNote((s) => !s)}>{showNote ? 'Hide note' : 'Add note'}</Button>
          </div>
        </div>
        <TimesEditor times={e.times} onChange={(times) => store.updateEntry(m.id, { times })} conflictSlotIds={conflictSlotIds} />
        {showNote && (
          <textarea
            value={e.note}
            onChange={(ev) => store.updateEntry(m.id, { note: ev.target.value })}
            rows={2}
            placeholder="Personal note for this module"
            className="mt-2 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-accent-500 focus:outline-none"
          />
        )}
      </div>
    </Card>
  )
}

function Warnings({ checks }: { checks: Check[] }) {
  const relevant = checks.filter((c) => c.status !== 'valid' || c.id === 'eighty')
  const sorted = [...relevant].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
  const general = sorted.filter((c) => !c.moduleIds || c.moduleIds.length !== 1)
  const counts = STATUS_ORDER.map((s) => [s, relevant.filter((c) => c.status === s).length] as const).filter(([, n]) => n)
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Semester checks</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {counts.length === 0 ? <span className="text-sm text-slate-500">No warnings for the current selection.</span> : counts.map(([s, n]) => (
          <span key={s} className="inline-flex items-center gap-1 text-xs"><StatusBadge status={s} /> {n}</span>
        ))}
      </div>
      {general.length > 0 && (
        <ul className="mt-3 space-y-2">
          {general.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex items-start gap-2"><StatusBadge status={c.status} /><span className="font-medium text-slate-800">{c.title}</span></div>
              <p className="source-text mt-0.5 text-xs text-slate-500">{c.detail}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Module-specific checks are shown on each module. Full degree progress: <Link to="/requirements" className="text-accent-700 hover:underline">Degree Requirements</Link>.
      </p>
    </Card>
  )
}

function WeekView({ items, names, conflictSlotIds }: { items: Scheduled[]; names: Map<string, string>; conflictSlotIds: Set<string> }) {
  const data = useData()
  const slots = items.flatMap((e) =>
    e.times.filter(slotValid).map((t) => ({ t, name: data.moduleById.get(e.moduleId)?.name ?? names.get(e.moduleId) ?? e.moduleId })),
  )
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Week overview (entered times)</h2>
      {slots.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No times entered. Schedule not verified.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {DAYS.map((d) => {
            const day = slots.filter((s) => s.t.day === d).sort((a, b) => a.t.start.localeCompare(b.t.start))
            if (!day.length) return null
            return (
              <div key={d}>
                <div className="text-xs font-semibold text-slate-500">{d}</div>
                <ul className="mt-0.5 space-y-0.5">
                  {day.map(({ t, name }) => (
                    <li key={t.id} className={cx('flex gap-2 rounded px-1.5 py-0.5 text-xs', conflictSlotIds.has(t.id) ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-700')}>
                      <span className="font-mono whitespace-nowrap">{t.start}–{t.end}</span>
                      <span className="truncate">{name}{t.label ? ` · ${t.label}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function SavedList() {
  const data = useData()
  const store = useStore()
  const saved = store.state.saved.map((id) => data.moduleById.get(id)).filter((m): m is Module => !!m)
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Saved for later ({saved.length})</h2>
      {saved.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Use “Save” on any module to keep it here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {saved.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <Link to={`/module/${m.id}`} className="min-w-0 truncate text-slate-800 hover:text-accent-700">{m.name}</Link>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-xs text-slate-500">{fmtEcts(m.credits.value)}</span>
                <Button size="sm" variant={store.inPlan(m.id) ? 'secondary' : 'primary'} disabled={store.inPlan(m.id)} onClick={() => store.addPlan(m)}>
                  {store.inPlan(m.id) ? 'Planned' : 'Add'}
                </Button>
                <button onClick={() => store.toggleSaved(m.id)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label={`Unsave ${m.name}`}><X size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ImportExport() {
  const store = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const doExport = () => {
    const blob = new Blob([exportPlan(store.state)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cds-plan-ws2026-27.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  const mode = useRef<'replace' | 'merge'>('replace')
  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      if (!Array.isArray(parsed.plan) && !Array.isArray(parsed.externals)) throw new Error('No "plan" or "externals" found')
      // files marked "mode": "merge" (or chosen via "Add from file") only add entries
      if (mode.current === 'merge' || parsed.mode === 'merge') {
        const added = store.mergeIn(parsed)
        setMsg(added.length ? `Added: ${added.join(', ')}. Existing entries unchanged.` : 'Nothing new to add — everything in the file is already in your plan.')
        return
      }
      if ((store.state.plan.length || store.state.externals.length) && !confirm('Replace your current plan, saved modules and settings with the imported file?')) return
      store.replaceState(parsed)
      setMsg(`Imported ${(parsed.plan ?? []).length} planned module(s) and ${(parsed.externals ?? []).length} external course(s).`)
    } catch (err) {
      setMsg(`Import failed: ${(err as Error).message}`)
    }
  }
  const pick = (m: 'replace' | 'merge') => {
    mode.current = m
    fileRef.current?.click()
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <Button size="sm" onClick={doExport}><Download size={14} /> Export JSON</Button>
      <Button size="sm" onClick={() => pick('replace')} title="Replace the whole plan with a file"><Upload size={14} /> Import JSON</Button>
      <Button size="sm" onClick={() => pick('merge')} title="Add entries from a file without changing anything already in your plan"><Plus size={14} /> Add from file</Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void doImport(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
