import { BookOpen, CalendarRange, Columns3, GraduationCap, LayoutGrid, Settings } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useData } from '../lib/data'
import { ectsSummary } from '../lib/planner'
import { useStore } from '../state/store'
import { cx } from './ui'

export function Layout() {
  const { meta, moduleById } = useData()
  const { state } = useStore()
  const ects = ectsSummary(state.plan, moduleById, state.externals).total

  const main = [
    { to: '/', label: 'Module Explorer', icon: LayoutGrid, end: true },
    { to: '/compare', label: 'Compare Modules', icon: Columns3, badge: state.compare.length || undefined },
    { to: '/planner', label: 'Winter Semester Planner', icon: CalendarRange, badge: state.plan.length || state.externals.length ? `${ects} ECTS` : undefined },
    { to: '/requirements', label: 'Degree Requirements', icon: GraduationCap },
  ]
  const secondary = [
    { to: '/handbook', label: 'Handbook & Data', icon: BookOpen },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  const link = (mobile: boolean) =>
    ({ isActive }: { isActive: boolean }) =>
      cx(
        'flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors',
        mobile ? 'shrink-0 px-2.5 py-1.5' : 'px-2.5 py-2',
        isActive ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )

  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-accent-500 text-[11px] font-bold text-white">CDS</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">CDS Study Planner</div>
            <div className="text-xs text-slate-500">M.Sc. · SPO 2026 · WS 26/27</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
          {main.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link(false)}>
              <n.icon size={17} aria-hidden />
              <span className="flex-1">{n.label}</span>
              {n.badge !== undefined && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{n.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mx-4 my-3 border-t border-slate-100" />
        <nav className="flex flex-col gap-0.5 px-3" aria-label="Secondary">
          {secondary.map((n) => (
            <NavLink key={n.to} to={n.to} className={link(false)}>
              <n.icon size={17} aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-4 py-4 text-xs leading-relaxed text-slate-400">
          Data: {meta.program}, Module Handbook as of 20/10/2026 ({meta.pdf.pages} pages).
          <br />
          Planning aid only — not an official enrollment or approval.
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <div className="grid h-7 w-7 place-items-center rounded bg-accent-500 text-[10px] font-bold text-white">CDS</div>
          <span className="text-sm font-semibold">CDS Study Planner</span>
          <span className="ml-auto text-xs text-slate-500">WS 26/27</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {[...main, ...secondary].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={link(true)}>
              <n.icon size={15} aria-hidden />
              {n.label.replace('Winter Semester ', '').replace(' Modules', '').replace('Module ', '')}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
