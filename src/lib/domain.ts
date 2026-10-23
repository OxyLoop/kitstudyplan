import type { Eligibility, Module, Subject, TermNorm } from './types'

export const NOT_SPECIFIED = 'Not specified in handbook'
export const PDF_URL = `${import.meta.env.BASE_URL}mhb-master-cds.pdf`
export const pdfPageUrl = (page: number) => `${PDF_URL}#page=${page}`
export const sourceLabel = (page: number, end?: number) =>
  `Source: Module Handbook WS 2026/27 — Page ${page}${end && end !== page ? `–${end}` : ''}`

export const SUBJECT_LABEL: Record<Subject, string> = {
  MATH: 'Mathematics for CDS',
  CS: 'Computer Science',
  SEE: 'Sciences, Engineering, Economics',
  SPEC: 'Specialization',
  HPC_RDM: 'Hackathon, HPC & RDM',
  IQ: 'Interdisciplinary Qualifications',
  THESIS: "Master's Thesis",
  ADDITIONAL: 'Additional Examinations',
}

export const SUBJECT_SHORT: Record<Subject, string> = {
  MATH: 'Math',
  CS: 'CS',
  SEE: 'SEE',
  SPEC: 'Spec.',
  HPC_RDM: 'HPC/RDM',
  IQ: 'IQ',
  THESIS: 'Thesis',
  ADDITIONAL: 'Additional',
}

/** Subjects whose credits count for the degree (Additional Examinations do not). */
export const SUBJECT_ORDER: Subject[] = ['MATH', 'CS', 'SEE', 'SPEC', 'HPC_RDM', 'IQ', 'THESIS', 'ADDITIONAL']
export const VARIABLE_SUBJECTS: Subject[] = ['MATH', 'CS', 'SEE', 'SPEC']

export const SEE_PROFILES = [
  'Business and Economics',
  'Computational Chemistry',
  'Computational Earth System Sciences',
  'Computational Mechanics and Thermodynamics',
  'Computational Physics',
  'Electrical Engineering and Information Technology',
  'Process Engineering',
  'Robotics and Autonomous Systems',
] as const

export const EE_FOCI = ['Focus: Information Processing and Transmission', 'Focus: Technologies of Electrical Engineering']

export const SPEC_LABEL = { MATH: 'Mathematics for CDS', CS: 'Computer Science', SEE: 'Sciences, Engineering, Economics (SEE)' }

export const TERM_LABEL: Record<TermNorm, string> = {
  WT: 'Winter term',
  ST: 'Summer term',
  'WT+ST': 'Winter and summer',
  IRREGULAR: 'Irregular',
  SEE_NOTES: 'See handbook notes',
  UNKNOWN: 'Unknown',
}

export function eligibilityLabel(e: Eligibility): string {
  switch (e.subject) {
    case 'MATH':
      return 'Mathematics'
    case 'CS':
      return 'Computer Science'
    case 'SEE':
      return `SEE · ${e.profile ?? '?'}${e.focus ? ` (${e.focus.replace('Focus: ', '')})` : ''}`
    case 'SPEC':
      if (e.specialization === 'SEE')
        return `Spec. SEE · ${e.profile ?? '?'}${e.focus ? ` (${e.focus.replace('Focus: ', '')})` : ''}`
      return `Spec. ${e.specialization === 'MATH' ? 'Mathematics' : 'Computer Science'}`
    case 'HPC_RDM':
      return 'Hackathon, HPC & RDM'
    case 'IQ':
      return 'Interdisciplinary Qualifications'
    case 'THESIS':
      return "Master's Thesis"
    case 'ADDITIONAL':
      return 'Additional Examinations'
    default:
      return e.pathLabel
  }
}

/** Unique, de-duplicated eligibility labels (a module may be listed in several groups of one node). */
export function eligibilityLabels(m: Module): string[] {
  return [...new Set(m.eligibility.map(eligibilityLabel))]
}

export function subjectsOf(m: Module): Subject[] {
  const s = new Set<Subject>()
  m.eligibility.forEach((e) => e.subject && s.add(e.subject))
  return SUBJECT_ORDER.filter((x) => s.has(x))
}

// ------------------------------------------------------------------ offering

export type WinterStatus = 'scheduled' | 'recurring' | 'summer' | 'uncertain'

/**
 * Evidence for Winter Semester 2026/27, strongest first:
 *  scheduled  – a component's course table lists a course for "WT 26/27"
 *  recurring  – module recurrence is "Each winter term" / "Each term", but no WT 26/27 course is listed
 *  summer     – recurrence is summer only and no WT 26/27 course is listed
 *  uncertain  – irregular, "see annotations" or unknown, and no WT 26/27 course is listed
 */
export function winterStatus(m: Module): WinterStatus {
  if (m.offering.scheduledWS2026) return 'scheduled'
  const r = m.recurrence.normalized
  if (r === 'WT' || r === 'WT+ST') return 'recurring'
  if (r === 'ST') return 'summer'
  return 'uncertain'
}

export const WINTER_STATUS_LABEL: Record<WinterStatus, string> = {
  scheduled: 'Course listed for WS 26/27',
  recurring: 'Recurring winter offering',
  summer: 'Summer term only',
  uncertain: 'Irregular / unknown',
}

export const WINTER_STATUS_HELP: Record<WinterStatus, string> = {
  scheduled: 'The handbook lists at least one course for "WT 26/27" in a module component. Exact meeting times are not part of the handbook.',
  recurring: 'The module is offered each winter term (or each term) according to the handbook, but no WS 2026/27 course is listed yet.',
  summer: 'The handbook lists this module as offered each summer term and lists no course for WS 2026/27.',
  uncertain: 'The handbook gives an irregular, unknown or "see annotations" offering and lists no WS 2026/27 course. Do not assume it is available.',
}

export type OfferPattern = 'WT' | 'WT+ST' | 'ST' | 'OTHER'
export function offerPattern(m: Module): OfferPattern {
  const r = m.recurrence.normalized
  if (r === 'WT' || r === 'WT+ST' || r === 'ST') return r
  return 'OTHER'
}

// ------------------------------------------------------------------ language

export type LangClass = 'EN' | 'DE/EN' | 'DE' | 'UNKNOWN'
export function languageClass(m: Module): LangClass {
  const c = m.language.codes
  if (c.includes('EN') && c.includes('DE')) return 'DE/EN'
  if (c.includes('EN')) return 'EN'
  if (c.includes('DE')) return 'DE'
  return 'UNKNOWN'
}
export const LANG_LABEL: Record<LangClass, string> = {
  EN: 'English',
  'DE/EN': 'German/English',
  DE: 'German',
  UNKNOWN: 'Unknown',
}

// ------------------------------------------------------------------ requirement type

export function isMandatorySomewhere(m: Module): boolean {
  return m.eligibility.some((e) => e.groupKind === 'mandatory')
}

export function isResearchProject(m: Module): boolean {
  return m.eligibility.some((e) => /Research Oriented Study Project/i.test(e.group ?? '')) ||
    (m.eligibility.some((e) => e.groupKind === 'mandatory' && e.subject === 'SPEC'))
}

export function isNone(text: string | undefined | null): boolean {
  if (!text) return true
  const t = text.trim().toLowerCase().replace(/[.\s]+$/, '')
  return t === 'none' || t === 'keine' || t === '-' || t === 'no' || t === 'n/a'
}

export function credits(m: Module): number {
  return m.credits.value ?? 0
}

export function fmtEcts(v: number | null | undefined): string {
  if (v === null || v === undefined) return NOT_SPECIFIED
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ECTS`
}
