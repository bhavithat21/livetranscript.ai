// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mintTranscriptionToken } from './token'
beforeEach(() => { vi.stubEnv('DEEPGRAM_API_KEY', 'fixture-secret'); vi.stubEnv('ASSEMBLYAI_API_KEY', 'fixture-secret') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('fails closed without provider credentials and makes no network call', async () => {
  vi.stubEnv('DEEPGRAM_API_KEY', '')
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(mintTranscriptionToken('deepgram')).rejects.toMatchObject({ status: 503, retryable: false })
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([401, 403, 404])('does not turn permanent upstream %i into a retry loop or expose its body', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE_ERROR_AND_SECRET', { status })))
  const failure = await mintTranscriptionToken('deepgram').catch(error => error)
  expect(failure).toMatchObject({ status: 502, retryable: false })
  expect(String(failure)).not.toContain('PRIVATE_ERROR_AND_SECRET')
})
it.each([429, 500, 503])('marks a temporary upstream %i as retryable', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
  await expect(mintTranscriptionToken('assemblyai')).rejects.toMatchObject({ retryable: true })
})
it('returns a validated ephemeral token without a successful result for malformed output', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'ephemeral-fixture' })).mockResolvedValueOnce(Response.json({ token: null }))
  vi.stubGlobal('fetch', fetcher)
  await expect(mintTranscriptionToken('deepgram')).resolves.toMatchObject({ token: 'ephemeral-fixture' })
  await expect(mintTranscriptionToken('assemblyai')).rejects.toMatchObject({ status: 502, retryable: false })
})
