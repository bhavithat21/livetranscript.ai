import { describe, it, expect } from 'vitest'
import { extractCode, extractTests, normalizeLanguage, canExecute, isRemoteLanguage } from './codeExecutor'

describe('normalizeLanguage', () => {
  it('normalizes python variants', () => {
    expect(normalizeLanguage('python')).toBe('python')
    expect(normalizeLanguage('py')).toBe('python')
    expect(normalizeLanguage('Python3')).toBe('python')
  })
  it('normalizes javascript variants', () => {
    expect(normalizeLanguage('javascript')).toBe('javascript')
    expect(normalizeLanguage('js')).toBe('javascript')
    expect(normalizeLanguage('node')).toBe('javascript')
  })
  it('normalizes typescript', () => {
    expect(normalizeLanguage('ts')).toBe('typescript')
    expect(normalizeLanguage('TypeScript')).toBe('typescript')
  })
  it('normalizes c++ variants', () => {
    expect(normalizeLanguage('c++')).toBe('cpp')
    expect(normalizeLanguage('cpp')).toBe('cpp')
  })
  it('normalizes c# variants', () => {
    expect(normalizeLanguage('c#')).toBe('csharp')
    expect(normalizeLanguage('csharp')).toBe('csharp')
  })
  it('normalizes go/golang', () => {
    expect(normalizeLanguage('golang')).toBe('go')
    expect(normalizeLanguage('go')).toBe('go')
  })
})

describe('canExecute', () => {
  it('runs python, javascript, typescript LOCALLY (in-browser, not remote)', () => {
    for (const l of ['python', 'javascript', 'typescript', 'py', 'js']) {
      expect(canExecute(l)).toBe(true)
      expect(isRemoteLanguage(l)).toBe(false)
    }
  })
  it('runs compiled languages via the REMOTE executor (still executable, but remote)', () => {
    for (const l of ['java', 'cpp', 'go', 'rust', 'csharp', 'ruby', 'swift', 'kotlin', 'scala']) {
      expect(canExecute(l)).toBe(true)
      expect(isRemoteLanguage(l)).toBe(true)
    }
  })
  it('returns false for a language with no executor at all', () => {
    expect(canExecute('brainfuck')).toBe(false)
    expect(isRemoteLanguage('brainfuck')).toBe(false)
  })
})

describe('extractCode', () => {
  it('extracts a python code block', () => {
    const md = 'Approach:\n\n```python\ndef solve(x):\n    return x + 1\n```\nDone.'
    const result = extractCode(md)
    expect(result).toEqual({ code: 'def solve(x):\n    return x + 1', language: 'python' })
  })
  it('extracts a javascript code block', () => {
    const md = '```javascript\nfunction solve(x) { return x + 1; }\n```'
    const result = extractCode(md)
    expect(result).toEqual({ code: 'function solve(x) { return x + 1; }', language: 'javascript' })
  })
  it('extracts a js-tagged block', () => {
    const md = '```js\nconst f = x => x;\n```'
    const result = extractCode(md)
    expect(result).toEqual({ code: 'const f = x => x;', language: 'javascript' })
  })
  it('returns null when there is no code block', () => {
    expect(extractCode('just text')).toBeNull()
  })
})

describe('extractTests', () => {
  it('extracts a python:tests block', () => {
    const md = '```python\ndef f(): pass\n```\n\n```python:tests\nassert f() is None\n```'
    const result = extractTests(md)
    expect(result).toEqual({ tests: 'assert f() is None', language: 'python' })
  })
  it('extracts a javascript:tests block', () => {
    const md = '```javascript\nfunction f() {}\n```\n\n```javascript:tests\ncheck(f(), undefined, "returns undefined")\n```'
    const result = extractTests(md)
    expect(result).toEqual({ tests: 'check(f(), undefined, "returns undefined")', language: 'javascript' })
  })
  it('returns null when no tests block', () => {
    expect(extractTests('```python\ndef f(): pass\n```')).toBeNull()
  })
  it('does not match a plain code block as tests', () => {
    expect(extractTests('```python\nassert True\n```')).toBeNull()
  })
})
