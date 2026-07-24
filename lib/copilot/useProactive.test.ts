import { describe, it, expect } from 'vitest'
import { latestQuestion } from './useProactive'

// Regression: auto-answer never fired because the old `^cue` regex missed any
// question with a leading filler word ("So tell me…", "Okay, walk me…") and
// ASR-smart-formatted questions rendered with a period instead of '?'. These
// lock in detection of natural spoken questions while keeping statements out.
describe('latestQuestion', () => {
  it('detects questions with leading discourse filler', () => {
    expect(latestQuestion('So tell me about a time you led a project.')).toBeTruthy()
    expect(latestQuestion('Okay, walk me through your resume.')).toBeTruthy()
    expect(latestQuestion('And how would you design a rate limiter.')).toBeTruthy()
    expect(latestQuestion('Um, what is the time complexity here.')).toBeTruthy()
  })

  it('detects clean question marks and mid-transcript questions', () => {
    expect(latestQuestion("What's your biggest weakness?")).toBe("What's your biggest weakness?")
    expect(latestQuestion('Great. So, can you explain how a hash map works.')).toBeTruthy()
  })

  it('returns the newest question and strips leading filler from it', () => {
    const q = latestQuestion('I worked at Google. Now, describe your ideal team.')
    expect(q).toBe('describe your ideal team.')
  })

  it('picks imperative coding prompts', () => {
    expect(latestQuestion("Let's do a coding problem. Reverse a linked list.")).toBe(
      'Reverse a linked list.',
    )
  })

  it('does NOT fire on statements', () => {
    expect(latestQuestion("I think that's a good approach overall.")).toBeNull()
    expect(latestQuestion('So I worked at Google for three years.')).toBeNull()
    expect(latestQuestion('And then we shipped it to production.')).toBeNull()
    expect(latestQuestion('Well that was a great answer, thanks.')).toBeNull()
  })

  it('ignores too-short fragments and empty input', () => {
    expect(latestQuestion('')).toBeNull()
    expect(latestQuestion('Who?')).toBeNull() // under the 8-char floor
  })
})
