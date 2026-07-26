'use client'
import { runPython, runTests as runPyTests, preloadPyodide, type TestRunResult } from './pyodideRunner'
import { runJavaScript, runJsTests, type JsTestRunResult } from './jsRunner'

export type { TestRunResult } from './pyodideRunner'

export type SupportedLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'java'
  | 'cpp'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'scala'

const EXECUTABLE_LANGUAGES = new Set(['python', 'javascript', 'typescript'])

export function canExecute(language: string): boolean {
  return EXECUTABLE_LANGUAGES.has(normalizeLanguage(language))
}

export function normalizeLanguage(lang: string): SupportedLanguage {
  const l = lang.toLowerCase().trim()
  if (l === 'py' || l === 'python3' || l === 'python') return 'python'
  if (l === 'js' || l === 'javascript' || l === 'node') return 'javascript'
  if (l === 'ts' || l === 'typescript') return 'typescript'
  if (l === 'c++' || l === 'cpp') return 'cpp'
  if (l === 'c#' || l === 'csharp') return 'csharp'
  if (l === 'golang' || l === 'go') return 'go'
  return l as SupportedLanguage
}

export function preloadRuntime(language: string): void {
  const lang = normalizeLanguage(language)
  if (lang === 'python') preloadPyodide()
}

export function extractCode(markdown: string): { code: string; language: SupportedLanguage } | null {
  const m = markdown.match(
    /```(python|py|javascript|js|typescript|ts|java|cpp|c\+\+|csharp|c#|go|rust|ruby|swift|kotlin|scala)\s*\n([\s\S]*?)```/i,
  )
  if (!m) return null
  return { code: m[2].trim(), language: normalizeLanguage(m[1]) }
}

export function extractTests(markdown: string): { tests: string; language: SupportedLanguage } | null {
  const m = markdown.match(
    /```(python|py|javascript|js|typescript|ts|java|cpp|c\+\+|csharp|c#|go|rust|ruby|swift|kotlin|scala):tests\s*\n([\s\S]*?)```/i,
  )
  if (!m) return null
  return { tests: m[2].trim(), language: normalizeLanguage(m[1]) }
}

export async function executeTests(
  solution: string,
  tests: string,
  language: string,
  timeoutMs = 8_000,
): Promise<TestRunResult> {
  const lang = normalizeLanguage(language)

  switch (lang) {
    case 'python':
      return runPyTests(solution, tests, timeoutMs)

    case 'javascript':
    case 'typescript': {
      const result: JsTestRunResult = await runJsTests(solution, tests, timeoutMs)
      return result
    }

    default:
      return {
        passed: 0,
        failed: 0,
        total: 0,
        cases: [{ label: `Execution not available for ${lang}`, passed: false, error: 'Language not supported for in-browser execution' }],
      }
  }
}

export async function executeCode(
  code: string,
  language: string,
  timeoutMs = 8_000,
): Promise<{ ok: boolean; output: string; error?: string }> {
  const lang = normalizeLanguage(language)

  switch (lang) {
    case 'python':
      return runPython(code, timeoutMs)
    case 'javascript':
    case 'typescript':
      return runJavaScript(code, timeoutMs)
    default:
      return { ok: false, output: '', error: `Execution not available for ${lang}` }
  }
}
