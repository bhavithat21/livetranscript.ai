import { describe, it, expect } from 'vitest'
import { localClassify } from './localClassify'

// The local classifier is on the HOT PATH — it must classify obvious questions with
// zero network latency AND never confidently misroute (ambiguous → null → escalate).
describe('localClassify', () => {
  it('routes unambiguous coding questions locally', () => {
    expect(localClassify('Reverse a linked list in place.')?.mode).toBe('coding')
    expect(localClassify('Implement two sum.')?.mode).toBe('coding')
    expect(localClassify('What is the time complexity here?')?.mode).toBe('coding')
  })

  it('routes unambiguous behavioral questions locally', () => {
    expect(localClassify('Tell me about a time you disagreed with your manager.')?.mode).toBe('behavioral')
    expect(localClassify('Describe a situation where you failed.')?.mode).toBe('behavioral')
  })

  it('routes unambiguous system-design questions locally', () => {
    expect(localClassify('Design a URL shortener.')?.mode).toBe('systemDesign')
    expect(localClassify('How would you scale this to a billion requests?')?.mode).toBe('systemDesign')
  })

  it('routes a plain factual question to general', () => {
    expect(localClassify('What is a hash map?')?.mode).toBe('general')
  })

  it('flags freshness questions as needsWeb', () => {
    expect(localClassify('What is the latest version of React?')?.needsWeb).toBe(true)
    expect(localClassify('Any recent changes to the AWS pricing this year?')?.needsWeb).toBe(true)
    expect(localClassify('Reverse a linked list.')?.needsWeb).toBe(false)
  })

  it('escalates AMBIGUOUS / weak-signal questions to the LLM (returns null) rather than guessing', () => {
    // Bare "conflict" is a WEAK token — a git question, not necessarily behavioral.
    expect(localClassify('How do you resolve a merge conflict in git?')).toBeNull()
    // "give feedback on a pull request" — weak "feedback", actually a code-review q.
    expect(localClassify('How do you give feedback on a pull request?')).toBeNull()
    // "design the perfect team culture" — weak "design the", not system design.
    expect(localClassify('How would you design the perfect team culture?')).toBeNull()
    // "sort the workload" — weak "sort the", a staffing question, not an algorithm.
    expect(localClassify('How do you sort the workload across your team?')).toBeNull()
  })

  it('does NOT flag needsWeb for non-general modes (no needless web hop on behavioral)', () => {
    const r = localClassify('Tell me about a time you recently resolved a hard bug.')
    // Strong behavioral stem wins; "recently" must not drag in a web search.
    expect(r?.mode).toBe('behavioral')
    expect(r?.needsWeb).toBe(false)
  })

  it('returns null on empty input', () => {
    expect(localClassify('')).toBeNull()
    expect(localClassify('   ')).toBeNull()
  })
})
