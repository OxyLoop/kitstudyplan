import { languageClass, offerPattern, subjectsOf, winterStatus, isMandatorySomewhere, isResearchProject, type LangClass, type OfferPattern } from './domain'
import type { Module, SpecType, Subject } from './types'

export interface Filters {
  q: string
  semester: 'ws' | 'scheduled' | 'any'
  patterns: OfferPattern[]
  language: 'english-taught' | LangClass | 'any'
  programOnly: boolean
  subjects: Subject[]
  seeProfile: string
  specialization: SpecType | ''
  credits: string // '' = any
  reqType: 'any' | 'mandatory' | 'elective' | 'rosp'
  activity: string[] // includes 'none' for modules without course listing
  savedOnly: boolean
  sort: 'name' | 'ects-asc' | 'ects-desc' | 'id'
}

export const ALL_PATTERNS: OfferPattern[] = ['WT', 'WT+ST', 'ST', 'OTHER']
export const PATTERN_LABEL: Record<OfferPattern, string> = {
  WT: 'Each winter term',
  'WT+ST': 'Winter and summer (each term)',
  ST: 'Summer only',
  OTHER: 'Irregular / unknown',
}

/** Default view: WS 2026/27, English-taught, modules usable in the CDS program. */
export function defaultFilters(preferredLanguage: 'EN' | 'ANY' = 'EN'): Filters {
  return {
    q: '',
    semester: 'ws',
    patterns: [...ALL_PATTERNS],
    language: preferredLanguage === 'EN' ? 'english-taught' : 'any',
    programOnly: true,
    subjects: [],
    seeProfile: '',
    specialization: '',
    credits: '',
    reqType: 'any',
    activity: [],
    savedOnly: false,
    sort: 'name',
  }
}

const PROGRAM_SUBJECTS: Subject[] = ['MATH', 'CS', 'SEE', 'SPEC', 'HPC_RDM', 'IQ']

export function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function searchText(m: Module): string {
  return normalize(
    [m.name, m.id, m.code ?? '', m.coordinators ?? '', m.organisation ?? '', ...m.components.map((c) => `${c.id} ${c.name}`)].join(' '),
  )
}

export function matches(m: Module, f: Filters, ctx: { saved: string[]; index: Map<string, string> }): boolean {
  if (f.q.trim()) {
    const hay = ctx.index.get(m.id) ?? searchText(m)
    const terms = normalize(f.q).split(/\s+/).filter(Boolean)
    if (!terms.every((t) => hay.includes(t))) return false
  }
  const ws = winterStatus(m)
  if (f.semester === 'ws' && ws !== 'scheduled' && ws !== 'recurring') return false
  if (f.semester === 'scheduled' && ws !== 'scheduled') return false
  if (f.patterns.length < ALL_PATTERNS.length && !f.patterns.includes(offerPattern(m))) return false

  const lc = languageClass(m)
  if (f.language === 'english-taught' && lc !== 'EN' && lc !== 'DE/EN') return false
  if (f.language !== 'english-taught' && f.language !== 'any' && lc !== f.language) return false

  const subs = subjectsOf(m)
  if (f.programOnly && !subs.some((s) => PROGRAM_SUBJECTS.includes(s))) return false
  if (f.subjects.length && !f.subjects.some((s) => subs.includes(s))) return false
  if (f.seeProfile && !m.eligibility.some((e) => e.profile === f.seeProfile)) return false
  if (f.specialization && !m.eligibility.some((e) => e.subject === 'SPEC' && e.specialization === f.specialization)) return false
  if (f.credits && String(m.credits.value ?? 'unknown') !== f.credits) return false

  if (f.reqType === 'mandatory' && !isMandatorySomewhere(m)) return false
  if (f.reqType === 'elective' && !m.eligibility.some((e) => e.groupKind === 'elective')) return false
  if (f.reqType === 'rosp' && !isResearchProject(m)) return false

  if (f.activity.length) {
    const types = m.activityTypes.length ? m.activityTypes : ['none']
    if (!f.activity.some((a) => types.includes(a))) return false
  }
  if (f.savedOnly && !ctx.saved.includes(m.id)) return false
  return true
}

export function sortModules(list: Module[], sort: Filters['sort']): Module[] {
  const out = [...list]
  const ects = (m: Module) => m.credits.value ?? -1
  switch (sort) {
    case 'ects-asc':
      return out.sort((a, b) => ects(a) - ects(b) || a.name.localeCompare(b.name))
    case 'ects-desc':
      return out.sort((a, b) => ects(b) - ects(a) || a.name.localeCompare(b.name))
    case 'id':
      return out.sort((a, b) => a.id.localeCompare(b.id))
    default:
      return out.sort((a, b) => a.name.localeCompare(b.name))
  }
}

export function activeFilterCount(f: Filters, def: Filters): number {
  let n = 0
  for (const k of Object.keys(def) as (keyof Filters)[]) {
    if (k === 'sort' || k === 'q') continue
    if (JSON.stringify(f[k]) !== JSON.stringify(def[k])) n++
  }
  return n
}
