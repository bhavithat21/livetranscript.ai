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
