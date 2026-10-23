import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useData } from '../lib/data'
import {
  EMPTY_STATE,
  MAX_COMPARE,
  STORAGE_KEY,
  addExternal,
  addToPlan,
  mergeState,
  removeFromPlan,
  sanitizeState,
  toggleList,
  type AppState,
  type ExternalCourse,
  type PlanEntry,
  type Settings,
  type TimetablePrefs,
} from '../lib/planner'
import type { Module } from '../lib/types'

interface Store {
  state: AppState
  inPlan: (id: string) => boolean
  isSaved: (id: string) => boolean
  inCompare: (id: string) => boolean
  addPlan: (m: Module) => void
  removePlan: (id: string) => void
  updateEntry: (id: string, patch: Partial<PlanEntry>) => void
  setPlanNotes: (s: string) => void
  toggleSaved: (id: string) => void
  toggleCompare: (id: string) => boolean
  setSettings: (s: Partial<Settings>) => void
  replaceState: (s: AppState) => void
  /** Adds entries from another saved plan without touching existing data; returns what was added. */
  mergeIn: (s: unknown) => string[]
  addExternal: (x: ExternalCourse) => void
  updateExternal: (id: string, patch: Partial<ExternalCourse>) => void
  removeExternal: (id: string) => void
  updateTimetable: (fn: (t: TimetablePrefs) => TimetablePrefs) => void
}

const StoreContext = createContext<Store | null>(null)

function load(known: Set<string>): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeState(JSON.parse(raw), known) : EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const known = useMemo(() => new Set(data.modules.map((m) => m.id)), [data])
  const [state, setState] = useState<AppState>(() => load(known))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable (private mode) — state remains in memory */
    }
  }, [state])

  // keep tabs in sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setState(sanitizeState(JSON.parse(e.newValue), known))
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [known])

  const toggleCompare = useCallback(
    (id: string) => {
      let ok = true
      setState((s) => {
        if (!s.compare.includes(id) && s.compare.length >= MAX_COMPARE) {
          ok = false
          return s
        }
        return { ...s, compare: toggleList(s.compare, id, MAX_COMPARE) }
      })
      return ok
    },
    [],
  )

  const store = useMemo<Store>(
    () => ({
      state,
      inPlan: (id) => state.plan.some((e) => e.moduleId === id),
      isSaved: (id) => state.saved.includes(id),
      inCompare: (id) => state.compare.includes(id),
      addPlan: (m) => setState((s) => addToPlan(s, m)),
      removePlan: (id) => setState((s) => removeFromPlan(s, id)),
      updateEntry: (id, patch) =>
        setState((s) => ({ ...s, plan: s.plan.map((e) => (e.moduleId === id ? { ...e, ...patch } : e)) })),
      setPlanNotes: (planNotes) => setState((s) => ({ ...s, planNotes })),
      toggleSaved: (id) => setState((s) => ({ ...s, saved: toggleList(s.saved, id) })),
      toggleCompare,
      setSettings: (patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
      replaceState: (s) => setState(sanitizeState(s, known)),
      mergeIn: (raw) => {
        const incoming = sanitizeState(raw, known)
        const { added } = mergeState(state, incoming)
        setState((cur) => mergeState(cur, incoming).state)
        return added
      },
      addExternal: (x) => setState((s) => addExternal(s, x)),
      updateExternal: (id, patch) =>
        setState((s) => ({ ...s, externals: s.externals.map((x) => (x.id === id ? { ...x, ...patch, completed: false } : x)) })),
      removeExternal: (id) => setState((s) => ({ ...s, externals: s.externals.filter((x) => x.id !== id) })),
      updateTimetable: (fn) => setState((s) => ({ ...s, timetable: fn(s.timetable) })),
    }),
    [state, toggleCompare, known],
  )
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
