import { ChevronRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LANG_LABEL, eligibilityLabels, fmtEcts, languageClass, winterStatus } from '../lib/domain'
import { slotValid } from '../lib/planner'
import type { Module } from '../lib/types'
import { useStore } from '../state/store'
import { ModuleActions } from './ModuleActions'
import { Badge, Card, WinterBadge } from './ui'

export function ModuleCard({ m }: { m: Module }) {
  const store = useStore()
  const labels = eligibilityLabels(m)
  const status = [
    store.inPlan(m.id) && 'In WS 26/27 plan',
    store.inCompare(m.id) && 'In comparison',
    store.isSaved(m.id) && 'Saved',
  ].filter(Boolean) as string[]
  const myTimes = store.state.plan.find((e) => e.moduleId === m.id)?.times.filter(slotValid) ?? []

  return (
    <Card className="p-4 transition-shadow hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <Link to={`/module/${m.id}`} className="group inline-flex items-start gap-1 text-[15px] font-semibold leading-snug text-slate-900 hover:text-accent-700">
            <span>{m.name}</span>
            <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-accent-600" aria-hidden />
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span className="font-mono">{m.id}</span>
            {m.code && <span className="font-mono text-slate-400">{m.code}</span>}
            {m.organisation && <span className="min-w-0 truncate">{m.organisation.replace(/^KIT Department of /, '')}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-900">{fmtEcts(m.credits.value)}</div>
          {status.length > 0 && <div className="text-xs font-medium text-accent-700">{status.join(' · ')}</div>}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <WinterBadge status={winterStatus(m)} />
        <Badge title={`Recurrence: ${m.recurrence.raw ?? 'Not specified in handbook'}`}>{m.recurrence.raw ?? 'Recurrence not specified'}</Badge>
        <Badge title={`Language: ${m.language.raw ?? 'Not specified in handbook'}`}>{LANG_LABEL[languageClass(m)]}</Badge>
        {m.activityTypes.slice(0, 3).map((t) => (
          <Badge key={t} tone="slate">{t}</Badge>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {labels.slice(0, 5).map((l) => (
          <span key={l} className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200 ring-inset">{l}</span>
        ))}
        {labels.length > 5 && <span className="text-xs text-slate-400">+{labels.length - 5} more</span>}
      </div>

      {myTimes.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <Clock size={12} className="text-slate-400" aria-hidden />
          <span className="text-slate-500">Your times:</span>
          {myTimes.map((t) => (
            <span key={t.id} className="rounded bg-accent-50 px-1.5 py-0.5 font-medium text-accent-700">{t.day} {t.start}–{t.end}</span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <Link to={`/module/${m.id}`} className="text-sm font-medium text-accent-700 hover:underline">
          View details
        </Link>
        <ModuleActions m={m} compact />
      </div>
    </Card>
  )
}
