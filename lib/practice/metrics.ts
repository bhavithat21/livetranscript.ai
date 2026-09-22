import type { DeliveryMetrics, PracticeSession } from './types'

const PHRASES = [
  { phrase: 'um', contextual: false }, { phrase: 'uh', contextual: false },
  { phrase: 'erm', contextual: false }, { phrase: 'er', contextual: false },
  { phrase: 'like', contextual: true }, { phrase: 'you know', contextual: true },
  { phrase: 'I mean', contextual: true },
] as const

/** Transcript-derived counts, not a judgment of fluency or speech quality. */
export function deliveryMetrics(text: string, activeMs: number, source: DeliveryMetrics['source']): DeliveryMetrics {
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0
  const duration = Number.isFinite(activeMs) && activeMs > 0 ? Math.round(activeMs) : 0
  return {
    source, words, activeMs: source === 'microphone' ? duration : 0,
    approximateWpm: source === 'microphone' && duration >= 1000 && words > 0 ? Math.round(words * 60_000 / duration) : null,
    fillers: PHRASES.map(({ phrase, contextual }) => ({
      phrase, contextual,
      count: [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replaceAll(' ', '\\s+')}(?![\\p{L}\\p{N}])`, 'giu'))].length,
    })).filter(({ count }) => count > 0),
  }
}

/** Only the actual listening intervals contribute; setup, feedback and pauses do not. */
export class AnswerClock {
  private started: number | null = null
  private accumulated = 0
  start(now: number): void { if (this.started === null && Number.isFinite(now)) this.started = now }
  pause(now: number): void {
    if (this.started !== null) {
      this.accumulated += Math.max(0, now - this.started)
      this.started = null
    }
  }
  elapsed(now: number): number { return this.accumulated + (this.started === null ? 0 : Math.max(0, now - this.started)) }
  reset(): void { this.started = null; this.accumulated = 0 }
}

export function practiceReportText(session: PracticeSession): string {
  const lines = [
    `Practice interview: ${session.role}`, `Type: ${session.kind}`, `Coach model: ${session.model}`,
    'AI coaching only. Rubric scores are estimates, not a validated hiring or technical assessment.', '',
  ]
  for (const [index, turn] of session.turns.entries()) {
    lines.push(`Question ${index + 1}: ${turn.question}`, '', `Your answer: ${turn.answer}`, '', turn.feedback.summary)
    for (const item of turn.feedback.rubric) lines.push(`${item.criterion}: ${item.score === null ? 'Not enough evidence' : `${item.score}/5 (AI estimate)`}`, item.evidence ? `Evidence: “${item.evidence}”` : 'No supporting passage identified.', `Try: ${item.suggestion}`)
    lines.push(`Strength: ${turn.feedback.strength}`, `Next step: ${turn.feedback.nextStep}`)
    const metrics = turn.metrics
    lines.push(`Delivery: ${metrics.words} transcript words${metrics.approximateWpm === null ? '' : `, approximately ${metrics.approximateWpm} words/minute over ${(metrics.activeMs / 1000).toFixed(1)} seconds of microphone listening`}.`)
    if (metrics.fillers.length) lines.push(`Phrase counts: ${metrics.fillers.map((item) => `${item.phrase} (${item.count})`).join(', ')}. Context-dependent phrases are not necessarily fillers.`)
    lines.push('')
  }
  if (session.report) {
    lines.push('Session review', session.report.summary, '')
    for (const item of session.report.highlights) lines.push(`Question ${item.turn}: “${item.quote}” — ${item.observation}`)
    lines.push('', 'Practice next', ...session.report.practiceNext.map((item) => `- ${item}`))
  }
  return lines.join('\n')
}
