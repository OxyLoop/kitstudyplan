import { AlertTriangle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, PageHeader } from '../components/ui'
import { useData } from '../lib/data'
import { EE_FOCI, SEE_PROFILES, SPEC_LABEL, SUBJECT_LABEL } from '../lib/domain'
import { EMPTY_STATE, assignmentOptions, type Settings } from '../lib/planner'
import { useStore } from '../state/store'

export default function SettingsPage() {
  const data = useData()
  const store = useStore()
  const s = store.state.settings
  const [pending, setPending] = useState<{ patch: Partial<Settings>; affected: { id: string; name: string; reason: string }[] } | null>(null)

  /** Apply a profile-related change, warning first if planned modules lose eligibility. Nothing is deleted. */
  const change = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch }
    const affected = store.state.plan.flatMap((e) => {
      const m = data.moduleById.get(e.moduleId)
      if (!m || !e.category) return []
      const before = assignmentOptions(m, s).find((o) => o.subject === e.category)
      const after = assignmentOptions(m, next).find((o) => o.subject === e.category)
      return before?.valid !== false && after && !after.valid
        ? [{ id: m.id, name: m.name, reason: `${SUBJECT_LABEL[e.category]}: ${after.reason ?? 'not eligible'}` }]
        : []
    })
    if (affected.length) setPending({ patch, affected })
    else store.setSettings(patch)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Settings" subtitle="Stored locally in this browser. Changing settings never deletes planned modules." />

      <Card className="divide-y divide-slate-100">
        <Row label="Current semester" hint="This planner is for the handbook dated 20/10/2026.">
          <span className="text-sm font-medium">Winter Semester 2026/27</span>
        </Row>
        <Row label="Preferred language" hint="Sets the default language filter in the Module Explorer.">
          <select value={s.preferredLanguage} onChange={(e) => store.setSettings({ preferredLanguage: e.target.value as Settings['preferredLanguage'] })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="EN">English</option>
            <option value="ANY">No preference</option>
          </select>
        </Row>
        <Row label="Preferred SEE profile" hint="Exactly one SEE profile may be attended (study plan p. 23).">
          <select value={s.seeProfile ?? ''} onChange={(e) => change({ seeProfile: e.target.value || null, eeFocus: null })} className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">Not selected</option>
            {SEE_PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Row>
        {s.seeProfile === 'Electrical Engineering and Information Technology' && (
          <Row label="EE&IT focus" hint="All modules must be chosen from the same focus (p. 25).">
            <select value={s.eeFocus ?? ''} onChange={(e) => change({ eeFocus: e.target.value || null })} className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
              <option value="">Not selected</option>
              {EE_FOCI.map((f) => <option key={f} value={f}>{f.replace('Focus: ', '')}</option>)}
            </select>
          </Row>
        )}
        <Row label="Intended specialization" hint="Mathematics, Computer Science or SEE (same profile as your SEE subject).">
          <select value={s.specialization ?? ''} onChange={(e) => change({ specialization: (e.target.value || null) as Settings['specialization'] })} className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">Not selected</option>
            {(['MATH', 'CS', 'SEE'] as const).map((k) => <option key={k} value={k}>{SPEC_LABEL[k]}</option>)}
          </select>
        </Row>
        <Row label="Target semester ECTS" hint="Optional. The study plan suggests about 30 ECTS per semester.">
          <input
            type="number"
            min={1}
            max={60}
            value={s.targetEcts ?? ''}
            onChange={(e) => store.setSettings({ targetEcts: e.target.value ? Math.max(1, Math.min(60, Number(e.target.value))) : null })}
            placeholder="e.g. 30"
            className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </Row>
      </Card>

      {pending && (
        <div role="alertdialog" aria-labelledby="warn-title" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 id="warn-title" className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={16} /> Some planned modules may become ineligible</h2>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {pending.affected.map((a) => <li key={a.id}><Link className="underline" to={`/module/${a.id}`}>{a.name}</Link> — {a.reason}</li>)}
          </ul>
          <p className="mt-2 text-xs text-amber-800">The modules stay in your plan; they will be flagged so you can reassign or remove them.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => { store.setSettings(pending.patch); setPending(null) }}>Apply change</Button>
            <Button onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Data on this device</h2>
        <p className="mt-1 text-sm text-slate-600">
          {store.state.plan.length} planned modules, {store.state.externals.length} external course(s), {store.state.saved.length} saved, {store.state.compare.length} in comparison. Use Export in the planner for a backup.
        </p>
        <Button
          variant="danger"
          size="sm"
          className="mt-3"
          onClick={() => {
            if (confirm('Delete your plan, saved modules, comparison and settings from this browser? This cannot be undone.')) store.replaceState(EMPTY_STATE)
          }}
        >
          Clear all local data
        </Button>
      </Card>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-[14rem_1fr] sm:items-center">
      <div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}
