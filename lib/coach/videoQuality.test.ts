import { describe, expect, it } from 'vitest'
import { buildContext, nextInspection, parseContext } from './context'
import { emptyCoach } from './state'
import { questionCandidates } from '../copilot/questionDetection'
import { ProactiveEngine } from '../copilot/proactiveEngine'
import { VirtualClock } from './simulation/clock'

describe('mock interview video regressions', () => {
  it.each([
    'Is the report generation asynchronous or synchronous.',
    'Does the server block while generating a report.',
    'Can the client poll for completion.',
    'I would like to see how you use this AI agent to find the slow step.',
    'What are some ways that we can prevent that timeout but still get the job done?',
  ])('detects spoken requests even with ASR punctuation: %s', question => {
    expect(questionCandidates(question).at(-1)?.question).toBe(question)
  })
  it.each([
    'Is it the.', 'Are the AI.', 'What are some ways that we can.',
    "Is it the I mean, let's again, I would ask you, are the AI.",
    'Being a practicing attorney is going to look closer to Suits.',
    'The service is synchronous.', 'Does that make sense?',
  ])('does not bill a fragment, statement, or logistics: %s', text => {
    expect(questionCandidates(text)).toEqual([])
  })
  it('uses the repaired question instead of its abandoned stem', () => {
    expect(questionCandidates('Is it the, I mean, is the report generation synchronous?').at(-1)?.question)
      .toBe('is the report generation synchronous?')
  })
  it('dispatches once when a fragmented question finishes, then ignores punctuation revision', async () => {
    const clock = new VirtualClock(), asked: string[] = []
    let transcript = 'What are some ways that we can.'
    const engine = new ProactiveEngine(() => transcript, q => { asked.push(q) }, {}, clock)
    engine.start()
    await clock.advance(1500)
    expect(asked).toEqual([])
    transcript = 'What are some ways that we can prevent the timeout but still get the job done?'
    await clock.advance(1500)
    expect(asked).toEqual([transcript])
    transcript = transcript.replace('?', '.')
    await clock.advance(1500)
    expect(asked).toHaveLength(1)
    engine.stop()
  })
  it('skips tree folders and clipped filenames when suggesting the next file', () => {
    const state = emptyCoach('video')
    state.knownPaths = ['build', '.idea', 'java/com/myservice/demo', 'FinancialReportGeneratorServi...', 'src/main/java/com/myservice/demo/ReportGenerator.java']
    state.task.objective = 'Investigate build and java/com/myservice/demo'
    expect(nextInspection(state)?.path).toBe('src/main/java/com/myservice/demo/ReportGenerator.java')
  })
  it('does not invent line numbers for directory-only evidence', () => {
    const state = emptyCoach('video')
    state.knownPaths = ['build', '.idea', 'src', 'src/main', 'java/com/myservice/demo']
    expect(nextInspection(state)).toBeNull()
  })
  it('rejects a pending directory target and permits known extensionless build files', () => {
    const state = emptyCoach('video')
    state.knownPaths = ['build', 'Dockerfile']
    state.navigation = { path: 'build', startLine: 1, endLine: 1, symbol: '', reason: 'Inspect code', status: 'pending', requestedAfter: 0 }
    expect(nextInspection(state)?.path).toBe('Dockerfile')
  })
})

it('keeps observed code in context even when many unseen paths rank higher', () => {
  const state = emptyCoach('ranking')
  state.permission = 'practice'
  state.task.objective = 'Explain report generation'
  state.question = { id: 'q', original: 'Explain report generation', text: 'Explain report generation', at: 1 }
  state.knownPaths = [...Array.from({ length: 150 }, (_, i) => `report/generation${i}.java`), 'Service.java']
  state.files = [{ path: 'Service.java', language: 'java', version: 1, contentKey: 's', retired: [], lastSeen: 1, fragments: [{ path: 'Service.java', language: 'java', startLine: 1, lines: ['class Service {}'], confidence: 1, endOfFile: true, sources: ['screen-1'] }] }]
  const packet = buildContext(state, 10000)
  expect(packet.files.map(file => file.path)).toEqual(['Service.java'])
  expect(() => parseContext(packet)).not.toThrow()
})
