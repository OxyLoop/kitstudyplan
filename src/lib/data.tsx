import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type {
  Dataset,
  ExtractionReport,
  HandbookMeta,
  Module,
  ModuleComponent,
  ProgramStructure,
  Regulations,
} from './types'

const DataContext = createContext<Dataset | null>(null)

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status}). Run the extraction first: npm run extract`)
  return res.json() as Promise<T>
}

export function buildDataset(parts: {
  meta: HandbookMeta
  modules: Module[]
  components: ModuleComponent[]
  structure: ProgramStructure
  regulations: Regulations
  report: ExtractionReport
}): Dataset {
  return {
    ...parts,
    moduleById: new Map(parts.modules.map((m) => [m.id, m])),
    componentById: new Map(parts.components.map((c) => [c.id, c])),
    nodeByUid: new Map(parts.structure.nodes.map((n) => [n.uid, n])),
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getJson<HandbookMeta>('handbook.json'),
      getJson<Module[]>('modules.json'),
      getJson<ModuleComponent[]>('module-components.json'),
      getJson<ProgramStructure>('program-structure.json'),
      getJson<Regulations>('regulations.json'),
      getJson<ExtractionReport>('extraction-report.json'),
    ])
      .then(([meta, modules, components, structure, regulations, report]) =>
        setData(buildDataset({ meta, modules, components, structure, regulations, report })),
      )
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error)
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="font-semibold">Handbook data could not be loaded</p>
          <p className="mt-1">{error}</p>
        </div>
      </div>
    )
  if (!data)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading module handbook…</div>
    )
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>
}

export function useData(): Dataset {
  const d = useContext(DataContext)
  if (!d) throw new Error('useData outside DataProvider')
  return d
}

// Verbatim page text is large (≈2 MB) and only needed on demand.
let pagesPromise: Promise<{ page: number; text: string }[]> | null = null
export function loadPages() {
  pagesPromise ??= getJson<{ page: number; text: string }[]>('handbook-pages.json')
  return pagesPromise
}
