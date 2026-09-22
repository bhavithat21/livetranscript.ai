import type { InterviewQuestion, RepoIndex, RepoMatch, RepoSourceFile } from './types'

const MAX_FILES = 2_000
const MAX_FILE_CHARS = 120_000
const MAX_TOTAL_CHARS = 8_000_000
const CODE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'graphql', 'h', 'hpp', 'html', 'java', 'js',
  'json', 'jsx', 'kt', 'md', 'mjs', 'php', 'prisma', 'py', 'rb', 'rs', 'scala',
  'sh', 'sql', 'swift', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml',
])
const IGNORED_PARTS = new Set([
  '.git', '.next', '.turbo', '.vercel', 'build', 'coverage', 'dist', 'node_modules',
  'target', 'vendor', '__pycache__',
])
const SECRET_NAME = /(^|\/)(?:\.env(?:\.|$)|.*\.(?:pem|key|p12|pfx)$|id_rsa|credentials(?:\.|$)|secrets?(?:\.|$))/i

export function isIndexablePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (parts.some((part) => IGNORED_PARTS.has(part))) return false
  if (SECRET_NAME.test(normalized)) return false
  const ext = normalized.split('.').pop()?.toLowerCase() ?? ''
  return CODE_EXTENSIONS.has(ext)
}

function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const aliases: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', cs: 'csharp', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    kt: 'kotlin', yml: 'yaml', md: 'markdown', sh: 'shell',
  }
  return aliases[ext] ?? (ext || 'text')
}

export function extractSymbols(content: string): string[] {
  const symbols = new Set<string>()
  const patterns = [
    /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\b(?:def|class)\s+([A-Za-z_][\w]*)/g,
    /\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/g,
    /\b(?:public|private|protected|static|async|final|virtual|override|synchronized|\s)+[\w<>,?\[\].:]+\s+([A-Za-z_][\w]*)\s*\(/g,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) symbols.add(match[1])
      if (symbols.size >= 80) return [...symbols]
    }
  }
  return [...symbols]
}

export function createRepoFile(path: string, content: string): RepoSourceFile {
  const cleanPath = path.replaceAll('\\', '/').replace(/^\.\//, '')
  const capped = content.slice(0, MAX_FILE_CHARS)
  return { path: cleanPath, content: capped, language: languageFor(cleanPath), symbols: extractSymbols(capped) }
}

export function buildRepoIndex(name: string, files: RepoSourceFile[]): RepoIndex {
  let totalChars = 0
  const accepted: RepoSourceFile[] = []
  for (const file of files) {
    if (accepted.length >= MAX_FILES || !isIndexablePath(file.path)) continue
    const remaining = MAX_TOTAL_CHARS - totalChars
    if (remaining <= 0) break
    const content = file.content.slice(0, Math.min(MAX_FILE_CHARS, remaining))
    accepted.push({ ...file, content, symbols: file.symbols.length ? file.symbols : extractSymbols(content) })
    totalChars += content.length
  }
  return { name, files: accepted, indexedAt: Date.now(), totalChars }
}

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z_$][a-z0-9_$.-]{2,}/g) ?? [])]
    .filter((term) => !['this', 'that', 'with', 'from', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'have', 'does', 'into', 'your'].includes(term))
}

function excerptAround(content: string, queryTerms: string[]): string {
  const lower = content.toLowerCase()
  let hit = -1
  for (const term of queryTerms) {
    const index = lower.indexOf(term)
    if (index >= 0 && (hit < 0 || index < hit)) hit = index
  }
  const start = Math.max(0, hit < 0 ? 0 : hit - 900)
  return content.slice(start, start + 3_600)
}

export function rankRepoFiles(index: RepoIndex | null, query: string, limit = 6): RepoMatch[] {
  if (!index) return []
  const queryTerms = terms(query)
  if (!queryTerms.length) return index.files.slice(0, limit).map((file) => ({ ...file, score: 1, reason: 'repository entry point', excerpt: excerptAround(file.content, []) }))
  return index.files
    .map((file) => {
      const path = file.path.toLowerCase()
      const symbols = file.symbols.map((symbol) => symbol.toLowerCase())
      const body = file.content.toLowerCase()
      let score = 0
      const reasons: string[] = []
      for (const term of queryTerms) {
        if (path.includes(term)) { score += 12; reasons.push(`path:${term}`) }
        if (symbols.some((symbol) => symbol.includes(term))) { score += 9; reasons.push(`symbol:${term}`) }
        const first = body.indexOf(term)
        if (first >= 0) score += 1 + Math.min(4, body.split(term).length - 1)
      }
      if (/test|spec/.test(path) && /test|edge|fail|bug|verify/.test(query.toLowerCase())) score += 6
      if (/test|spec/.test(path) && !/test|edge|fail|bug|verify/.test(query.toLowerCase())) score -= 4
      if (/readme|package\.json|cargo\.toml|pyproject|pom\.xml|build\.gradle/.test(path)) score += 2
      return {
        path: file.path,
        language: file.language,
        symbols: file.symbols,
        score,
        reason: reasons.slice(0, 3).join(', ') || 'content match',
        excerpt: excerptAround(file.content, queryTerms),
      }
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
}

export function repoContext(index: RepoIndex | null, query: string): string | null {
  if (!index) return null
  const matches = rankRepoFiles(index, query, 7)
  const tree = index.files.slice(0, 300).map((file) => file.path).join('\n')
  const evidence = matches.map((match, i) => [
    `EVIDENCE ${i + 1}: ${match.path}`,
    match.symbols.length ? `SYMBOLS: ${match.symbols.slice(0, 30).join(', ')}` : null,
    `\`\`\`${match.language}\n${match.excerpt}\n\`\`\``,
  ].filter(Boolean).join('\n')).join('\n\n')
  return `REPOSITORY: ${index.name}\nFILES INDEXED: ${index.files.length}\n\nREPO TREE (capped):\n${tree}\n\nRELEVANT CODE:\n${evidence}`
}

const QUESTION_START = /^(?:what|why|how|when|where|who|which|whose|whom|can|could|would|will|do|did|have|are|is|tell|walk|describe|explain|show|find|implement|add|change|fix|debug|test|review|design|write|compare|solve|give|share|reverse)\b/i
const FILLER = /^(?:(?:so|and|but|okay|ok|now|well|um|uh|right|great|next|also|then)\b[\s,;:.-]*)+/i
const SPEAKER_LABEL = /(?:^|\s)(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?(?:speaker\s+[\w-]+|interviewer|candidate|host|guest|you|me)\s*:/gi
export const MAX_QUESTIONS = 200

export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

type QuestionCandidate = { text: string; sourceStart: number; sourceOrder: number }

function questionCandidates(transcript: string): QuestionCandidate[] {
  // Keep line boundaries and offsets. They identify distinct utterances even when
  // ASR omits punctuation or corrects the current question in place.
  const labeled = transcript.replace(SPEAKER_LABEL, (label) => '\n' + ' '.repeat(Math.max(0, label.length - 1)))
  const candidates: QuestionCandidate[] = []
  for (const line of labeled.matchAll(/[^\n]+/g)) {
    // Split only at sentence punctuation; dots in file paths and decimals belong
    // to the question. Include the final unpunctuated ASR tail as well.
    for (const match of line[0].matchAll(/[\s\S]*?(?:[.!?](?=\s|$)|$)/g)) {
      const bare = match[0].trim().replace(FILLER, '').trim()
      if (bare.length < 5 || (!/[?]$/.test(bare) && !QUESTION_START.test(bare))) continue
      candidates.push({ text: bare.slice(0, 2_000), sourceStart: line.index + match.index + match[0].search(/\S/), sourceOrder: candidates.length })
    }
  }
  return candidates
}

export function extractQuestions(transcript: string): string[] {
  return questionCandidates(transcript).map((candidate) => candidate.text)
}

function looksLikeRevision(previous: InterviewQuestion, candidate: QuestionCandidate): boolean {
  if (previous.sourceStart !== candidate.sourceStart && previous.sourceOrder !== candidate.sourceOrder) return false
  const next = normalizeQuestion(candidate.text)
  if (previous.normalized === next) return true
  const beforeWords = previous.normalized.split(' ')
  const nextWords = next.split(' ')
  const shared = beforeWords.filter((word) => nextWords.includes(word)).length
  return previous.normalized.startsWith(next + ' ') || next.startsWith(previous.normalized + ' ')
    || (beforeWords.length >= 3 && nextWords.length >= 3 && shared / Math.max(beforeWords.length, nextWords.length) >= 0.6)
}

export function mergeQuestionLedger(current: InterviewQuestion[], transcript: string, skipQuestionCount = 0): InterviewQuestion[] {
  let next = current
  for (const candidate of questionCandidates(transcript).slice(skipQuestionCount)) {
    const normalized = normalizeQuestion(candidate.text)
    if (!normalized) continue
    const exact = next.findIndex((question) => question.normalized === normalized
      && (question.sourceStart === undefined || question.sourceStart === candidate.sourceStart || question.sourceOrder === candidate.sourceOrder))
    const revision = exact >= 0 ? exact : next.findIndex((question) => looksLikeRevision(question, candidate))
    if (revision >= 0) {
      const existing = next[revision]
      if (existing.text === candidate.text && existing.sourceStart === candidate.sourceStart && existing.sourceOrder === candidate.sourceOrder) continue
      if (next === current) next = [...current]
      next[revision] = {
        ...existing,
        ...candidate,
        normalized,
        updatedAt: existing.text === candidate.text ? existing.updatedAt : Date.now(),
        // A corrected requirement needs a fresh answer. Cosmetic punctuation
        // changes retain its answer status.
        status: existing.normalized === normalized ? existing.status : 'captured',
      }
      continue
    }
    if (next === current) next = [...current]
    const now = Date.now()
    next.push({ id: crypto.randomUUID(), ...candidate, normalized, capturedAt: now, updatedAt: now, status: 'captured' })
  }
  return next.length > MAX_QUESTIONS ? next.slice(-MAX_QUESTIONS) : next
}
