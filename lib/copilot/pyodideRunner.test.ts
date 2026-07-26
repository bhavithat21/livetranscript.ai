import { describe, it, expect } from 'vitest'
import { extractPython, extractTests } from './pyodideRunner'

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

describe('extractTests', () => {
  it('pulls a python:tests fenced block', () => {
    const md = [
      '```python',
      'def solve(n): return n + 1',
      '```',
      '',
      '```python:tests',
      'assert solve(1) == 2  # normal',
      'assert solve(0) == 1  # zero',
      '```',
    ].join('\n')
    const tests = extractTests(md)
    expect(tests).toContain('assert solve(1) == 2')
    expect(tests).toContain('assert solve(0) == 1')
  })
  it('returns null when there is no tests block', () => {
    const md = '```python\ndef f(): pass\n```'
    expect(extractTests(md)).toBeNull()
  })
  it('does not match a plain python block as tests', () => {
    const md = '```python\nassert True\n```'
    expect(extractTests(md)).toBeNull()
  })
})
