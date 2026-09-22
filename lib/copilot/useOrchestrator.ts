'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  extractCode,
  extractTests,
  executeTests,
  canExecute,
  isRemoteLanguage,
  normalizeLanguage,
  preloadRuntime,
  type TestRunResult,
} from './codeExecutor'

export type OrchestratorStage = 'idle' | 'extracting' | 'solving' | 'executing' | 'retrying' | 'done'

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

const MAX_RETRIES = 2

type AskFn = (
  q: string,
  mode: string,
  image?: string | null,
  context?: string | null,
  instructions?: string | null,
) => Promise<string | undefined>

export function useOrchestrator(ask: AskFn) {
  const [stage, setStage] = useState<OrchestratorStage>('idle')
  const [problem, setProblem] = useState<ExtractedProblem | null>(null)
  const [testResult, setTestResult] = useState<TestRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const retries = useRef(0)
  useEffect(() => () => {
    active.current?.abort()
    active.current = null
  }, [])

  const executeAndRetry = useCallback(async function executeAndRetry(
    content: string,
    prob: ExtractedProblem,
    instructions: string | null,
    askFn: AskFn,
    controller: AbortController,
  ): Promise<void> {
    const current = () => active.current === controller && !controller.signal.aborted
    if (!current()) return
    const codeBlock = extractCode(content)
    const testsBlock = extractTests(content)

    if (!codeBlock || !testsBlock) {
      setStage('done')
      return
    }

    const lang = normalizeLanguage(prob.language || codeBlock.language)

    // Auto-execute ONLY for locally-runnable languages (Python/JS/TS). Remote
    // (compiled) languages would egress the on-screen code to a third-party
    // executor without the user clicking — same no-egress-without-consent rule as
    // the typed path. The solution + tests still render; the user runs them via the
    // panel's "Run tests · remote" button when they choose.
    if (!canExecute(lang) || isRemoteLanguage(lang)) {
      setStage('done')
      return
    }

    setStage('executing')
    const result = await executeTests(codeBlock.code, testsBlock.tests, lang)
    // Local runtimes may not support aborting execution. Discard an old result
    // and never let it start another paid answer after Stop/reset/unmount.
    if (!current()) return
    setTestResult(result)

    if (result.failed > 0 && retries.current < MAX_RETRIES) {
      retries.current++
      setStage('retrying')

      const failures = result.cases
        .filter(c => !c.passed)
        .map(c => `- ${c.label}: ${c.error}`)
        .join('\n')

      // Keep retries self-contained even if the user changed modes/context while
      // tests were running. Include the exact code and observed failing cases.
      const retryContent = await askFn(
        [
          `The previous solution failed ${result.failed}/${result.total} tests.`,
          `PROBLEM:\n${prob.question}`,
          `FUNCTION: ${prob.functionName}(${prob.params}) -> ${prob.returnType}`,
          `FAILING SOLUTION (${lang}):\n\`\`\`${lang}\n${codeBlock.code}\n\`\`\``,
          `FAILING CASES:\n${failures}`,
          `Fix the solution. Keep the same function name \`${prob.functionName}\`. Use ${lang}. Return the corrected solution and a \`\`\`${lang}:tests block.`,
        ].join('\n\n'),
        'coding',
        null,
        null,
        instructions,
      )
      if (!current()) return

      if (retryContent) {
        await executeAndRetry(retryContent, prob, instructions, askFn, controller)
        return
      }
      setError('The assistant did not complete the retry. The last test result is still available.')
      setStage('idle')
      return
    }

    setStage('done')
  }, [])

  const process = useCallback(async (frame: string, instructions: string | null) => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const current = () => active.current === controller && !controller.signal.aborted
    setError(null)
    setTestResult(null)

    try {
      setStage('extracting')
      const res = await fetch('/api/copilot/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: frame }),
        signal: controller.signal,
      })
      if (!current()) { void res.body?.cancel().catch(() => {}); return }

      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: 'Extract failed' }))
        throw new Error(msg.error || 'Extract failed')
      }

      const extracted = await res.json()
      if (!current()) return

      if ('noProblem' in extracted && extracted.noProblem) {
        setStage('idle')
        return
      }

      const prob = extracted as ExtractedProblem
      setProblem(prob)
      retries.current = 0

      const lang = normalizeLanguage(prob.language || 'python')
      preloadRuntime(lang)

      setStage('solving')
      const solveContext = [
        `EXTRACTED PROBLEM:\n${prob.question}`,
        `FUNCTION: ${prob.functionName}(${prob.params}) -> ${prob.returnType}`,
        `LANGUAGE: ${lang} (use this language for solution AND tests)`,
        prob.constraints.length > 0 ? `CONSTRAINTS: ${prob.constraints.join('; ')}` : null,
        prob.examples.length > 0
          ? `EXAMPLES:\n${prob.examples.map(e => `  Input: ${e.input} → Output: ${e.output}`).join('\n')}`
          : null,
        `REQUIRED TEST CASES (include ALL of these in your \`\`\`${lang}:tests block):\n${prob.testAsserts}`,
        prob.edgeCases.length > 0 ? `EDGE CASES TO COVER: ${prob.edgeCases.join(', ')}` : null,
      ].filter(Boolean).join('\n\n')

      const content = await ask(
        `Solve: ${prob.question}`,
        'coding',
        frame,
        solveContext,
        instructions,
      )
      if (!current()) return

      if (!content) {
        setStage('idle')
        setError('The assistant did not complete a solution. Please retry.')
        return
      }

      await executeAndRetry(content, prob, instructions, ask, controller)
    } catch (e) {
      if (!current()) return
      setError(e instanceof Error ? e.message : 'Pipeline failed')
      setStage('idle')
    } finally {
      if (active.current === controller) active.current = null
    }
  }, [ask, executeAndRetry])

  const reset = useCallback(() => {
    active.current?.abort()
    active.current = null
    setStage('idle')
    setProblem(null)
    setTestResult(null)
    setError(null)
    retries.current = 0
  }, [])

  return { stage, problem, testResult, error, process, reset }
}
