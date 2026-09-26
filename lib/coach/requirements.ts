import type { DialogueTurn } from './types'
import { parseDialogueTurn } from './dialogue'

/** A conservative, deterministic directive recognizer, not a semantic oracle.
 * Keep source words/negation. Ambiguous corrections request clarification; they
 * never silently delete another requirement. Candidate/unknown speech is inert.
 */
export type RequirementInput = DialogueTurn
export type SpokenRequirement = { sourceId: string; at: number; text: string }
export type RequirementProjection = { active: SpokenRequirement[]; pending: SpokenRequirement[] }
type Directive = { kind: 'set' | 'replace' | 'retract' | 'last' | 'ambiguous'; value: string; target?: string }
export const REQUIREMENT_LIMIT = 160
const clean = (s: string) => s.replaceAll('’', "'").trim().replace(/\s+/g, ' ')
const bare = (s: string) => clean(s).replace(/^(?:(?:okay|ok|so|and|now|actually|please|instead)[,:]?\s+)+/i, '').replace(/[.!]+$/, '')
const key = (s: string) => bare(s).toLowerCase()
const speculative = /^(?:maybe|perhaps|what if|could |can |would |should |i (?:think|wonder|might|could)|we (?:could|might)|suppose|imagine|the (?:candidate|prompt|readme|comment|example) (?:says|said|asks)|(?:he|she|they) (?:said|asked))\b/i
const incomplete = /\b(?:allow|add|remove|use|keep|must|should|not|no|to|for|the|a|an|and|or|with|without|instead of|need|needs|have|be|can now)\s*[.!]?$/i
export function requirementDirective(raw: string): Directive | null {
  const s = bare(raw)
  if (!s || /[?]/.test(s) || speculative.test(s) || /^(?:["“'`]|(?:you (?:said|asked)|i (?:said|asked))\b)/i.test(s)) return null
  // Reported speech and source comments cannot grant task authority.
  if (/\b(?:the (?:comment|readme|candidate) says|quote|for example)\b/i.test(s)) return null
  if (/^(?:retract|drop|ignore|cancel|forget) (?:that |the |my )?(?:last|previous) (?:requirement|instruction|change)$|^never mind (?:the |that )last (?:requirement|change)$/i.test(s)) return { kind: 'last', value: s }
  if (/^(?:never mind|ignore that|scratch that|forget that|cancel that)$/i.test(s)) return { kind: 'ambiguous', value: s }
  const replacement = s.match(/^replace (?:the requirement\s+)?["“]?(.+?)["”]? with ["“]?(.+?)["”]?$/i)
  if (replacement) return { kind: 'replace', target: replacement[1], value: replacement[2] }
  const retract = s.match(/^(?:retract|drop|ignore|cancel|forget) (?:the requirement (?:that |to )?)?(.+)$/i)
  if (retract) return { kind: 'retract', value: s, target: retract[1] }
  if (incomplete.test(s)) return null
  const directive = /^(?:(?:do not|don't|never)\s+)?(?:allow|disallow|add|remove|support|use|keep|preserve|limit|restrict|accept|reject|enable|disable|avoid|ensure|make|handle|include|exclude|return|prevent)\b/i.test(s)
    || /^(?:we|i) (?:now )?(?:need|want|require)\b|^the (?:requirement|task|goal) (?:is|has changed)\b|^your task is\b/i.test(s)
    || /\b(?:must(?: not)?|shall(?: not)?|should(?: not)?|can now|needs? to|is now required to)\b/i.test(s)
  if (!directive) return null
  if (s.split(/\s+/).length < 3) return null
  return { kind: 'set', value: s }
}
// Only near-exact topic matches may replace a prior statement automatically.
// This intentionally does not guess that 'eight directions' means 'diagonals'.
function topic(s: string): string[] {
  return key(s).replace(/\b(?:do not|don't|not|never|allow|disallow|enable|disable|must|shall|should|can|now|need|needs|to|we|i|want|require|be|the|a|an|is|are|use|keep|ensure|add|remove|include|exclude|instead)\b/g, ' ').match(/[a-z0-9]+/g) ?? []
}
function targetMatches(active: SpokenRequirement[], target: string): SpokenRequirement[] {
  const t = key(target), words = topic(target)
  if (words.length < 2) return active.filter(r => key(r.text) === t)
  return active.filter(r => key(r.text) === t || key(r.text).includes(t) || (topic(r.text).join(' ') === words.join(' ')))
}
export function projectRequirements(inputs: RequirementInput[]): RequirementProjection {
  const active: SpokenRequirement[] = [], pending: SpokenRequirement[] = []
  for (const input of inputs) {
    if (input.role !== 'interviewer') continue
    const d = requirementDirective(input.text)
    if (!d) continue
    const record = { sourceId: input.sourceId, at: input.at, text: d.value }
    if (d.kind === 'ambiguous') { pending.push(record); continue }
    if (d.kind === 'last') {
      if (active.length) active.pop(); else pending.push(record)
      continue
    }
    const matches = d.kind === 'set' ? targetMatches(active, d.value) : targetMatches(active, d.target ?? '')
    if (d.kind !== 'set' && matches.length !== 1) { pending.push({ ...record, text: input.text }); continue }
    if (d.kind === 'set' && active.some(r => key(r.text) === key(d.value))) continue
    if (d.kind === 'set' && matches.length > 1) { pending.push(record); continue }
    if (matches.length === 1) active.splice(active.indexOf(matches[0]), 1)
    if (d.kind !== 'retract') active.push(record)
  }
  return { active, pending }
}
export function updateRequirementInputs(current: RequirementInput[], raw: RequirementInput): RequirementInput[] {
  const input = parseDialogueTurn(raw)
  const index = current.findIndex(item => item.sourceId === input.sourceId)
  if (index < 0 && (input.role !== 'interviewer' || !requirementDirective(input.text))) return current
  const old = current[index]
  // at is original capture time, never a revision arrival timestamp.
  if (old && input.at < old.at) return current
  if (old && old.at === input.at && old.text === input.text && old.role === input.role) return current
  if (index < 0 && current.length >= REQUIREMENT_LIMIT) throw new Error('Spoken requirement history is full. Pause and start a narrower session; active requirements were not discarded.')
  const next = current.slice()
  if (index < 0) next.push(input); else next[index] = { ...input, at: old.at }
  return next.sort((a,b) => a.at - b.at)
}
/** Join only unfinished fragments from the same identified source/channel. */
export function groupRequirementTurns(turns: DialogueTurn[]): RequirementInput[] {
  const groups: RequirementInput[] = []
  for (const turn of turns) {
    const prev = groups.at(-1)
    const channel = (id: string) => id.split(':')[0]
    if (prev && prev.role === turn.role && channel(prev.sourceId) === channel(turn.sourceId) && turn.at - prev.at <= 6000 && !/[.!?]$/.test(prev.text) && prev.text.length + turn.text.length < 1000) prev.text += ' ' + turn.text
    else groups.push({ ...turn })
  }
  return groups
}
