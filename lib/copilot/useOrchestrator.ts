'use client'
import { useCallback, useRef, useState } from 'react'
import {
  extractCode,
  extractTests,
  executeTests,
  canExecute,
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
  const running = useRef(false)
  const retries = useRef(0)

  const executeAndRetry = useCallback(async (
    content: string,
    prob: ExtractedProblem,
    instructions: string | null,
    askFn: AskFn,
  ): Promise<void> => {
    const codeBlock = extractCode(content)
    const testsBlock = extractTests(content)

    if (!codeBlock || !testsBlock) {
      setStage('done')
      return
    }

    const lang = normalizeLanguage(prob.language || codeBlock.language)

    if (!canExecute(lang)) {
      setStage('done')
      return
    }

    setStage('executing')
    const result = await executeTests(codeBlock.code, testsBlock.tests, lang)
    setTestResult(result)

    if (result.failed > 0 && retries.current < MAX_RETRIES) {
      retries.current++
      setStage('retrying')

      const failures = result.cases
        .filter(c => !c.passed)
        .map(c => `- ${c.label}: ${c.error}`)
        .join('\n')

      // Self-contained retry: askFn derives history from a stale `turns` snapshot,
      // so the retry can't rely on the chat thread carrying the problem/solution.
      // Restate the problem, the failing code, and the failing cases inline.
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

      if (retryContent) {
        await executeAndRetry(retryContent, prob, instructions, askFn)
        return
      }
    }

    setStage('done')
  }, [])

  const process = useCallback(async (frame: string, instructions: string | null) => {
    if (running.current) return
    running.current = true
    setError(null)
    setTestResult(null)

    try {
      setStage('extracting')
      const res = await fetch('/api/copilot/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: frame }),
      })

      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: 'Extract failed' }))
        throw new Error(msg.error || 'Extract failed')
      }

      const extracted = await res.json()

      if ('noProblem' in extracted && extracted.noProblem) {
        setStage('idle')
        running.current = false
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

      if (!content) {
        setStage('done')
        running.current = false
        return
      }

      await executeAndRetry(content, prob, instructions, ask)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pipeline failed')
      setStage('idle')
    } finally {
      running.current = false
    }
  }, [ask, executeAndRetry])

  const reset = useCallback(() => {
    setStage('idle')
    setProblem(null)
    setTestResult(null)
    setError(null)
    running.current = false
    retries.current = 0
  }, [])

  return { stage, problem, testResult, error, process, reset }
}
