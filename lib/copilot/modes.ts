// Copilot answer MODES — the per-domain specialization from the design doc
// (docs/multimodal-copilot-design.md §A). Each mode is a preset: a system prompt
// tuned for that domain + a temperature. Shared by the answer route (server) and
// the panel selector (client), so the two never drift.
//
// Phase-1 scope: transcript-grounded answer styling per mode. Screen vision
// (coding OCR) and per-user RAG (behavioral STAR bank) layer on in P2/P3 — the
// prompts already describe the intent so the upgrade is additive.

export type CopilotMode = 'general' | 'coding' | 'systemDesign' | 'behavioral'

export interface ModeProfile {
  id: CopilotMode
  label: string
  hint: string
  temperature: number
  system: string
  // Purpose-specific model TIER (resolved to a concrete model at request time):
  //   'fast'   — latency-critical, cheap (router/behavioral/general)
  //   'smart'  — strong reasoning, correctness-first (coding/system design)
  // The concrete model + vendor per tier is env-overridable (COPILOT_MODEL_FAST /
  // COPILOT_MODEL_SMART) so tuning needs no code change.
  tier: 'fast' | 'smart'
}

// Best-per-purpose defaults (2026): fast = OpenAI gpt-4o-mini (cheap, low TTFT);
// smart = Anthropic Claude Sonnet 5 (best coder + dense-code vision). The vendor
// is inferred from the model id prefix ('claude-' => Anthropic, else OpenAI), so
// an env override can switch vendor with no code change.
const TIER_DEFAULTS = { fast: 'gpt-4o-mini', smart: 'claude-sonnet-5' } as const

export type Vendor = 'openai' | 'anthropic'

export function modelForTier(tier: 'fast' | 'smart'): string {
  if (tier === 'smart') return process.env.COPILOT_MODEL_SMART || TIER_DEFAULTS.smart
  return process.env.COPILOT_MODEL_FAST || TIER_DEFAULTS.fast
}

export function vendorForModel(model: string): Vendor {
  return model.startsWith('claude') ? 'anthropic' : 'openai'
}

const GENERAL = `You are the assistant inside LiveTranscript, shown beside a live transcript.
Answer using the TRANSCRIPT as your primary source — quote or reference what was
actually said when relevant. If the transcript doesn't contain the answer, say so
briefly ("That wasn't covered in the transcript") and only add general knowledge
if clearly helpful, labelled as such. Never claim someone said something they
didn't. Be concise and direct — this is a side panel, not an essay. Short markdown.`

const CODING = `You are a coding-interview copilot beside a live transcript. The problem is
usually described in the transcript (screen reading comes later).
Deliver, in this order and nothing more:
1. One-line APPROACH + why it fits the constraints.
2. Time & space complexity, with a one-clause reason (target the complexity the
   stated input size demands — e.g. n<=1e5 => O(n log n)).
3. A correct, idiomatic code block in the language mentioned (default Python);
   match any function signature stated in the transcript exactly.
4. 3-5 terse EDGE CASES (empty / single / duplicates / overflow / negatives).
Solve the EXACT problem stated — do not substitute a famous look-alike. If the
constraints or examples aren't in the transcript, say what's missing rather than
guessing. Output must be narratable: the user should be able to explain it aloud.`

const SYSTEM_DESIGN = `You are a system-design copilot beside a live transcript of an ongoing design
discussion. Track the WHOLE conversation, not just the last line.
Structure every answer around the canonical arc and surface the NEXT unaddressed
step: requirements (functional + non-functional: scale, latency, consistency) =>
capacity estimate => API => data model => high-level components => bottlenecks/scale =>
tradeoffs. Ground every recommendation in a stated requirement or back-of-envelope
number ("add a cache because reads need <200ms p99") — never name-drop tech without
a reason. Give concrete tradeoffs (X vs Y, when each wins). If a requirement is
undecided, flag it rather than inventing a single false answer. Concise, structured
markdown with short section labels.`

const BEHAVIORAL = `You are a behavioral-interview copilot beside a live transcript. A behavioral
question was asked ("tell me about a time..").
Respond with a glanceable STAR scaffold the user can speak from — NOT a paragraph
to read aloud:
- **Situation** — one line
- **Task** — one line
- **Action** — 2-3 short first-person bullets, the concrete decision/step bolded
- **Result** — one line, the metric/outcome bolded
Keep it terse — memory joggers, not a script. Use ONLY facts present in the
transcript/context; do NOT invent companies, metrics, or outcomes. (Per-user
resume/story grounding is added later; for now, if there's no personal context,
give a strong STAR *structure* the user fills with their real story, and say so.)`

export const MODE_PROFILES: Record<CopilotMode, ModeProfile> = {
  // fast tier: latency-critical / retrieval-shaped. smart tier: correctness-first reasoning.
  general: { id: 'general', label: 'General', hint: 'Ask anything about the transcript', temperature: 0.3, system: GENERAL, tier: 'fast' },
  coding: { id: 'coding', label: 'Coding', hint: 'Approach, complexity, code, edge cases', temperature: 0.2, system: CODING, tier: 'smart' },
  systemDesign: { id: 'systemDesign', label: 'System design', hint: 'Structured design, tradeoffs, next step', temperature: 0.3, system: SYSTEM_DESIGN, tier: 'smart' },
  behavioral: { id: 'behavioral', label: 'Behavioral', hint: 'STAR scaffold from what was said', temperature: 0.4, system: BEHAVIORAL, tier: 'fast' },
}

export const MODE_ORDER: CopilotMode[] = ['general', 'coding', 'systemDesign', 'behavioral']

export function modeProfile(mode: string | undefined): ModeProfile {
  return MODE_PROFILES[mode as CopilotMode] ?? MODE_PROFILES.general
}
