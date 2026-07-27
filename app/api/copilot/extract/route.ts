import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { modelForTier, vendorForModel } from '@/lib/copilot/modes'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const MAX_IMAGE_CHARS = 1_200_000

// Vision extract runs on Gemini Flash by default: fastest + cheapest at reading
// dense text/code off a screenshot, and its native JSON mode removes the
// regex-scrape step. Override with COPILOT_MODEL_VISION; falls back to the smart
// tier (Claude Sonnet) when GEMINI_API_KEY is unset or Gemini errors.
const VISION_MODEL = process.env.COPILOT_MODEL_VISION || 'gemini-flash-latest'
const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

// Call Gemini with the screenshot + prompt in JSON mode; returns the raw JSON
// text. Throws on any non-200 or missing key so the caller can fall back.
async function extractWithGemini(prompt: string, mediaType: string, data: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('no gemini key')
  const res = await fetch(GEMINI_URL(VISION_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mediaType, data } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('gemini empty response')
  return text
}

const EXTRACT_PROMPT = `Analyze this screenshot. If it shows a coding problem or interview question, extract its details as JSON. If it does NOT show a coding problem, respond with exactly: {"noProblem": true}

For a coding problem, respond with raw JSON only (no markdown fences, no explanation):
{
  "question": "the complete problem statement as shown",
  "functionName": "expected function name, or 'solve' if not specified",
  "params": "parameter types, e.g. 'nums: List[int], target: int'",
  "returnType": "return type, e.g. 'List[int]'",
  "constraints": ["2 <= len(nums) <= 10^4", "..."],
  "examples": [{"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]"}],
  "edgeCases": ["empty input", "single element", "all duplicates", "negative numbers"],
  "language": "the programming language visible on screen or selected in the platform UI (python/javascript/java/cpp/etc). Default: python",
  "testAsserts": "assert-based test statements in the detected language covering visible examples PLUS edge cases"
}

For testAsserts: write 5-8 test assertions in the detected language:
- Python: assert functionName(args) == expected  # label
- JavaScript/TypeScript: check(functionName(args), expected, 'label')
- Java: assert functionName(args) == expected : "label";
- C++: assert(functionName(args) == expected); // label
Each must call the function by name. Extract ONLY what is visible — do not invent problem details.`

export type ExtractedProblem = {
  question: string
  functionName: string
  params: string
  returnType: string
  constraints: string[]
  examples: { input: string; output: string }[]
  edgeCases: string[]
  language: string
  testAsserts: string
}

export type ExtractResult = ExtractedProblem | { noProblem: true }

// Coerce the raw parsed LLM JSON into a well-typed ExtractResult. The model can
// omit or mistype any field; downstream (ExtractedProblemBar render, orchestrator
// process) assumes arrays/strings, so normalize here — the single source both the
// client and orchestrator consume.
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function normalizeExtract(parsed: unknown): ExtractResult {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  if (obj.noProblem === true) return { noProblem: true }

  const examples = Array.isArray(obj.examples)
    ? obj.examples
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({ input: str(e.input), output: str(e.output) }))
    : []

  return {
    question: str(obj.question),
    functionName: str(obj.functionName, 'solve'),
    params: str(obj.params),
    returnType: str(obj.returnType),
    constraints: strArray(obj.constraints),
    examples,
    edgeCases: strArray(obj.edgeCases),
    language: str(obj.language, 'python'),
    testAsserts: str(obj.testAsserts),
  }
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { image?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const image =
    typeof body.image === 'string' &&
    body.image.startsWith('data:image/') &&
    body.image.length <= MAX_IMAGE_CHARS
      ? body.image
      : null

  if (!image) return Response.json({ error: 'No valid image' }, { status: 400 })

  const m = image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
  if (!m) return Response.json({ error: 'Invalid image format' }, { status: 400 })
  const [mediaType, imgData] = [m[1], m[2]]

  try {
    let raw: string | null = null

    // Primary: Gemini Flash (fast/cheap dense-text OCR, native JSON mode). On any
    // failure fall through to the smart-tier Claude/OpenAI path below.
    try {
      raw = await extractWithGemini(EXTRACT_PROMPT, mediaType, imgData)
    } catch (e) {
      logError('api/copilot/extract/gemini', e)
      raw = null
    }

    if (raw === null) {
      // Fallback: smart tier (Claude Sonnet), or the fast model if Anthropic is
      // keyless. Returns 500 only if no fallback vendor is configured either.
      let model = modelForTier('smart')
      if (vendorForModel(model) === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
        model = modelForTier('fast')
      }
      if (vendorForModel(model) === 'anthropic') {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const response = await client.messages.create({
          model,
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACT_PROMPT },
              { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: imgData } },
            ],
          }],
        })
        raw = response.content[0].type === 'text' ? response.content[0].text : ''
      } else if (vendorForModel(model) === 'openai' && process.env.OPENAI_API_KEY) {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        const response = await client.chat.completions.create({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACT_PROMPT },
              { type: 'image_url', image_url: { url: image, detail: 'high' } },
            ],
          }],
        })
        raw = response.choices[0]?.message?.content ?? ''
      } else {
        return Response.json({ error: 'Extraction unavailable' }, { status: 500 })
      }
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return Response.json({ error: 'No JSON in response' }, { status: 502 })
    const parsed = JSON.parse(jsonMatch[0]) as unknown
    return Response.json(normalizeExtract(parsed))
  } catch (e) {
    logError('api/copilot/extract', e)
    return Response.json({ error: 'Extraction failed' }, { status: 502 })
  }
}
