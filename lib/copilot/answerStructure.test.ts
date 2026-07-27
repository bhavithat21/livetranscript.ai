import { describe, it, expect } from 'vitest'
import { splitAnswer } from './answerStructure'

describe('splitAnswer', () => {
  it('peels a glanceable lede off the front', () => {
    const { lede, body } = splitAnswer('Use a hash map for O(n) lookup.\n\nThen iterate once, checking complements.')
    expect(lede).toBe('Use a hash map for O(n) lookup.')
    expect(body).toContain('iterate once')
  })

  it('strips a leading markdown heading/blockquote marker from the lede', () => {
    expect(splitAnswer('> So the time two teams wanted opposite designs.\n\nSituation...').lede)
      .toBe('So the time two teams wanted opposite designs.')
    expect(splitAnswer('# The deadline story\n\nbody').lede).toBe('The deadline story')
  })

  it('routes glossary / follow-ups / metric-defense into the reserve tier', () => {
    const answer = [
      'Use a hash map.',
      '',
      'Iterate and check complements.',
      '',
      '**Likely follow-ups**',
      '- Why not sorting?',
      '',
      'Glossary',
      'O(n): linear time',
    ].join('\n')
    const { lede, body, reserve } = splitAnswer(answer)
    expect(lede).toBe('Use a hash map.')
    expect(body).toContain('complements')
    expect(reserve).toContain('Likely follow-ups')
    expect(reserve).toContain('Glossary')
    // Reserve content must NOT leak into the read-aloud body.
    expect(body).not.toContain('Glossary')
  })

  it('never loses text when there is no recognizable structure', () => {
    const { lede, body, reserve } = splitAnswer('one line only')
    expect(lede).toBe('one line only')
    expect(body).toBe('')
    expect(reserve).toBe('')
  })

  it('handles empty / whitespace input', () => {
    expect(splitAnswer('')).toEqual({ lede: '', body: '', reserve: '' })
    expect(splitAnswer('   \n  ')).toEqual({ lede: '', body: '', reserve: '' })
  })
})
