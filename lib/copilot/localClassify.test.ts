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

  it('escalates AMBIGUOUS questions to the LLM (returns null) rather than guessing', () => {
    // "design a function" trips both coding and systemDesign signals → don't guess.
    expect(localClassify('Design a function to sort this array.')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(localClassify('')).toBeNull()
    expect(localClassify('   ')).toBeNull()
  })
})
