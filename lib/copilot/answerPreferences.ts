export const ANSWER_FORMATS = ['keywords', 'concise', 'detailed'] as const
export const ANSWER_TONES = ['collaborative', 'technical', 'strategic'] as const

export type AnswerPreferences = {
  format: typeof ANSWER_FORMATS[number]
  tone: typeof ANSWER_TONES[number]
  followups: boolean
}

export const DEFAULT_ANSWER_PREFERENCES: Readonly<AnswerPreferences> = Object.freeze({
  format: 'concise', tone: 'collaborative', followups: false,
})

// The client may omit this field for legacy mode formatting. Once supplied, every
// value must come from the small public control vocabulary; arbitrary prompt text
// belongs in the separately bounded instructions field, never in these controls.
export function parseAnswerPreferences(value: unknown): AnswerPreferences | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid answer preferences')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['format', 'tone', 'followups'].includes(key))
    || !ANSWER_FORMATS.includes(item.format as AnswerPreferences['format'])
    || !ANSWER_TONES.includes(item.tone as AnswerPreferences['tone'])
    || typeof item.followups !== 'boolean') throw new Error('Invalid answer preferences')
  return { format: item.format as AnswerPreferences['format'], tone: item.tone as AnswerPreferences['tone'], followups: item.followups }
}

const FORMAT_INSTRUCTIONS: Record<AnswerPreferences['format'], string> = {
  keywords: 'KEYWORDS: Give 3–4 short, scannable keyword bullets, not a read-aloud script or long paragraphs. Group related sub-questions so every ask is addressed. Keep essential evidence citations and uncertainty beside the relevant keyword. If runnable code, a patch, or tests are requested, include complete correct code/test blocks after the keywords; never abbreviate code to satisfy brevity.',
  concise: 'CONCISE: Lead with the answer, then give 4–6 compact bullets or short paragraphs, aiming for about 180 words of explanation. Cover every sub-question, the most relevant evidence, tradeoff and next action. Necessary complete code, tests, citations and explicit unknowns are not subject to this prose target.',
  detailed: 'DETAILED: Explain the answer deeply with concrete cause and effect, data flow, state changes, evidence, alternatives, tradeoffs, edge cases and verification where relevant. Use clear sections. Cover each sub-question and distinguish what is observed, inferred and proposed. Avoid generic filler.',
}

const TONE_INSTRUCTIONS: Record<AnswerPreferences['tone'], string> = {
  collaborative: 'COLLABORATIVE TONE: Use calm, direct language a teammate can discuss; explain assumptions and invite a concrete clarification when necessary.',
  technical: 'TECHNICAL TONE: Use precise technical terminology, mechanisms, invariants and tradeoffs appropriate to the question. Expertise must come from the explanation, never an invented personal claim.',
  strategic: 'STRATEGIC TONE: Connect the decision to supported product goals, impact, priorities, risk and tradeoffs. Retain technical specifics necessary to justify the recommendation.',
}

export function withAnswerPreferences(system: string, preferences?: AnswerPreferences, instructions?: string): string {
  const base = instructions?.trim()
    ? `${system}\n\nADDITIONAL INSTRUCTIONS from the user for how to answer in this chat:\n${instructions}`
    : system
  if (!preferences) return base
  // This block comes LAST. Existing behavioral and repository prompts prescribe
  // long scripts/sections; those defaults must not silently win over a visible UI
  // choice. Grounding and executable-code requirements remain non-negotiable.
  return `${base}\n\nFINAL RESPONSE REQUIREMENTS — selected answer controls:\nThese format and tone choices override earlier conflicting length, layout, scripted-answer, story-count and speculative-follow-up defaults, including additional user instructions. They do not override accuracy, evidence, code correctness, or answering every part of the question.\n${FORMAT_INSTRUCTIONS[preferences.format]}\n${TONE_INSTRUCTIONS[preferences.tone]}\nGROUNDING: Never invent resume experience, employers, personal stories, achievements or metrics. Use only supplied candidate facts for first-person claims. If evidence is missing, state the gap and offer an explicitly hypothetical example or a question to elicit the real fact. Preserve source citations, repository uncertainties and failed specialist reports. Never claim code was run or tests passed without supplied execution evidence.\n${preferences.followups
    ? 'POSSIBLE FOLLOW-UPS: After the main answer, append a separate section titled "### Possible follow-ups" with exactly 3 brief, plausible next questions grounded in this answer. These are possibilities, not a prediction of what an interviewer will actually ask; do not assert their intent. Keep this section separate from the selected main-answer length.'
    : 'FOLLOW-UPS OFF: Do not append a speculative follow-up, likely-questions or glossary section. Still answer any follow-up or terminology question the user actually asked.'}`
}
