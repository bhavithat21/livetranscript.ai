import { describe, it, expect, vi, afterEach } from 'vitest'
import { runRemoteTests, canExecuteRemote } from './remoteRunner'

// The remote runner's only non-trivial logic is parsing Judge0 stdout (PASS/FAIL
// lines) + compile-error/empty handling into the unified TestRunResult. We stub
// fetch to feed it representative executor responses.
const stubFetch = (json: object, ok = true) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => json }) as unknown as Response))
}
afterEach(() => vi.unstubAllGlobals())

describe('remoteRunner', () => {
  it('knows which languages run remotely', () => {
    expect(canExecuteRemote('go')).toBe(true)
    expect(canExecuteRemote('rust')).toBe(true)
    expect(canExecuteRemote('python')).toBe(false) // local, not remote
  })

  it('parses PASS/FAIL lines into pass/fail counts + labels', async () => {
    stubFetch({ stdout: 'PASS example1\nFAIL dup :: got [1,0]\nPASS empty', stderr: '', compileOutput: '', status: 'Accepted', ok: true })
    const r = await runRemoteTests('program', 'go')
    expect(r.total).toBe(3)
    expect(r.passed).toBe(2)
    expect(r.failed).toBe(1)
    expect(r.cases.find((c) => c.label === 'dup')?.error).toBe('got [1,0]')
  })

  it('surfaces a compile error as one explanatory failed case', async () => {
    stubFetch({ stdout: '', stderr: '', compileOutput: "main.go:3: undefined: foo", status: 'Compilation Error', ok: false })
    const r = await runRemoteTests('bad', 'go')
    expect(r.failed).toBe(1)
    expect(r.cases[0].error).toContain('Compile error')
  })

  it('does not report a silent zero when the program printed no results', async () => {
    stubFetch({ stdout: 'random output', stderr: 'panic: nil deref', compileOutput: '', status: 'Runtime Error', ok: false })
    const r = await runRemoteTests('x', 'go')
    expect(r.total).toBe(1)
    expect(r.cases[0].passed).toBe(false)
    expect(r.cases[0].error).toContain('No test results')
  })

  it('does NOT report all-green when the harness crashed after some PASSes (non-zero exit)', async () => {
    // 2 PASS lines flushed, then the process crashed (ok:false). Must not read as green.
    stubFetch({ stdout: 'PASS t1\nPASS t2', stderr: 'panic: index out of range', compileOutput: '', status: 'Runtime Error', ok: false })
    const r = await runRemoteTests('program', 'go')
    expect(r.passed).toBe(2)
    expect(r.failed).toBeGreaterThanOrEqual(1) // the synthetic "run did not complete" case
    expect(r.cases.some((c) => !c.passed && /did not complete/.test(c.label))).toBe(true)
  })

  it('reports clean green only when the run finished (ok:true)', async () => {
    stubFetch({ stdout: 'PASS t1\nPASS t2', stderr: '', compileOutput: '', status: 'Accepted', ok: true })
    const r = await runRemoteTests('program', 'go')
    expect(r.failed).toBe(0)
    expect(r.passed).toBe(2)
  })

  it('handles the route being down', async () => {
    stubFetch({ error: 'Executor unavailable (502)' }, false)
    const r = await runRemoteTests('x', 'go')
    expect(r.cases[0].passed).toBe(false)
  })
})
