import type { ResultMessage, Word } from './results'

/** SpeakerRevision is not a transcript revision. Accept labels only when the
 * cached final turn and exact word timing/text agree; never import new content. */
export function reviseSpeakers(original: ResultMessage, value: unknown): ResultMessage | null {
  if (!value || typeof value !== 'object' || original.end_of_turn !== true) return null
  const revision = value as Record<string, unknown>
  if (revision.turn_order !== original.turn_order) return null
  const validLabel = (label: unknown) => typeof label === 'string' && label.length <= 32 || typeof label === 'number' && Number.isInteger(label) && label >= 0
  if (!validLabel(revision.speaker_label)) return null
  if (!Array.isArray(original.words) || !Array.isArray(revision.words) || original.words.length !== revision.words.length || original.words.length > 2000) return null
  const words: Word[] = []
  for (let i = 0; i < original.words.length; i++) {
    const old = original.words[i] as Word, next = revision.words[i] as Word | null
    if (!old || !next || typeof next !== 'object' || old.text !== next.text || old.start !== next.start || old.end !== next.end) return null
    if (next.speaker !== undefined && !validLabel(next.speaker)) return null
    words.push({ ...old, ...(next.speaker === undefined ? {} : { speaker: next.speaker }) })
  }
  return { ...original, speaker_label: revision.speaker_label, words }
}
