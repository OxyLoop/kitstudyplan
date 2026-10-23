import { RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ModuleCard } from '../components/ModuleCard'
import { Button, EmptyState, PageHeader, cx } from '../components/ui'
import { useData } from '../lib/data'
import { LANG_LABEL, SEE_PROFILES, SPEC_LABEL, SUBJECT_LABEL, SUBJECT_ORDER } from '../lib/domain'
import {
  ALL_PATTERNS,
  PATTERN_LABEL,
  activeFilterCount,
  defaultFilters,
  matches,
  searchText,
  sortModules,
  type Filters,
} from '../lib/filters'
import type { SpecType, Subject } from '../lib/types'
import { useStore } from '../state/store'

const SESSION_KEY = 'cds-study-planner/explorer-filters'
const PAGE = 40

function readSession(def: Filters): Filters {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? { ...def, ...JSON.parse(raw) } : def
  } catch {
    return def
  }
}

export default function Explorer() {
  const data = useData()
  const { state } = useStore()
  const def = useMemo(() => defaultFilters(state.settings.preferredLanguage), [state.settings.preferredLanguage])
  const [f, setF] = useState<Filters>(() => readSession(def))
  const [limit, setLimit] = useState(PAGE)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(f))
    } catch {
      /* ignore */
    }
    setLimit(PAGE)
  }, [f])

  const index = useMemo(() => new Map(data.modules.map((m) => [m.id, searchText(m)])), [data])
  const results = useMemo(
    () => sortModules(data.modules.filter((m) => matches(m, f, { saved: state.saved, index })), f.sort),
    [data, f, state.saved, index],
  )

  const creditValues = useMemo(
    () => [...new Set(data.modules.map((m) => m.credits.value))].filter((v): v is number => v !== null).sort((a, b) => a - b),
    [data],
  )
  const activityTypes = useMemo(() => {
    const c = new Map<string, number>()
    data.modules.forEach((m) => m.activityTypes.forEach((t) => c.set(t, (c.get(t) ?? 0) + 1)))
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [data])

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }))
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const nActive = activeFilterCount(f, def)

  const chips: { label: string; clear: () => void }[] = []
  if (f.semester !== 'any') chips.push({ label: f.semester === 'ws' ? 'WS 2026/27' : 'Course listed WS 26/27', clear: () => set('semester', 'any') })
  if (f.language !== 'any') chips.push({ label: f.language === 'english-taught' ? 'English-taught' : LANG_LABEL[f.language], clear: () => set('language', 'any') })
  if (f.programOnly) chips.push({ label: 'CDS program subjects', clear: () => set('programOnly', false) })
  f.subjects.forEach((s) => chips.push({ label: SUBJECT_LABEL[s], clear: () => set('subjects', f.subjects.filter((x) => x !== s)) }))
  if (f.seeProfile) chips.push({ label: `SEE: ${f.seeProfile}`, clear: () => set('seeProfile', '') })
  if (f.specialization) chips.push({ label: `Spec.: ${SPEC_LABEL[f.specialization]}`, clear: () => set('specialization', '') })
  if (f.credits) chips.push({ label: `${f.credits} ECTS`, clear: () => set('credits', '') })
  if (f.reqType !== 'any') chips.push({ label: { mandatory: 'Mandatory', elective: 'Elective', rosp: 'Research project / seminar req.' }[f.reqType], clear: () => set('reqType', 'any') })
  if (f.patterns.length < ALL_PATTERNS.length) chips.push({ label: `Offering: ${f.patterns.map((p) => PATTERN_LABEL[p]).join(', ') || 'none'}`, clear: () => set('patterns', [...ALL_PATTERNS]) })
  f.activity.forEach((a) => chips.push({ label: a === 'none' ? 'No course listing' : a, clear: () => set('activity', f.activity.filter((x) => x !== a)) }))
  if (f.savedOnly) chips.push({ label: 'Saved only', clear: () => set('savedOnly', false) })

  const panel = (
    <div className="space-y-5 text-sm">
      <FilterGroup title="Semester">
        {([
          ['ws', 'WS 2026/27', 'Course listed for WT 26/27, or recurring winter offering'],
          ['scheduled', 'Course listed for WS 26/27', 'Only modules with a WT 26/27 course in the handbook'],
          ['any', 'Any semester', ''],
        ] as const).map(([v, l, h]) => (
          <Radio key={v} name="semester" checked={f.semester === v} onChange={() => set('semester', v)} label={l} hint={h} />
        ))}
      </FilterGroup>

      <FilterGroup title="Handbook offering">
        {ALL_PATTERNS.map((p) => (
          <Check key={p} checked={f.patterns.includes(p)} onChange={() => set('patterns', toggle(f.patterns, p))} label={PATTERN_LABEL[p]} />
        ))}
      </FilterGroup>

      <FilterGroup title="Language">
        <Select value={f.language} onChange={(v) => set('language', v as Filters['language'])} options={[
          ['english-taught', 'English-taught (English or German/English)'],
          ['EN', 'English only'],
          ['DE/EN', 'German/English'],
          ['DE', 'German'],
          ['any', 'Any language'],
        ]} />
      </FilterGroup>

      <FilterGroup title="Subject / academic field">
        <Check checked={f.programOnly} onChange={() => set('programOnly', !f.programOnly)} label="Only modules creditable in CDS subjects" hint="Excludes thesis and additional examinations" />
        <div className="mt-1 space-y-1">
          {SUBJECT_ORDER.map((s) => (
            <Check key={s} checked={f.subjects.includes(s as Subject)} onChange={() => set('subjects', toggle(f.subjects, s as Subject))} label={SUBJECT_LABEL[s]} />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="SEE profile">
        <Select value={f.seeProfile} onChange={(v) => set('seeProfile', v)} options={[['', 'Any profile'], ...SEE_PROFILES.map((p) => [p, p] as [string, string])]} />
      </FilterGroup>

      <FilterGroup title="Specialization">
        <Select value={f.specialization} onChange={(v) => set('specialization', v as SpecType | '')} options={[['', 'Any'], ['MATH', SPEC_LABEL.MATH], ['CS', SPEC_LABEL.CS], ['SEE', SPEC_LABEL.SEE]]} />
      </FilterGroup>

      <FilterGroup title="Credits">
        <Select value={f.credits} onChange={(v) => set('credits', v)} options={[['', 'Any'], ...creditValues.map((v) => [String(v), `${v} ECTS`] as [string, string])]} />
      </FilterGroup>

      <FilterGroup title="Mandatory / elective">
        <Select value={f.reqType} onChange={(v) => set('reqType', v as Filters['reqType'])} options={[
          ['any', 'Any'],
          ['mandatory', 'Mandatory in a subject or profile'],
          ['elective', 'Elective'],
          ['rosp', 'Research Oriented Study Project / mandatory spec. module'],
        ]} />
      </FilterGroup>

      <FilterGroup title="Course type" hint="From the handbook course listings">
        {activityTypes.map((t) => (
          <Check key={t} checked={f.activity.includes(t)} onChange={() => set('activity', toggle(f.activity, t))} label={t} />
        ))}
        <Check checked={f.activity.includes('none')} onChange={() => set('activity', toggle(f.activity, 'none'))} label="No course listing" />
      </FilterGroup>

      <FilterGroup title="Personal">
        <Check checked={f.savedOnly} onChange={() => set('savedOnly', !f.savedOnly)} label={`Saved for later (${state.saved.length})`} />
      </FilterGroup>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Module Explorer"
        subtitle={`${data.modules.length} modules and ${data.components.length} module components from the official handbook. Default view: WS 2026/27, English-taught, CDS subjects.`}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search modules</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Search by name, module ID (M-…), component ID (T-…), coordinator…"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pr-8 pl-9 text-sm placeholder:text-slate-400 focus:border-accent-500 focus:outline-none"
          />
          {f.q && (
            <button className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" onClick={() => set('q', '')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        <div className="flex gap-2">
          <select value={f.sort} onChange={(e) => set('sort', e.target.value as Filters['sort'])} className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" aria-label="Sort">
            <option value="name">Sort: Name</option>
            <option value="ects-desc">Sort: ECTS (high → low)</option>
            <option value="ects-asc">Sort: ECTS (low → high)</option>
            <option value="id">Sort: Module ID</option>
          </select>
          <Button className="lg:hidden" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}>
            <SlidersHorizontal size={15} /> Filters{nActive ? ` (${nActive})` : ''}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button key={c.label} onClick={c.clear} className="inline-flex items-center gap-1 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-700 hover:bg-accent-100" title="Remove filter">
            {c.label} <X size={12} />
          </button>
        ))}
        {chips.length > 0 && (
          <button onClick={() => setF({ ...defaultFilters('ANY'), semester: 'any', programOnly: false, q: f.q, sort: f.sort })} className="text-xs text-slate-500 hover:text-slate-800 hover:underline">
            Show complete catalog
          </button>
        )}
        {nActive > 0 && (
          <button onClick={() => setF({ ...def, q: f.q, sort: f.sort })} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:underline">
            <RotateCcw size={11} /> Reset to defaults
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-6">
        <aside className={cx('w-64 shrink-0', showFilters ? 'fixed inset-0 z-30 block w-auto overflow-y-auto bg-white p-5 lg:static lg:z-auto lg:w-64 lg:p-0' : 'hidden lg:block')}>
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <span className="font-semibold">Filters</span>
            <Button size="sm" onClick={() => setShowFilters(false)}>Show {results.length} results</Button>
          </div>
          {panel}
        </aside>

        <section className="min-w-0 flex-1" aria-live="polite">
          <p className="mb-3 text-sm text-slate-500">
            <span className="font-medium text-slate-800">{results.length}</span> of {data.modules.length} modules
          </p>
          {results.length === 0 ? (
            <EmptyState title="No modules match these filters">Remove a filter above or show the complete catalog.</EmptyState>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {results.slice(0, limit).map((m) => (
                <ModuleCard key={m.id} m={m} />
              ))}
              {results.length > limit && (
                <Button onClick={() => setLimit((l) => l + PAGE)} className="mx-auto mt-2">
                  Show more ({results.length - limit} remaining)
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FilterGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</legend>
      {hint && <p className="-mt-1 mb-1.5 text-xs text-slate-400">{hint}</p>}
      <div className="space-y-1">{children}</div>
    </fieldset>
  )
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-slate-700">
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  )
}

function Radio({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-slate-700">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5 accent-[var(--color-accent-500)]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  )
}
