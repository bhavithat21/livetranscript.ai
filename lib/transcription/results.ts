import type { TranscriptEvent, TranscriptPart } from './types'

type ResultMessage = { type?: string; channel?: { alternatives?: Array<{ transcript?: unknown; words?: unknown; confidence?: unknown }> }; start?: unknown; duration?: unknown; is_final?: unknown; transcript?: unknown; words?: unknown; end_of_turn?: unknown; speaker_label?: unknown; turn_order?: unknown }

type Word = { word?: string; text?: string; punctuated_word?: string; start?: number; end?: number; speaker?: number | string; confidence?: number }
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const confidence = (value: unknown): number | undefined => number(value) && value <= 1 ? value : undefined
const comparable = (text: string) => text.toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '')

/** Preserve the provider's whole transcript. Split speakers only when the word
 * sequence accounts for ALL that text; formatted/numeric mismatches abstain.
 * A diarization label is not evidence of someone's identity. */
function partsFor(text: string, words: Word[], unit: number, label: (value: unknown) => number | null): TranscriptPart[] | undefined {
  if (!words.length || words.length > 2000) return
  const tokens = words.map(word => word.punctuated_word ?? word.text ?? word.word ?? '')
  if (tokens.some(token => typeof token !== 'string' || !token) || comparable(tokens.join(' ')) !== comparable(text)) return
  const parts: TranscriptPart[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i], speaker = label(word.speaker)
    if (!number(word.start) || !number(word.end) || word.end < word.start) return
    const previous = parts.at(-1)
    if (previous && previous.speaker === speaker) {
      previous.text += ' ' + tokens[i]; previous.endMs = Math.round(word.end * unit)
    } else parts.push({ text: tokens[i], speaker, startMs: Math.round(word.start * unit), endMs: Math.round(word.end * unit) })
  }
  return parts.length > 1 ? parts : undefined
}
function wordsOf(value: unknown): Word[] {
  return Array.isArray(value) ? value.filter((word): word is Word => !!word && typeof word === 'object') : []
}
export function deepgramResult(data: ResultMessage, stream: string): TranscriptEvent | null {
  const alt = data.channel?.alternatives?.[0]
  if (!alt || typeof alt.transcript !== 'string' || !alt.transcript.trim()) return null
  const words = wordsOf(alt.words), first = words[0], last = words.at(-1)
  const label = (value: unknown) => number(value) && Number.isInteger(value) ? value : null
  const labels = new Set(words.map(word => label(word.speaker)))
  const start = number(first?.start) ? first.start : number(data.start) ? data.start : 0
  const end = number(last?.end) ? last.end : start + (number(data.duration) ? data.duration : 0)
  return {
    text: alt.transcript, isFinal: data.is_final === true,
    speaker: labels.size === 1 ? label(first?.speaker) : null,
    startMs: Math.round(start * 1000), endMs: Math.round(end * 1000),
    ...(number(data.start) ? { utteranceId: `${stream}:${data.start}` } : {}),
    ...(confidence(alt.confidence) !== undefined ? { confidence: confidence(alt.confidence) } : {}),
    ...(data.is_final === true ? { parts: partsFor(alt.transcript, words, 1000, label) } : {}),
  }
}
export function assemblyResult(data: ResultMessage, stream: string, label: (value: unknown) => number | null): TranscriptEvent | null {
  if (data.type !== 'Turn' || typeof data.transcript !== 'string' || !data.transcript.trim()) return null
  const words = wordsOf(data.words), labels = new Set(words.map(word => label(word.speaker)))
  return {
    text: data.transcript, isFinal: data.end_of_turn === true,
    speaker: labels.size > 1 ? null : label(data.speaker_label ?? words[0]?.speaker),
    startMs: number(words[0]?.start) ? words[0].start! : 0,
    endMs: number(words.at(-1)?.end) ? words.at(-1)!.end! : 0,
    ...(number(data.turn_order) && Number.isInteger(data.turn_order) ? { utteranceId: `${stream}:${data.turn_order}` } : {}),
    ...(data.end_of_turn === true ? { parts: partsFor(data.transcript, words, 1, label) } : {}),
  }
}
