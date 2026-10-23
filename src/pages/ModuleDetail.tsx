import { ArrowLeft, ChevronDown, Clock, ExternalLink, FileText } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ModuleActions } from '../components/ModuleActions'
import { Badge, Card, EmptyState, PageRef, SourceLink, SourceText, Val, WinterBadge, cx } from '../components/ui'
import { loadPages, useData } from '../lib/data'
import { LANG_LABEL, eligibilityLabel, fmtEcts, languageClass, pdfPageUrl, winterStatus } from '../lib/domain'
import { slotValid } from '../lib/planner'
import { moduleSummary } from '../lib/summary'
import { useStore } from '../state/store'
import type { Module, ModuleComponent } from '../lib/types'

const SECTION_TITLE: Record<string, string> = {
  unassigned: 'Additional text',
}

export default function ModuleDetail() {
  const { id = '' } = useParams()
  const data = useData()
  const navigate = useNavigate()
  const m = data.moduleById.get(id)
  if (!m)
    return (
      <EmptyState title={`Module ${id} not found in the handbook`}>
        <Link to="/" className="text-accent-700 hover:underline">Back to the Module Explorer</Link>
      </EmptyState>
    )
  const sum = moduleSummary(m, data)

  return (
    <div className="space-y-5">
      <button onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Back
      </button>

      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">{m.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="font-mono">{m.id}</span>
              {m.code && <span className="font-mono">{m.code}</span>}
              <span>Handbook section {m.number}</span>
            </div>
          </div>
          <div className="text-right text-lg font-semibold text-slate-900">{fmtEcts(m.credits.value)}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <WinterBadge status={winterStatus(m)} />
          <Badge>{m.recurrence.raw ?? 'Recurrence not specified'}</Badge>
          <Badge>{LANG_LABEL[languageClass(m)]}</Badge>
          {m.grading && <Badge>{m.grading}</Badge>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <ModuleActions m={m} />
          <SourceLink page={m.pages.start} end={m.pages.end} />
        </div>
      </header>

      <MyTimes id={m.id} />

      {/* plain-language overview: template built from extracted fields only */}
      <Card className="border-accent-100 bg-accent-50/40 p-4">
        <h2 className="text-sm font-semibold text-slate-900">At a glance</h2>
        <p className="mt-1 text-sm text-slate-700">{sum.lead}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
          {sum.lines.map((l) => (
            <div key={l.label} className="contents">
              <dt className="text-slate-500">{l.label}</dt>
              <dd className="text-slate-800">{l.text}</dd>
            </div>
          ))}
        </dl>
        {sum.firstGoal && (
          <blockquote className="mt-3 border-l-2 border-accent-200 pl-3 text-sm text-slate-700 italic">
            “{sum.firstGoal}”
            <span className="mt-0.5 block text-xs text-slate-500 not-italic">— Competence Goal (original handbook text)</span>
          </blockquote>
        )}
        <p className="mt-3 text-xs text-slate-500">
          This overview is generated from the handbook fields below, without interpretation. The handbook does not contain weekly meeting times.
        </p>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <HandbookSections m={m} />
          <Components m={m} />
        </div>
        <div className="space-y-5">
          <Facts m={m} />
          <EligibilityCard m={m} />
        </div>
      </div>

      <OriginalPages start={m.pages.start} end={m.pages.end} />
    </div>
  )
}

/** The student's own entered times for this module (from the planner), if any. */
function MyTimes({ id }: { id: string }) {
  const { state } = useStore()
  const e = state.plan.find((x) => x.moduleId === id)
  if (!e) return null
  const times = e.times.filter(slotValid)
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Clock size={15} /> Your times (WS 2026/27 plan)</h2>
        <Link to="/planner" className="text-xs text-accent-700 hover:underline">Edit in planner</Link>
      </div>
      {times.length === 0 ? (
        <p className="mt-1 text-sm text-amber-700">No times entered — schedule not verified.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {times.map((t) => (
            <li key={t.id} className="flex flex-wrap gap-x-3">
              <span className="w-28 font-medium text-slate-800">{t.day} {t.start}–{t.end}</span>
              {t.label && <span className="text-slate-600">{t.label}</span>}
            </li>
          ))}
        </ul>
      )}
      {e.note && <p className="mt-2 text-sm text-slate-600 source-text">{e.note}</p>}
      <p className="mt-2 text-xs text-slate-400">Entered by you, not handbook data.</p>
    </Card>
  )
}

function Facts({ m }: { m: Module }) {
  const rows: [string, ReactNode][] = [
    ['Credits', m.credits.raw],
    ['Grading', m.grading],
    ['Recurrence', m.recurrence.raw],
    ['Duration', m.duration],
    ['Language', m.language.raw],
    ['Level', m.level],
    ['Version', m.version],
    ['Coordinators', m.coordinators],
    ['Organisation', m.organisation],
    ...Object.entries(m.otherFields).map(([k, v]) => [k, v] as [string, ReactNode]),
  ]
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Module facts</h2>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-800"><Val v={v} /></dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function EligibilityCard({ m }: { m: Module }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Where it counts</h2>
      <p className="mb-2 text-xs text-slate-500">From the program structure tables (chapter 3). Credits count in one subject only.</p>
      {m.eligibility.length === 0 ? (
        <p className="text-sm"><Val v={null} /></p>
      ) : (
        <ul className="space-y-2 text-sm">
          {m.eligibility.map((e, i) => (
            <li key={i} className="rounded-md bg-slate-50 px-2.5 py-2">
              <div className="font-medium text-slate-800">{eligibilityLabel(e)}</div>
              <div className="text-xs text-slate-500">
                {e.group}
                {e.groupKind === 'mandatory' && <Badge tone="violet">Mandatory</Badge>} · <PageRef page={e.page} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {m.partOf.length > 0 && (
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">“Part of” as printed on the module page</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {m.partOf.map((p) => (
              <li key={p.raw}>{p.raw}</li>
            ))}
          </ul>
        </details>
      )}
      {m.structureListings.length > 0 && (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">Structure table entries (language / term / credits)</summary>
          <ul className="mt-1 space-y-0.5">
            {m.structureListings.map((s, i) => (
              <li key={i}>
                {s.node}: {s.language || '—'} · {s.termOffered || '—'} · {s.credits || '—'}
                {s.notes.length > 0 && <> · {s.notes.join(' ')}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function HandbookSections({ m }: { m: Module }) {
  if (!m.sectionOrder.length)
    return (
      <Card className="p-4 text-sm text-slate-600">
        The handbook entry for this module contains no description sections (assessment, content, etc.). See the module components and the original PDF page.
      </Card>
    )
  return (
    <Card className="divide-y divide-slate-100">
      {m.sectionOrder.map((s, i) => {
        const text = m.sections[s.key]?.text
        return (
          <section key={`${s.key}-${i}`} className="p-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{s.heading ?? SECTION_TITLE[s.key] ?? s.key}</h2>
              {s.page && <PageRef page={s.page} />}
            </div>
            {text ? <SourceText text={dedupe(text, m, s.key, i)} /> : <Val v={null} />}
          </section>
        )
      })}
    </Card>
  )
}

/** Repeated headings are merged into one section text; show it only at the first occurrence. */
function dedupe(text: string, m: Module, key: string, idx: number) {
  const first = m.sectionOrder.findIndex((s) => s.key === key)
  return first === idx ? text : '(continued above)'
}

function Components({ m }: { m: Module }) {
  const data = useData()
  if (!m.components.length) return null
  const groups = [...new Set(m.components.map((c) => c.group ?? ''))]
  return (
    <Card>
      <div className="border-b border-slate-100 p-4 pb-3">
        <h2 className="text-sm font-semibold text-slate-900">Module components and assessments</h2>
        <p className="text-xs text-slate-500">Components are parts of this module and are not selectable on their own.</p>
      </div>
      {groups.map((g) => {
        const grp = m.componentGroups.find((x) => x.label === g)
        return (
          <div key={g} className="border-b border-slate-100 last:border-b-0">
            {g && (
              <div className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-600">
                {g}
                {grp?.constraint && <span className="ml-1 text-slate-500">— {grp.constraint}</span>}
              </div>
            )}
            {m.components
              .filter((c) => (c.group ?? '') === g)
              .map((row) => (
                <ComponentItem key={row.id} row={row} comp={data.componentById.get(row.id)} />
              ))}
          </div>
        )
      })}
    </Card>
  )
}

function ComponentItem({ row, comp }: { row: Module['components'][number]; comp?: ModuleComponent }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-4 py-3">
      <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">{row.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span className="font-mono">{row.id}</span>
            <span>{comp?.type ?? 'Type not specified'}</span>
            <span>Term: {row.termOffered || '—'}</span>
            {row.lecturers && <span>{row.lecturers}</span>}
          </div>
          {row.notes.length > 0 && <div className="mt-0.5 text-xs text-amber-700">{row.notes.join(' ')}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
          {row.credits || '—'}
          <ChevronDown size={16} className={cx('text-slate-400 transition-transform', open && 'rotate-180')} />
        </div>
      </button>
      {open && (comp ? <ComponentDetails c={comp} /> : <p className="mt-2 text-sm text-amber-700">No component description found in the handbook.</p>)}
    </div>
  )
}

function ComponentDetails({ c }: { c: ModuleComponent }) {
  const facts: [string, string | null][] = [
    ['Type', c.type],
    ['Credits', c.credits.raw],
    ['Grading', c.grading],
    ['Term offered', c.termOffered.raw],
    ['Expansion', c.expansion],
    ['Version', c.version],
    ['Coordinators', c.coordinators],
    ...Object.entries(c.otherFields),
  ]
  return (
    <div className="mt-3 space-y-3 rounded-md border border-slate-100 bg-slate-50/60 p-3">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd><Val v={v} /></dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Courses listed in the handbook</h3>
        {c.courses.length === 0 ? (
          <p className="text-sm text-slate-500">No courses listed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">Semester</th>
                  <th className="py-1 pr-2 font-medium">No.</th>
                  <th className="py-1 pr-2 font-medium">Course</th>
                  <th className="py-1 pr-2 font-medium">SWS</th>
                  <th className="py-1 pr-2 font-medium">Type</th>
                  <th className="py-1 font-medium">Lecturers</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {c.courses.map((co, i) => (
                  <tr key={i} className="border-t border-slate-200/70">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {co.semester.label === 'WS 2026/27' ? <Badge tone="accent">{co.semester.raw}</Badge> : co.semester.raw}
                    </td>
                    <td className="py-1 pr-2 font-mono text-xs">{co.number ?? '—'}</td>
                    <td className="py-1 pr-2">
                      {co.url ? (
                        <a href={co.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                          {co.title} <ExternalLink size={11} className="inline" />
                        </a>
                      ) : co.title}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap">{co.sws ?? '—'}</td>
                    <td className="py-1 pr-2">{co.types.join(' / ') || '—'}{co.mode && <span className="text-xs text-slate-500"> · {co.mode}</span>}</td>
                    <td className="py-1">{co.lecturers ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">Weekly meeting times are not part of the handbook. Use the study portal links or enter times manually in the planner.</p>
          </div>
        )}
      </div>

      {c.sectionOrder.map((s, i) => (
        <div key={`${s.key}-${i}`}>
          <h3 className="mb-0.5 flex items-baseline justify-between text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {s.heading ?? 'Additional text'} {s.page && <PageRef page={s.page} />}
          </h3>
          <SourceText text={c.sections[s.key]?.text ?? ''} />
        </div>
      ))}

      {c.excerpts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Course descriptions ({c.excerpts.length})
          </summary>
          <div className="mt-2 space-y-3">
            {c.excerpts.map((e, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800">{e.title}</div>
                  <PageRef page={e.page} />
                </div>
                <div className="text-xs text-slate-500">
                  {[e.number, e.semester?.raw, e.sws, e.language && `Language: ${e.language}`, e.typeRaw, e.format].filter(Boolean).join(' · ')}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer" className="ml-1 text-accent-700 hover:underline">
                      Study portal <ExternalLink size={10} className="inline" />
                    </a>
                  )}
                </div>
                {Object.entries(e.sections).map(([k, v]) => (
                  <div key={k} className="mt-2">
                    {k !== 'unassigned' && <div className="text-xs font-semibold text-slate-600 capitalize">{k.replace(/([A-Z])/g, ' $1')}</div>}
                    <SourceText text={v.text} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
      <SourceLink page={c.pages.start} end={c.pages.end} />
    </div>
  )
}

export function OriginalPages({ start, end }: { start: number; end: number }) {
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState<{ page: number; text: string }[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open || pages) return
    loadPages()
      .then((all) => setPages(all.filter((p) => p.page >= start && p.page <= end)))
      .catch((e: Error) => setErr(e.message))
  }, [open, pages, start, end])
  return (
    <Card className="p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileText size={15} /> Complete original page text (pages {start}{end !== start ? `–${end}` : ''})
        </span>
        <ChevronDown size={16} className={cx('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {err && <p className="text-sm text-red-700">{err}</p>}
          {!pages && !err && <p className="text-sm text-slate-500">Loading…</p>}
          {pages?.map((p) => (
            <div key={p.page}>
              <a href={pdfPageUrl(p.page)} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent-700 hover:underline">
                PDF page {p.page}
              </a>
              <pre className="source-text mt-1 max-h-[32rem] overflow-y-auto rounded-md bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700">{p.text}</pre>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
