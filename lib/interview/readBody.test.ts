// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readInterviewBody } from './readBody'
import { MAX_BODY_BYTES } from './model'

describe('bounded interview request reader', () => {
  it('reads JSON and non-ASCII content', async () => {
    const body = { text: 'Résumé — 你好' }
    expect(await readInterviewBody(new Request('https://test.local', { method: 'POST', body: JSON.stringify(body) }))).toEqual(body)
  })
  it('rejects invalid or missing JSON', async () => {
    await expect(readInterviewBody(new Request('https://test.local', { method: 'POST', body: '{broken' }))).rejects.toThrow(/Invalid JSON/)
    await expect(readInterviewBody(new Request('https://test.local', { method: 'POST' }))).rejects.toThrow(/body is required/)
  })
  it('enforces the actual byte limit without Content-Length', async () => {
    const request = new Request('https://test.local', { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) })
    await expect(readInterviewBody(request)).rejects.toThrow(/too large/)
  })
  it('rejects an oversized declared request before reading it', async () => {
    const request = new Request('https://test.local', { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: '{}' })
    await expect(readInterviewBody(request)).rejects.toThrow(/too large/)
  })
})
