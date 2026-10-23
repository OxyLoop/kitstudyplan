// Types mirroring the JSON produced by extraction/extract_handbook.py

export type TermNorm = 'WT' | 'ST' | 'WT+ST' | 'IRREGULAR' | 'SEE_NOTES' | 'UNKNOWN'

export type Subject = 'MATH' | 'CS' | 'SEE' | 'SPEC' | 'HPC_RDM' | 'IQ' | 'THESIS' | 'ADDITIONAL'
export type SpecType = 'MATH' | 'CS' | 'SEE'

export interface Credits {
  raw: string | null
  value: number | null
  min: number | null
  max: number | null
}

export interface TextSection {
  text: string
  page: number | null
}

export interface ComponentRow {
  id: string
  name: string
  termOffered: string
  termNormalized: TermNorm
  credits: string
  creditsParsed: Credits
  lecturers: string
  group: string | null
  notes: string[]
  page: number
}

export interface ComponentGroup {
  label: string
  name: string
  kind: 'mandatory' | 'elective' | 'other'
  constraint: string | null
  page: number
}

export interface Eligibility {
  node: string
  path: string[]
  pathLabel: string
  group: string | null
  groupKind: 'mandatory' | 'elective' | 'other'
  groupConstraint: string | null
  subject: Subject | null
  profile: string | null
  focus: string | null
  specialization: SpecType | null
  page: number
}

export interface PartOf {
  raw: string
  path: string
  group: string | null
  usage: string | null
}

export interface ScheduledCourse {
  componentId: string
  number: string | null
  title: string
  types: string[]
  mode: string | null
}

export interface Module {
  id: string
  number: string
  titleRaw: string
  name: string
  code: string | null
  pages: { start: number; end: number }
  coordinators: string | null
  organisation: string | null
  partOfRaw: string[]
  partOf: PartOf[]
  credits: Credits
  grading: string | null
  recurrence: { raw: string | null; normalized: TermNorm }
  duration: string | null
  language: { raw: string | null; codes: string[] }
  level: string | null
  version: string | null
  otherFields: Record<string, string | null>
  components: ComponentRow[]
  componentGroups: ComponentGroup[]
  sections: Record<string, TextSection>
  sectionOrder: { key: string; heading: string | null; page: number | null }[]
  eligibility: Eligibility[]
  structureListings: {
    node: string
    language: string
    termOffered: string
    termNormalized: TermNorm
    credits: string
    notes: string[]
  }[]
  offering: {
    recurrence: TermNorm
    structureTerms: TermNorm[]
    scheduledWS2026: boolean
    scheduledCoursesWS2026: ScheduledCourse[]
  }
  activityTypes: string[]
}

export interface Course {
  semester: { raw: string; term: 'WT' | 'ST' | null; label: string | null }
  number: string | null
  title: string
  sws: string | null
  typeRaw: string
  types: string[]
  mode: string | null
  lecturers: string | null
  url: string | null
  page: number
}

export interface Excerpt {
  title: string
  meta: string | null
  number: string | null
  semester: { raw: string; term: string | null; label: string | null } | null
  sws: string | null
  language: string | null
  typeRaw: string | null
  format: string | null
  url: string | null
  page: number
  sections: Record<string, TextSection>
}

export interface ModuleComponent {
  id: string
  number: string
  titleRaw: string
  name: string
  pages: { start: number; end: number }
  coordinators: string | null
  organisation: string | null
  partOf: { moduleId: string; moduleName: string }[]
  type: string | null
  credits: Credits
  grading: string | null
  termOffered: { raw: string | null; normalized: TermNorm }
  expansion: string | null
  version: string | null
  otherFields: Record<string, string | null>
  courses: Course[]
  excerpts: Excerpt[]
  sections: Record<string, TextSection>
  sectionOrder: { key: string; heading: string | null; page: number | null }[]
}

export interface StructureEntry {
  moduleId: string | null
  name: string
  language: string | null
  termOffered: string | null
  termNormalized?: TermNorm
  credits: string | null
  creditsParsed: Credits
  notes: string[]
  page: number
  childNode?: boolean
}

export interface StructureGroup {
  label: string | null
  name: string | null
  kind: 'mandatory' | 'elective' | 'other'
  constraint: string | null
  page: number
  entries: StructureEntry[]
}

export interface StructureNode {
  uid: string
  number: string
  title: string
  page: number
  credits: Credits | null
  partOf: string | null
  groups: StructureGroup[]
  electionNotes: string | null
  modeledConditions: string | null
  children: string[]
  parentUid: string | null
  path: string[]
  category: { subject: Subject | null; profile: string | null; focus: string | null; specialization: SpecType | null }
  otherText?: string[]
}

export interface ProgramStructure {
  root: { overview: string[]; children: string[] }
  nodes: StructureNode[]
}

export interface Regulations {
  disclaimer: { page: number; text: string }
  studyPlan: {
    pages: { start: number; end: number }
    chapters: { number: string | null; title: string; page: number; text: string }[]
    imageOnlyContent: { page: number; images: number }[]
    imageNote: string
  }
}

export interface HandbookMeta {
  university: string
  program: string
  regulations: string
  semester: string
  handbookDate: string
  handbookDateRaw: string
  pdf: { file: string; pages: number; sha256: string }
  chapters: { title: string; page: number }[]
  counts: { modules: number; components: number; structureNodes: number }
}

export interface ReportItem {
  code: string
  message: string
  [k: string]: unknown
}

export interface ExtractionReport {
  summary: Record<string, number | Record<string, number> | null>
  missingModuleFields: Record<string, { count: number; ids: string[] }>
  missingComponentFields: Record<string, { count: number; ids: string[] }>
  errors: ReportItem[]
  warnings: ReportItem[]
  ambiguities: ReportItem[]
  notes: string[]
}

export interface Dataset {
  meta: HandbookMeta
  modules: Module[]
  components: ModuleComponent[]
  structure: ProgramStructure
  regulations: Regulations
  report: ExtractionReport
  moduleById: Map<string, Module>
  componentById: Map<string, ModuleComponent>
  nodeByUid: Map<string, StructureNode>
}
