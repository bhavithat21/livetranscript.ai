import { describe, it, expect } from 'vitest'
import { extractCode, extractTests, normalizeLanguage, canExecute } from './codeExecutor'

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
  it('returns true for python, javascript, typescript', () => {
    expect(canExecute('python')).toBe(true)
    expect(canExecute('javascript')).toBe(true)
    expect(canExecute('typescript')).toBe(true)
    expect(canExecute('py')).toBe(true)
    expect(canExecute('js')).toBe(true)
  })
  it('returns false for non-executable languages', () => {
    expect(canExecute('java')).toBe(false)
    expect(canExecute('cpp')).toBe(false)
    expect(canExecute('go')).toBe(false)
    expect(canExecute('rust')).toBe(false)
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
