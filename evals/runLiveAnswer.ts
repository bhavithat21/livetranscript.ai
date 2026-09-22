import { describe, it, expect } from 'vitest'
import { modeProfile, modelForTier, fastFallbackModel, vendorForModel, thinkingConfigFor } from '@/lib/copilot/modes'
import { streamAnswer } from '@/lib/copilot/providers'
import { parseDraftStream } from '@/lib/copilot/draftProtocol'

function keyFor(model: string): boolean {
  switch (vendorForModel(model)) {
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY
    case 'groq': return !!process.env.GROQ_API_KEY
    case 'openai': return !!process.env.OPENAI_API_KEY
    default: return true
  }
}

const profile = modeProfile('general')
let MODEL = modelForTier(profile.tier)
if (!keyFor(MODEL)) MODEL = fastFallbackModel()
const HAS_KEY = keyFor(MODEL)

type Case = {
  question: string
  requiredAny: string[][]
  banned: RegExp[]
  maxWords: number
}

const CASES: Case[] = [
  {
    question: 'What authentication methods can webhooks use?',
    requiredAny: [
      ['hmac', 'signature'],
      ['bearer', 'api token', 'token'],
      ['basic auth', 'basic authentication'],
    ],
    banned: [/transcript (?:did not|does not|doesn't|was not)/i, /not explicitly (?:detailed|mentioned|provided)/i, /if you provide/i],
    maxWords: 260,
  },
  {
    question: 'What is optimistic locking?',
    requiredAny: [
      ['version', 'version number', 'version column'],
      ['conflict', 'concurrent'],
      ['compare', 'update', 'write'],
    ],
    banned: [/based on (?:the )?transcript/i, /not (?:in|from) the transcript/i],
    maxWords: 220,
  },
  {
    question: 'Why would you use Kafka instead of SQS for a high-throughput event stream?',
    requiredAny: [
      ['throughput', 'high-throughput'],
      ['partition', 'partitioning'],
      ['replay', 'retention', 'consumer'],
    ],
    banned: [/great question/i, /it depends[,.]?$/i, /transcript/i],
    maxWords: 280,
  },
]

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

async function generate(question: string): Promise<string> {
  const posture = thinkingConfigFor('general', MODEL)
  const raw = await drain(streamAnswer({
    model: MODEL,
    system: profile.system,
    transcript: 'Interviewer is asking a technical interview question.',
    context: null,
    history: [],
    question,
    image: null,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    thinking: posture.thinking,
    effort: posture.effort,
  }))
  return parseDraftStream(raw).text.trim()
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function startsDirectly(answer: string): boolean {
  const first = answer.replace(/^#+\s*/,'').split(/\n|(?<=[.!?])\s+/)[0]?.trim() ?? ''
  if (!first) return false
  return !/^(great question|based on|the transcript|it depends|i (?:cannot|can't)|there (?:is|are) no)/i.test(first)
}

describe('live interview direct-answer eval', () => {
  it.skipIf(!HAS_KEY)(`keeps live answers direct and interview-ready (model: ${MODEL})`, async () => {
    const failures: string[] = []
    for (const test of CASES) {
      const answer = await generate(test.question)
      const lower = answer.toLowerCase()
      const missing = test.requiredAny.filter(group => !group.some(term => lower.includes(term)))
      const banned = test.banned.filter(re => re.test(answer)).map(re => re.source)
      const tooLong = words(answer) > test.maxWords
      const direct = startsDirectly(answer)
      console.log('\nQUESTION:', test.question, '\nANSWER:', answer, '\n')
      if (!direct || missing.length || banned.length || tooLong) {
        failures.push([
          test.question,
          !direct ? 'indirect opening' : '',
          missing.length ? `missing concepts: ${missing.map(g => g.join('/')).join(', ')}` : '',
          banned.length ? `banned meta language: ${banned.join(', ')}` : '',
          tooLong ? `too long: ${words(answer)} words > ${test.maxWords}` : '',
        ].filter(Boolean).join(' | '))
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300_000)
})
