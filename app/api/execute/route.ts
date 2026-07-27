import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'

// Remote code execution for COMPILED / non-browser languages (Java, C++, Go, Rust,
// C#, Ruby, Swift, Kotlin, Scala). Python/JS/TS run in the browser WASM worker and
// never reach here — this route is only the long tail the browser can't run.
//
// Egress is deliberately server-side (browser → this route → executor) so the
// endpoint + optional key live in env and can be swapped to a SELF-HOSTED Judge0
// with no client change. Default is the public Judge0 CE instance; set JUDGE0_URL
// (+ JUDGE0_KEY / JUDGE0_HOST for RapidAPI-hosted) to point at your own.
//
// SECURITY NOTE: submitted code egresses to the configured executor. That's the
// unavoidable cost of running Java/Go/etc. — surfaced to the user in the UI. Judge0
// itself sandboxes each run (isolate/cgroups), and we cap wall time + output.

const JUDGE0_URL = process.env.JUDGE0_URL || 'https://ce.judge0.com'
const JUDGE0_KEY = process.env.JUDGE0_KEY // RapidAPI key, if using a hosted instance
const JUDGE0_HOST = process.env.JUDGE0_HOST // RapidAPI host, if using a hosted instance

const MAX_SOURCE = 60_000
const CPU_TIME_LIMIT = 8 // seconds, per Judge0
const WALL_TIME_LIMIT = 12

// language → Judge0 language_id. Only the languages the browser CANNOT run; the
// three WASM languages are intentionally absent so a misroute fails loudly rather
// than silently shipping Python to a remote box.
const JUDGE0_LANG: Record<string, number> = {
  java: 91, // JDK 17
  cpp: 105, // GCC 14
  csharp: 51, // Mono 6
  go: 107, // Go 1.23
  rust: 108, // Rust 1.85
  ruby: 72, // Ruby 2.7
  swift: 83, // Swift 5.2
  kotlin: 111, // Kotlin 2.1
  scala: 112, // Scala 3.4
}

export function remoteLanguageId(language: string): number | null {
  return JUDGE0_LANG[language] ?? null
}

type Judge0Result = {
  stdout: string | null
  stderr: string | null
  compile_output: string | null
  status: { id: number; description: string } | null
  message: string | null
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { language?: string; source?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const language = typeof body.language === 'string' ? body.language.toLowerCase().trim() : ''
  const source = typeof body.source === 'string' ? body.source.slice(0, MAX_SOURCE) : ''
  const languageId = remoteLanguageId(language)

  if (!languageId) return Response.json({ error: `No remote executor for "${language}"` }, { status: 400 })
  if (!source.trim()) return Response.json({ error: 'No source to run' }, { status: 400 })

  try {
    const res = await fetch(
      `${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(JUDGE0_KEY ? { 'X-RapidAPI-Key': JUDGE0_KEY } : {}),
          ...(JUDGE0_HOST ? { 'X-RapidAPI-Host': JUDGE0_HOST } : {}),
        },
        body: JSON.stringify({
          language_id: languageId,
          source_code: source,
          cpu_time_limit: CPU_TIME_LIMIT,
          wall_time_limit: WALL_TIME_LIMIT,
        }),
        // Give the whole compile+run a hard ceiling so a slow executor can't hang us.
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (!res.ok) {
      return Response.json({ error: `Executor unavailable (${res.status})` }, { status: 502 })
    }
    const j = (await res.json()) as Judge0Result
    // Compile error surfaces as its own field; runtime output in stdout/stderr.
    const compile = (j.compile_output || '').trim()
    const stdout = (j.stdout || '').trim()
    const stderr = (j.stderr || '').trim()
    return Response.json({
      stdout,
      stderr,
      compileOutput: compile,
      status: j.status?.description ?? 'Unknown',
      ok: j.status?.id === 3, // 3 = Accepted (ran to completion, exit 0)
    })
  } catch (e) {
    logError('api/execute', e)
    return Response.json({ error: 'Execution failed' }, { status: 502 })
  }
}
