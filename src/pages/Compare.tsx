import { CalendarCheck, CalendarPlus, Columns3, Search, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Missing, PageHeader, SourceText, WinterBadge, cx } from '../components/ui'
import { useData } from '../lib/data'
import { WINTER_STATUS_LABEL, eligibilityLabels, fmtEcts, pdfPageUrl, winterStatus } from '../lib/domain'
import { normalize, searchText } from '../lib/filters'
import { MAX_COMPARE } from '../lib/planner'
import type { Module } from '../lib/types'
import { useStore } from '../state/store'

interface Row {
  label: string
  value: (m: Module) => string | null
  render?: (m: Module) => ReactNode
  long?: boolean
  noDiff?: boolean
}

const sec = (key: string) => (m: Module) => m.sections[key]?.text ?? null

const ROWS: Row[] = [
  { label: 'Module ID', value: (m) => m.id, noDiff: true },
  { label: 'Credits', value: (m) => fmtEcts(m.credits.value) },
  { label: 'Academic field eligibility', value: (m) => eligibilityLabels(m).join('\n') || null },
  { label: 'Language', value: (m) => m.language.raw },
  {
    label: 'Semester availability',
    value: (m) => `${m.recurrence.raw ?? ''} | ${WINTER_STATUS_LABEL[winterStatus(m)]}`,
    render: (m) => (
      <div className="space-y-1">
        <div>{m.recurrence.raw ?? <Missing />}</div>
        <WinterBadge status={winterStatus(m)} />
      </div>
    ),
  },
  { label: 'Duration', value: (m) => m.duration },
  { label: 'Grading', value: (m) => m.grading },
  { label: 'Workload', value: sec('workload'), long: true },
  { label: 'Prerequisites', value: sec('prerequisites'), long: true },
  { label: 'Recommendations', value: sec('recommendations'), long: true },
  { label: 'Assessment', value: sec('assessment'), long: true },
  { label: 'Module grade calculation', value: sec('moduleGradeCalculation'), long: true },
  { label: 'Competence goal (learning objectives)', value: sec('competenceGoal'), long: true },
  { label: 'Content', value: sec('content'), long: true },
  { label: 'Course types', value: (m) => m.activityTypes.join(', ') || null },
  { label: 'Coordinators', value: (m) => m.coordinators },
]

const norm = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

export default function Compare() {
  const data = useData()
  const store = useStore()
  const mods = store.state.compare.map((id) => data.moduleById.get(id)).filter((m): m is Module => !!m)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <PageHeader
        title="Compare Modules"
        subtitle={`Side-by-side comparison of up to ${MAX_COMPARE} modules. Rows where the handbook values differ are highlighted.`}
        actions={
          mods.length > 1 && (
            <>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={onlyDiff} onChange={() => setOnlyDiff((x) => !x)} /> Only differences
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={expanded} onChange={() => setExpanded((x) => !x)} /> Expand long text
              </label>
            </>
          )
        }
      />

      {mods.length < MAX_COMPARE && <Picker />}

      {mods.length === 0 ? (
        <EmptyState icon={<Columns3 />} title="No modules selected for comparison">
          Use “Compare” on a module in the <Link to="/" className="text-accent-700 hover:underline">Module Explorer</Link>, or search above.
        </EmptyState>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-40" />
              {mods.map((m) => (
                <col key={m.id} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 align-top">
                <th className="p-3 text-left text-xs font-medium text-slate-500">Module</th>
                {mods.map((m) => (
                  <th key={m.id} className="p-3 text-left font-normal">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/module/${m.id}`} className="font-semibold text-slate-900 hover:text-accent-700">{m.name}</Link>
                      <button onClick={() => store.toggleCompare(m.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label={`Remove ${m.name} from comparison`}>
                        <X size={15} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant={store.inPlan(m.id) ? 'secondary' : 'primary'} onClick={() => (store.inPlan(m.id) ? store.removePlan(m.id) : store.addPlan(m))}>
                        {store.inPlan(m.id) ? <CalendarCheck size={13} /> : <CalendarPlus size={13} />}
                        {store.inPlan(m.id) ? 'In semester' : 'Add to semester'}
                      </Button>
                      <a href={pdfPageUrl(m.pages.start)} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:underline">p. {m.pages.start}</a>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const vals = mods.map((m) => r.value(m))
                const differs = !r.noDiff && mods.length > 1 && new Set(vals.map(norm)).size > 1
                if (onlyDiff && !differs && !r.noDiff) return null
                return (
                  <tr key={r.label} className={cx('border-b border-slate-100 align-top last:border-b-0', differs && 'bg-amber-50/50')}>
                    <th className="p-3 text-left text-xs font-medium text-slate-500">
                      {r.label}
                      {differs && <span className="mt-0.5 block font-normal text-amber-700">differs</span>}
                    </th>
                    {mods.map((m, i) => (
                      <td key={m.id} className="p-3">
                        {r.render ? r.render(m) : vals[i] ? (
                          <SourceText text={vals[i]!} className={cx(r.long && !expanded && 'line-clamp-6')} />
                        ) : (
                          <Missing />
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Picker() {
  const data = useData()
  const store = useStore()
  const [q, setQ] = useState('')
  const index = useMemo(() => data.modules.map((m) => [m, searchText(m)] as const), [data])
  const hits = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    return index.filter(([, t]) => terms.every((x) => t.includes(x))).slice(0, 8).map(([m]) => m)
  }, [q, index])
  return (
    <div className="relative max-w-xl">
      <Search size={16} className="pointer-events-none absolute top-2.5 left-3 text-slate-400" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Add a module to compare (${store.state.compare.length}/${MAX_COMPARE})…`}
        className="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm focus:border-accent-500 focus:outline-none"
        aria-label="Search module to compare"
      />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {hits.map((m) => (
            <li key={m.id}>
              <button
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={store.inCompare(m.id)}
                onClick={() => {
                  store.toggleCompare(m.id)
                  setQ('')
                }}
              >
                <span className="truncate">{m.name}</span>
                <span className="shrink-0 font-mono text-xs text-slate-400">{m.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
