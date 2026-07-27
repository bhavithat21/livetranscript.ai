// Behavioral voice-compliance eval.
//
// WHAT IT TRULY VERIFIES (real, not stubbed): for each sample "tell me about a
// time" prompt it generates an answer through the REAL model path
// (lib/copilot/providers.streamAnswer with the REAL behavioral modeProfile system
// prompt + the same model/key selection as runCoding + app/api/copilot/answer),
// strips draft sentinels with the REAL parseDraftStream, then RUNS automated
// assertions against the LOCKED voice rules from modes.ts BEHAVIORAL prompt:
//   (a) no em-dash / en-dash used as a CONNECTOR (the prompt bans — – as connectors),
//   (b) none of the banned literary/corporate words,
//   (c) at least one first-person "I" decision statement,
//   (d) no Leadership Principle named aloud.
// The model output is real; the rules are checked mechanically. A rule check is a
// heuristic (noted per-check) — it flags the obvious violations the prompt forbids,
// not a full NLP judgment.
//
// HOW TO RUN: `npm run eval:voice`. Same key gate as runCoding: with NO usable
// provider key it SKIPS (exit 0), never hard-fails CI.
import { describe, it } from 'vitest'
import { modeProfile, modelForTier, vendorForModel, fastFallbackModel, thinkingConfigFor } from '@/lib/copilot/modes'
import { streamAnswer } from '@/lib/copilot/providers'
import { parseDraftStream } from '@/lib/copilot/draftProtocol'

// Same key gate as runCoding / the answer route — decide the model, then check the
// owning vendor's key is present.
function keyFor(model: string): boolean {
  switch (vendorForModel(model)) {
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY
    case 'groq': return !!process.env.GROQ_API_KEY
    case 'openai': return !!process.env.OPENAI_API_KEY
    default: return true
  }
}

const profile = modeProfile('behavioral')
let VOICE_MODEL = modelForTier(profile.tier)
if (!keyFor(VOICE_MODEL)) VOICE_MODEL = fastFallbackModel()
const HAS_KEY = keyFor(VOICE_MODEL)

// Sample behavioral prompts — the "tell me about a time" shape the mode is built for.
const PROMPTS = [
  'Tell me about a time you had to make a decision without complete information.',
  'Tell me about a time you disagreed with your manager.',
  'Tell me about a time a project of yours failed or missed a deadline.',
  'Tell me about a time you had to dive deep to find the root cause of a problem.',
  'Tell me about a time you took a risk that did not pay off at first.',
]

// Banned literary/corporate words from the BEHAVIORAL prompt's VOICE RULES.
const BANNED_WORDS = ['pivotal', 'leveraged', 'spearheaded', 'meticulous', 'paramount', 'synergy', 'stakeholder alignment']

// The 16 Amazon Leadership Principles — the rule bans naming one ALOUD. Matched as
// whole phrases so ordinary words ("ownership of the bug") don't false-positive.
const LEADERSHIP_PRINCIPLES = [
  'customer obsession', 'ownership', 'invent and simplify', 'are right, a lot',
  'learn and be curious', 'hire and develop the best', 'insist on the highest standards',
  'think big', 'bias for action', 'frugality', 'earn trust', 'dive deep',
  'have backbone', 'deliver results', "strive to be earth's best employer",
  'success and scale bring broad responsibility',
]

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

// Generate one behavioral answer the same way the answer route does.
async function generate(prompt: string): Promise<string> {
  const posture = thinkingConfigFor('behavioral', VOICE_MODEL)
  const raw = await drain(
    streamAnswer({
      model: VOICE_MODEL,
      system: profile.system,
      transcript: '',
      context: null,
      history: [],
      question: prompt,
      image: null,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      thinking: posture.thinking,
      effort: posture.effort,
    }),
  )
  return parseDraftStream(raw).text
}

// Sections 4 (Glossary) + 5 (Likely follow-ups) are REFERENCE-only ("do not say
// aloud") and legitimately DO expand acronyms and may name an LP as the interviewer's
// probe. The voice rules govern the SPOKEN text, so we check only the part before the
// glossary. Cut at the first reference-only heading if present, else check it all.
function spokenPart(answer: string): string {
  const cut = answer.search(/\*\*(glossary|likely follow-ups|metric defense)/i)
  return cut === -1 ? answer : answer.slice(0, cut)
}

// (a) No em-dash / en-dash used as a CONNECTOR. A connector dash joins clauses and
// is spaced in this voice ("the system was fast — but errors piled up"), so we
// require whitespace adjacent to the — / – between two words. A numeric range
// ("P95–P99", no spaces) or a plain "-" hyphen isn't a connector and won't flag.
function usesDashConnector(text: string): boolean {
  return /\w\s+[—–]\s*\w|\w\s*[—–]\s+\w/.test(text)
}

// (b) None of the banned words (case-insensitive, whole-ish match).
function bannedWordsUsed(text: string): string[] {
  const lower = text.toLowerCase()
  return BANNED_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower))
}

// (c) At least one first-person "I" decision statement — an "I <decision-verb>".
function hasFirstPersonDecision(text: string): boolean {
  return /\bI\s+(decided|chose|built|designed|convinced|measured|owned|realized|proposed|picked|implemented|led|drove|figured)/.test(text)
}

// (d) No Leadership Principle named aloud in the spoken text.
function principlesNamedAloud(text: string): string[] {
  const lower = text.toLowerCase()
  return LEADERSHIP_PRINCIPLES.filter((p) => lower.includes(p))
}

type RuleResult = { dash: boolean; banned: boolean; firstPerson: boolean; noLp: boolean }
type Row = { prompt: string; ok: boolean; rules: RuleResult; detail: string }

describe('behavioral voice-compliance eval', () => {
  it.skipIf(!HAS_KEY)(
    `generates + checks ${PROMPTS.length} behavioral answers (model: ${VOICE_MODEL})`,
    async () => {
      const rows: Row[] = []

      for (const prompt of PROMPTS) {
        const answer = await generate(prompt).catch((e) => `__ERROR__ ${e instanceof Error ? e.message : String(e)}`)
        if (answer.startsWith('__ERROR__')) {
          rows.push({ prompt, ok: false, rules: { dash: false, banned: false, firstPerson: false, noLp: false }, detail: answer })
          continue
        }
        const spoken = spokenPart(answer)
        const banned = bannedWordsUsed(spoken)
        const lps = principlesNamedAloud(spoken)
        const rules: RuleResult = {
          dash: !usesDashConnector(spoken),
          banned: banned.length === 0,
          firstPerson: hasFirstPersonDecision(spoken),
          noLp: lps.length === 0,
        }
        const detail = [
          rules.dash ? '' : 'dash-connector',
          banned.length ? `banned:${banned.join(',')}` : '',
          rules.firstPerson ? '' : 'no-I-decision',
          lps.length ? `LP:${lps.join(',')}` : '',
        ].filter(Boolean).join(' ')
        rows.push({ prompt, ok: rules.dash && rules.banned && rules.firstPerson && rules.noLp, rules, detail })
      }

      // Report: per-prompt pass/fail per rule + overall voice-compliance score.
      const mark = (b: boolean) => (b ? 'PASS' : 'FAIL')
      const short = (s: string) => (s.length > 40 ? s.slice(0, 37) + '…' : s).padEnd(42)
      const lines = [
        '',
        `Behavioral voice-compliance eval — model: ${VOICE_MODEL}`,
        short('prompt') + 'dash  banned  I-dec  no-LP',
        '-'.repeat(72),
        ...rows.map(
          (r) =>
            short(r.prompt) +
            [r.rules.dash, r.rules.banned, r.rules.firstPerson, r.rules.noLp]
              .map((b) => (b ? ' ok ' : 'FAIL'))
              .join('   ') +
            (r.detail ? `   (${r.detail})` : ''),
        ),
        '-'.repeat(72),
      ]
      const passed = rows.filter((r) => r.ok).length
      const rate = rows.length ? ((passed / rows.length) * 100).toFixed(1) : '0.0'
      lines.push(`overall voice-compliance: ${passed}/${rows.length} answers clean = ${rate}%`, '')
      // eslint-disable-next-line no-console -- eval report is the whole point of this runner
      console.log(lines.join('\n'))
    },
    300_000,
  )
})
