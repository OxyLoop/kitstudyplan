import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Card, PageHeader, PageRef, SourceText, cx } from '../components/ui'
import { loadPages, useData } from '../lib/data'
import { PDF_URL, pdfPageUrl } from '../lib/domain'
import { normalize } from '../lib/filters'
import type { StructureNode } from '../lib/types'

const TABS = [
  ['plan', 'Study plan & notices'],
  ['structure', 'Program structure'],
  ['components', 'Module components'],
  ['pages', 'Page text'],
  ['report', 'Extraction report'],
] as const
type Tab = (typeof TABS)[number][0]

export default function Handbook() {
  const { meta } = useData()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'plan'
  return (
    <div>
      <PageHeader
        title="Handbook & Data"
        subtitle={<>All extracted content of the {meta.pdf.pages}-page Module Handbook ({meta.handbookDateRaw}). <a href={PDF_URL} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">Open original PDF <ExternalLink size={11} className="inline" /></a></>}
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {TABS.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k })}
            className={cx('shrink-0 border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-accent-500 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-800')}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'plan' && <StudyPlan />}
      {tab === 'structure' && <Structure />}
      {tab === 'components' && <ComponentIndex />}
      {tab === 'pages' && <PageText />}
      {tab === 'report' && <Report />}
    </div>
  )
}

function StudyPlan() {
  const { regulations: r } = useData()
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-1 flex items-baseline justify-between"><h2 className="text-sm font-semibold">Disclaimer and notices</h2><PageRef page={r.disclaimer.page} /></div>
        <SourceText text={r.disclaimer.text} />
      </Card>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {r.studyPlan.imageNote}{' '}
        {r.studyPlan.imageOnlyContent.map((p, i) => (
          <span key={p.page}>{i ? ', ' : ''}<a className="underline" href={pdfPageUrl(p.page)} target="_blank" rel="noreferrer">p. {p.page}</a></span>
        ))}
      </div>
      <Card className="divide-y divide-slate-100">
        {r.studyPlan.chapters.map((c, i) => (
          <section key={i} className="p-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{c.number ? `${c.number} ` : ''}{c.title}</h2>
              <PageRef page={c.page} />
            </div>
            {c.text ? <SourceText text={c.text} /> : null}
          </section>
        ))}
      </Card>
    </div>
  )
}

function Structure() {
  const { structure, nodeByUid } = useData()
  const top = structure.nodes.filter((n) => !n.parentUid)
  return (
    <div className="space-y-3">
      <Card className="p-4 text-sm">
        <h2 className="mb-1 font-semibold">Overview <PageRef page={33} /></h2>
        <ul className="grid gap-0.5 sm:grid-cols-2">
          {structure.root.overview.map((l) => <li key={l} className={cx(l.startsWith('[') && 'mt-1 font-medium text-slate-500')}>{l.replace(/^\[|\]$/g, '')}</li>)}
        </ul>
      </Card>
      {top.map((n) => <NodeView key={n.uid} n={n} byUid={nodeByUid} depth={0} />)}
    </div>
  )
}

function NodeView({ n, byUid, depth }: { n: StructureNode; byUid: Map<string, StructureNode>; depth: number }) {
  const { moduleById } = useData()
  const [open, setOpen] = useState(depth === 0 && n.groups.every((g) => g.entries.length < 12))
  return (
    <Card className={cx(depth > 0 && 'border-slate-100 bg-slate-50/40')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-baseline justify-between gap-2 p-3 text-left" aria-expanded={open}>
        <span className="text-sm font-semibold text-slate-900">{n.number} {n.title}</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {n.credits?.raw && <span>{n.credits.raw} ECTS</span>}
          <span>{n.groups.reduce((a, g) => a + g.entries.length, 0)} entries</span>
          <span>p. {n.page}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {n.uid.includes('#') && <p className="text-xs text-amber-700">The handbook prints this section number twice; shown here as a separate section.</p>}
          {n.electionNotes && (
            <div className="rounded-md bg-white p-2.5 ring-1 ring-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase">Election notes</div>
              <SourceText text={n.electionNotes} />
            </div>
          )}
          {n.modeledConditions && (
            <div className="rounded-md bg-white p-2.5 ring-1 ring-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase">Modelled conditions</div>
              <SourceText text={n.modeledConditions} />
            </div>
          )}
          {n.otherText?.map((t, i) => <SourceText key={i} text={t} className="text-xs" />)}
          {n.groups.map((g, gi) => (
            <div key={gi} className="overflow-x-auto">
              <div className="mb-1 text-xs font-semibold text-slate-600">
                {g.label} {g.kind === 'mandatory' && <Badge tone="violet">Mandatory</Badge>} <PageRef page={g.page} />
              </div>
              <table className="w-full min-w-[480px] text-sm">
                <tbody>
                  {g.entries.map((e, ei) => (
                    <tr key={ei} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-2 font-mono text-xs whitespace-nowrap text-slate-500">{e.moduleId ?? ''}</td>
                      <td className="py-1 pr-2">
                        {e.moduleId && moduleById.has(e.moduleId) ? <Link className="text-slate-800 hover:text-accent-700 hover:underline" to={`/module/${e.moduleId}`}>{e.name}</Link> : e.name}
                        {e.notes.length > 0 && <div className="text-xs text-amber-700">{e.notes.join(' ')}</div>}
                      </td>
                      <td className="py-1 pr-2 text-xs whitespace-nowrap">{e.language}</td>
                      <td className="py-1 pr-2 text-xs whitespace-nowrap">{e.termOffered}</td>
                      <td className="py-1 text-xs whitespace-nowrap">{e.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {n.children.map((c) => byUid.get(c)).filter(Boolean).map((c) => <NodeView key={c!.uid} n={c!} byUid={byUid} depth={depth + 1} />)}
        </div>
      )}
    </Card>
  )
}

function ComponentIndex() {
  const { components, moduleById } = useData()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = normalize(q).split(/\s+/).filter(Boolean)
    return components.filter((c) => {
      if (!t.length) return true
      const hay = normalize(`${c.id} ${c.name} ${c.type ?? ''} ${c.partOf.map((p) => p.moduleId + ' ' + p.moduleName).join(' ')}`)
      return t.every((x) => hay.includes(x))
    })
  }, [q, components])
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${components.length} module components (T-…, name, type)…`} className="mb-3 w-full max-w-xl rounded-md border border-slate-300 px-3 py-2 text-sm" aria-label="Search components" />
      <p className="mb-2 text-xs text-slate-500">Module components are parts of modules (examinations, coursework). They are linked to their parent modules and are not selectable on their own.</p>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
            <tr><th className="p-2 font-medium">ID</th><th className="p-2 font-medium">Component</th><th className="p-2 font-medium">Type</th><th className="p-2 font-medium">Credits</th><th className="p-2 font-medium">Part of</th><th className="p-2 font-medium">Page</th></tr>
          </thead>
          <tbody>
            {list.slice(0, 200).map((c) => (
              <tr key={c.id} className="border-b border-slate-100 align-top">
                <td className="p-2 font-mono text-xs whitespace-nowrap">{c.id}</td>
                <td className="p-2">{c.name}</td>
                <td className="p-2 text-xs">{c.type ?? '—'}</td>
                <td className="p-2 text-xs whitespace-nowrap">{c.credits.raw ?? '—'}</td>
                <td className="p-2 text-xs">
                  {c.partOf.map((p) => moduleById.has(p.moduleId) ? <Link key={p.moduleId} to={`/module/${p.moduleId}`} className="block text-accent-700 hover:underline">{p.moduleName}</Link> : <span key={p.moduleId} className="block">{p.moduleName} (not in handbook)</span>)}
                </td>
                <td className="p-2"><PageRef page={c.pages.start} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 200 && <p className="p-2 text-xs text-slate-500">Showing 200 of {list.length}. Refine the search to see more.</p>}
      </Card>
    </div>
  )
}

function PageText() {
  const { meta } = useData()
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState<{ page: number; text: string }[] | null>(null)
  useEffect(() => {
    void loadPages().then(setPages)
  }, [])
  const p = pages?.[page - 1]
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="pg">PDF page</label>
        <input id="pg" type="number" min={1} max={meta.pdf.pages} value={page} onChange={(e) => setPage(Math.max(1, Math.min(meta.pdf.pages, Number(e.target.value) || 1)))} className="w-24 rounded-md border border-slate-300 px-2 py-1" />
        <span className="text-slate-500">of {meta.pdf.pages}</span>
        <a href={pdfPageUrl(page)} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">Open in PDF <ExternalLink size={11} className="inline" /></a>
      </div>
      <Card className="p-4">
        {!pages ? <p className="text-sm text-slate-500">Loading page text…</p> : <pre className="source-text font-sans text-xs leading-relaxed text-slate-700">{p?.text}</pre>}
      </Card>
    </div>
  )
}

function Report() {
  const { report } = useData()
  const s = report.summary
  const scalar = Object.entries(s).filter(([, v]) => typeof v === 'number')
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Summary</h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {scalar.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1"><dt className="text-slate-500">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd className="font-medium">{String(v)}</dd></div>
          ))}
        </dl>
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
          {report.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Card>
      {(['errors', 'ambiguities', 'warnings'] as const).map((k) => (
        <Card key={k} className="p-4">
          <h2 className="mb-2 text-sm font-semibold capitalize">{k === 'ambiguities' ? 'Unresolved ambiguities' : k} ({report[k].length})</h2>
          {report[k].length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
            <ul className="max-h-96 space-y-1 overflow-y-auto text-xs">
              {report[k].map((it, i) => (
                <li key={i} className="rounded bg-slate-50 px-2 py-1">
                  <span className="font-mono font-medium">{it.code}</span> {it.message}{' '}
                  {typeof it.id === 'string' && (it.id.startsWith('M-') ? <Link className="text-accent-700 hover:underline" to={`/module/${it.id}`}>{it.id}</Link> : <span className="font-mono">{it.id}</span>)}
                  {typeof it.page === 'number' && <> · <PageRef page={it.page} /></>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Missing module fields</h2>
        <p className="mb-2 text-xs text-slate-500">These fields are absent from the handbook entry itself; the app shows “Not specified in handbook”.</p>
        <ul className="space-y-1 text-xs">
          {Object.entries(report.missingModuleFields).map(([k, v]) => (
            <li key={k}><span className="font-mono">{k}</span>: {v.count} — {v.ids.map((id, i) => <span key={id}>{i ? ', ' : ''}<Link className="text-accent-700 hover:underline" to={`/module/${id}`}>{id}</Link></span>)}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
