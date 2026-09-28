import type { DialogueTurn } from './types'
import { integer, object, text, redactSecrets } from './validation'

export function parseDialogueTurn(raw: unknown): DialogueTurn {
  const turn = object(raw, ['sourceId', 'at', 'role', 'text'])
  if (!['interviewer', 'candidate', 'unknown'].includes(String(turn.role))) throw new Error('Unknown dialogue role')
  return { sourceId: text(turn.sourceId, 120, true), at: integer(turn.at), role: turn.role as DialogueTurn['role'], text: redactSecrets(text(turn.text, 1000, true)) }
}

/** Revisions replace the same utterance rather than creating another turn.
 * A spoken claim is never source code, a test result, or permission to implement. */
export function updateDialogue(current: DialogueTurn[], raw: DialogueTurn): DialogueTurn[] {
  const turn = parseDialogueTurn(raw)
  const old = current.find(item => item.sourceId === turn.sourceId)
  if (old && old.at === turn.at && old.role === turn.role && old.text === turn.text) return current
  return [...current.filter(item => item.sourceId !== turn.sourceId), turn].sort((a,b) => a.at-b.at).slice(-24)
}

export function dialogueContext(turns: DialogueTurn[]): DialogueTurn[] {
  return turns.slice(-8).map(turn => ({ ...turn, text: turn.text.slice(-400) }))
}

/** Retain spoken goals/proposals after they leave the short conversation window.
 * These are verbatim, attributed discussion, never verified facts or permission.
 * Keep the opening goal and the latest revisions; do not summarize with a model
 * on the latency-critical path or feed the assistant's own answers back as fact. */
export function updateDiscussion(current: DialogueTurn[], raw: DialogueTurn): DialogueTurn[] {
  const turn = parseDialogueTurn(raw)
  const relevant = turn.role !== 'unknown' && /\b(?:(?:we|you|i|it)\s+(?:must|need|want|should|could|can|will|would|have to)|let['’]s|instead|rather than|in the background|job\s*(?:id|identifier)|(?:return|respond|send|persist|store|enqueue|limit|keep|use|avoid|preserve|don't|do not|cannot|can't)\b)/i.test(turn.text)
  const old = current.find(item => item.sourceId === turn.sourceId)
  if (relevant && old?.text === turn.text && old.role === turn.role && old.at === turn.at) return current
  if (!relevant && !old) return current
  const next = [...current.filter(item => item.sourceId !== turn.sourceId), ...(relevant ? [turn] : [])].sort((a, b) => a.at - b.at)
  // Prefer recent decisions when capacity is exhausted, preserving the first goal.
  while (next.length > 8 || next.reduce((size, item) => size + JSON.stringify(item).length, 0) > 3600) next.splice(next.length > 2 ? 1 : 0, 1)
  if (next.length === current.length && next.every((item, index) => item.sourceId === current[index].sourceId && item.at === current[index].at && item.role === current[index].role && item.text === current[index].text)) return current
  return next
}
