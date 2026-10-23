import { Bookmark, BookmarkCheck, CalendarCheck, CalendarPlus, Columns3 } from 'lucide-react'
import { useState } from 'react'
import { MAX_COMPARE } from '../lib/planner'
import type { Module } from '../lib/types'
import { useStore } from '../state/store'
import { Button, cx } from './ui'

export function ModuleActions({ m, compact = false }: { m: Module; compact?: boolean }) {
  const store = useStore()
  const [msg, setMsg] = useState<string | null>(null)
  const planned = store.inPlan(m.id)
  const saved = store.isSaved(m.id)
  const comparing = store.inCompare(m.id)
  const compareFull = !comparing && store.state.compare.length >= MAX_COMPARE
  const size = compact ? 'sm' : 'md'

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size={size}
        variant={planned ? 'secondary' : 'primary'}
        onClick={() => (planned ? store.removePlan(m.id) : store.addPlan(m))}
        title={planned ? 'Remove from WS 2026/27 plan' : 'Add to WS 2026/27 plan'}
        aria-pressed={planned}
      >
        {planned ? <CalendarCheck size={14} /> : <CalendarPlus size={14} />}
        {planned ? 'In semester' : 'Add to semester'}
      </Button>
      <Button
        size={size}
        variant="secondary"
        className={cx(comparing && 'border-accent-500 text-accent-700')}
        disabled={compareFull}
        onClick={() => {
          if (!store.toggleCompare(m.id)) setMsg(`Compare holds up to ${MAX_COMPARE} modules`)
        }}
        title={compareFull ? `Compare holds up to ${MAX_COMPARE} modules — remove one first` : comparing ? 'Remove from comparison' : 'Add to comparison'}
        aria-pressed={comparing}
      >
        <Columns3 size={14} />
        {comparing ? 'Comparing' : 'Compare'}
      </Button>
      <Button
        size={size}
        variant="ghost"
        onClick={() => store.toggleSaved(m.id)}
        title={saved ? 'Remove from saved' : 'Save for later'}
        aria-pressed={saved}
        className={cx(saved && 'text-accent-700')}
      >
        {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
        {saved ? 'Saved' : 'Save'}
      </Button>
      {msg && <span className="text-xs text-amber-700">{msg}</span>}
    </div>
  )
}
