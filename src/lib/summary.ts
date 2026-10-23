/**
 * Deterministic, template-based plain-language summary built only from extracted fields.
 * No generative text: every statement maps to a handbook field, and missing facts are
 * reported as "not specified".
 */
import { LANG_LABEL, TERM_LABEL, eligibilityLabels, isNone, languageClass, winterStatus, WINTER_STATUS_LABEL } from './domain'
import type { Dataset, Module } from './types'

export interface SummaryLine {
  label: string
  text: string
}

export function moduleSummary(m: Module, d: Dataset): { lead: string; lines: SummaryLine[]; firstGoal: string | null } {
  const ects = m.credits.value !== null ? `${m.credits.value}-ECTS` : 'Module'
  const grading = m.grading ? `${m.grading} ` : ''
  const lang = m.language.raw ? `taught in ${LANG_LABEL[languageClass(m)]}` : 'with language not specified in the handbook'
  const rec = m.recurrence.raw ? m.recurrence.raw.toLowerCase() : 'with no recurrence specified'
  const dur = m.duration ? ` and lasts ${m.duration}` : ''
  const lead = `${ects} ${grading}module ${lang}. It is offered ${rec}${dur}.`

  const comps = m.components.map((c) => d.componentById.get(c.id))
  const assessTypes = [...new Set(comps.map((c) => c?.type).filter(Boolean))] as string[]
  const lines: SummaryLine[] = []
  lines.push({
    label: 'WS 2026/27',
    text:
      winterStatus(m) === 'scheduled'
        ? `${WINTER_STATUS_LABEL.scheduled}: ${m.offering.scheduledCoursesWS2026.map((c) => c.title).filter((v, i, a) => a.indexOf(v) === i).join('; ')}`
        : WINTER_STATUS_LABEL[winterStatus(m)],
  })
  if (winterStatus(m) === 'scheduled' && m.recurrence.normalized !== 'WT' && m.recurrence.normalized !== 'WT+ST')
    lines.push({
      label: 'Note',
      text: `The module recurrence is "${m.recurrence.raw ?? 'not specified'}" although a WT 26/27 course is listed — verify the actual winter offering.`,
    })
  lines.push({
    label: 'Structure',
    text: m.components.length
      ? `${m.components.length} module component${m.components.length > 1 ? 's' : ''}${assessTypes.length ? ` — ${assessTypes.join(', ').toLowerCase()}` : ''}.`
      : 'No module components listed.',
  })
  lines.push({ label: 'Counts towards', text: eligibilityLabels(m).join('; ') || 'Not specified in handbook' })
  const pre = m.sections.prerequisites?.text
  lines.push({
    label: 'Prerequisites',
    text: !pre ? 'Not specified in handbook' : isNone(pre) ? 'None' : 'Yes — see Prerequisites below',
  })
  if (m.recurrence.normalized !== 'UNKNOWN' && m.offering.structureTerms.length) {
    const st = m.offering.structureTerms.map((t) => TERM_LABEL[t]).join(', ')
    lines.push({ label: 'Program table', text: `Listed as: ${st}` })
  }

  // first sentence of the competence goal, quoted verbatim
  const goal = m.sections.competenceGoal?.text ?? null
  let firstGoal: string | null = null
  if (goal && !isNone(goal)) {
    const flat = goal.replace(/\s+/g, ' ').trim()
    const mm = /^(.{40,320}?[.!?])(\s|$)/.exec(flat)
    firstGoal = mm ? mm[1] : flat.slice(0, 320) + (flat.length > 320 ? '…' : '')
  }
  return { lead, lines, firstGoal }
}
