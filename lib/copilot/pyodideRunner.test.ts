import { describe, it, expect } from 'vitest'
import { extractPython } from './pyodideRunner'

describe('extractPython', () => {
  it('pulls a python fenced block out of a markdown answer', () => {
    const md = 'Approach: use a set.\n\n```python\ndef f(x):\n    return x + 1\n```\nDone.'
    expect(extractPython(md)).toBe('def f(x):\n    return x + 1')
  })
  it('matches a bare ``` block and a py-tagged block', () => {
    expect(extractPython('```\nprint(1)\n```')).toBe('print(1)')
    expect(extractPython('```py\nprint(2)\n```')).toBe('print(2)')
  })
  it('returns null when there is no code block', () => {
    expect(extractPython('just prose, no code')).toBeNull()
  })
})
