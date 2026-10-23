import { Info } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, PageRef, StatusBadge, cx } from '../components/ui'
import { useData } from '../lib/data'
import { SPEC_LABEL, SUBJECT_LABEL } from '../lib/domain'
import { ectsSummary } from '../lib/planner'
import { REQUIREMENTS, STATUS_LABEL, STATUS_ORDER, runChecks, variableOverrun, type Status } from '../lib/rules'
import { useStore } from '../state/store'

const RULES: { text: string; pages: number[] }[] = [
  { text: 'Mathematics for CDS, Computer Science, Sciences/Engineering/Economics (SEE) and Specialization each require 16–32 ECTS.', pages: [21, 33] },
  { text: 'The four variable subjects total 80 ECTS. The total may be exceeded only once, by the module that first surpasses the threshold; no modules may be added afterwards.', pages: [18, 21, 22] },
  { text: "Fixed: Master's Thesis 30 ECTS, Hackathon + Distributed Computing (HPC/RDM) 6 ECTS, Interdisciplinary Qualifications 4 ECTS. Degree total 120 ECTS.", pages: [21, 27, 33, 66] },
  { text: 'Exactly one SEE profile may be attended. It is fixed at the first examination registration in the profile.', pages: [23, 38] },
  { text: 'The specialization is Mathematics for CDS, Computer Science or SEE. An SEE specialization must continue the SEE profile (and EE&IT focus).', pages: [25, 26] },
  { text: 'Specialization Mathematics: a mathematical seminar (3 ECTS, ungraded) is mandatory.', pages: [25, 47] },
  { text: 'Specialization Computer Science: one seminar module and one lab course module (Research Oriented Study Project).', pages: [26, 50] },
  { text: 'SEE specializations have profile-specific mandatory seminars, lab courses or research projects.', pages: [26, 27, 53] },
  { text: 'A module eligible in several subjects may be attended only once; assignment to a subject becomes binding at exam registration.', pages: [22, 25] },
  { text: 'Modules from other degree programs may be approved by the Examination Committee on request.', pages: [22] },
]

export default function Requirements() {
  const data = useData()
  const { state } = useStore()
  const checks = useMemo(() => runChecks(state, data), [state, data])
  const summary = ectsSummary(state.plan, data.moduleById, state.externals)
  const over = variableOverrun(state.plan, data, 0, state.externals)
  const degree = checks.filter((c) => c.scope === 'degree')
  const semesterIssues = checks.filter((c) => c.scope === 'semester' && c.status !== 'valid')
  const s = state.settings

  return (
    <div className="space-y-5">
      <PageHeader
        title="Degree Requirements"
        subtitle="A lightweight rules check of your planned modules against the CDS study plan (SPO 2026). Planning aid only — it does not grant any official approval."
      />

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <div><span className="text-slate-500">SEE profile:</span> <span className="font-medium">{s.seeProfile ?? 'Not selected'}</span>{s.eeFocus && <span className="text-slate-500"> ({s.eeFocus.replace('Focus: ', '')})</span>}</div>
        <div><span className="text-slate-500">Specialization:</span> <span className="font-medium">{s.specialization ? SPEC_LABEL[s.specialization] : 'Not selected'}</span></div>
        <Link to="/settings" className="text-accent-700 hover:underline">Change in Settings</Link>
      </Card>

      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
        {STATUS_ORDER.map((st) => (
          <span key={st} className="inline-flex items-center gap-1"><StatusBadge status={st} /> {legend(st)}</span>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
            <tr>
              <th className="p-3 font-medium">Subject</th>
              <th className="p-3 font-medium">Required</th>
              <th className="p-3 font-medium">Planned (WS 26/27)</th>
              <th className="p-3 font-medium">Progress</th>
              <th className="p-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {REQUIREMENTS.map((r) => {
              const v = summary.bySubject[r.subject]
              const pct = Math.min(100, (v / r.min) * 100)
              return (
                <tr key={r.subject} className="border-b border-slate-100 last:border-b-0">
                  <td className="p-3 font-medium text-slate-800">{SUBJECT_LABEL[r.subject]}</td>
                  <td className="p-3 text-slate-600">{r.min === r.max ? r.min : `${r.min}–${r.max}`} ECTS</td>
                  <td className={cx('p-3', v > r.max ? 'font-semibold text-red-700' : 'text-slate-800')}>{v} ECTS{summary.unverifiedBySubject[r.subject] > 0 && <span className="block text-xs text-amber-700">incl. {summary.unverifiedBySubject[r.subject]} pending recognition</span>}</td>
                  <td className="p-3">
                    <div className="h-1.5 w-32 overflow-hidden rounded bg-slate-100">
                      <div className={cx('h-full', v > r.max ? 'bg-red-500' : 'bg-accent-500')} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td className="p-3"><PageRef page={r.page} /></td>
                </tr>
              )
            })}
            <tr className="bg-slate-50">
              <td className="p-3 font-medium">Variable subjects total</td>
              <td className="p-3 text-slate-600">80 ECTS (one final overrun permitted)</td>
              <td className="p-3">{over.total} ECTS</td>
              <td className="p-3 text-xs text-slate-500">{over.overrunModule ? `Overrun by ${data.moduleById.get(over.overrunModule)?.name}` : ''}</td>
              <td className="p-3"><PageRef page={21} /></td>
            </tr>
          </tbody>
        </table>
      </Card>

      {semesterIssues.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Issues in the current WS 2026/27 plan</h2>
          <p className="text-xs text-slate-500">Details are in the <Link to="/planner" className="text-accent-700 hover:underline">planner</Link>.</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {STATUS_ORDER.map((st) => {
              const n = semesterIssues.filter((c) => c.status === st).length
              return n ? <span key={st} className="inline-flex items-center gap-1"><StatusBadge status={st} /> {n}</span> : null
            })}
          </div>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Requirement checks</h2>
        <div className="grid gap-2">
          {[...degree].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)).map((c) => (
            <Card key={c.id} className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <StatusBadge status={c.status} />
                  <span className="text-sm font-medium text-slate-800">{c.title}</span>
                </div>
                <span className="flex gap-1.5">{c.pages.map((p) => <PageRef key={p} page={p} />)}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{c.detail}</p>
            </Card>
          ))}
        </div>
      </section>

      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Info size={15} /> Rules implemented (from the handbook)</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
          {RULES.map((r) => (
            <li key={r.text} className="flex gap-2">
              <span className="text-slate-300">•</span>
              <span>{r.text} <span className="whitespace-nowrap">{r.pages.map((p) => <PageRef key={p} page={p} />).reduce<ReactNode[]>((a, x, i) => (i ? [...a, ', ', x] : [x]), [])}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Full text of the study plan and the program structure: <Link to="/handbook" className="text-accent-700 hover:underline">Handbook &amp; Data</Link>. Tables 1–5 of the study plan are images in the PDF (pages 21, 29–32) and are available via the page links only.
        </p>
      </Card>
    </div>
  )
}

function legend(s: Status) {
  return {
    valid: 'met by the plan',
    incomplete: 'not yet met',
    conflict: 'likely violates a rule',
    approval: 'needs department / committee approval',
    unverifiable: 'cannot be checked from the handbook',
  }[s] ?? STATUS_LABEL[s]
}
