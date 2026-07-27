import { describe, it, expect } from 'vitest'
import { latestQuestion, latestQuestionGroup } from './useProactive'

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

  // Diarization (on by default) prefixes each line with "Speaker N: ". The label
  // must not block detection, and must not leak into the returned question.
  describe('with speaker labels (diarization on)', () => {
    it('detects a period-ended question behind a Speaker label', () => {
      // The exact case that silently broke: cue pushed off the front by the label.
      expect(latestQuestion('Speaker 2: Walk me through your resume.')).toBe('Walk me through your resume.')
      expect(latestQuestion('Speaker 1: Tell me about a time you failed.')).toBe('Tell me about a time you failed.')
    })
    it('detects a ?-ended question behind a label and strips the label from the result', () => {
      expect(latestQuestion('Speaker 3: What is your biggest weakness?')).toBe('What is your biggest weakness?')
    })
    it('strips label AND leading filler, keeping the interrogative cue', () => {
      // "So," is filler → stripped; "can you" is a cue → kept (it's the question stem).
      expect(latestQuestion('Speaker 2: So, can you design a rate limiter.')).toBe('can you design a rate limiter.')
    })
    it('still ignores a labeled statement', () => {
      expect(latestQuestion('Speaker 1: I worked at Google for three years.')).toBeNull()
    })
    it('picks the newest labeled question across multiple speakers', () => {
      const t = 'Speaker 1: I built the pipeline. Speaker 2: How did you handle failures.'
      expect(latestQuestion(t)).toBe('How did you handle failures.')
    })
  })
})

describe('latestQuestionGroup (multi-part questions)', () => {
  it('joins contiguous question parts into one combined question', () => {
    const t = 'Tell me about a challenge you faced. And how did you measure the impact? And what would you do differently?'
    const g = latestQuestionGroup(t)
    expect(g).toContain('challenge')
    expect(g).toContain('measure the impact')
    expect(g).toContain('do differently')
  })
  it('returns a single question unchanged when there is only one part', () => {
    expect(latestQuestionGroup('Reverse a linked list.')).toBe('Reverse a linked list.')
  })
  it('does not pull in a preceding non-question statement', () => {
    const g = latestQuestionGroup('I worked at Google for three years. How would you design a rate limiter?')
    expect(g).toContain('rate limiter')
    expect(g).not.toContain('Google')
  })
  it('returns null when there is no question', () => {
    expect(latestQuestionGroup('I shipped it to production last week.')).toBeNull()
  })
})

