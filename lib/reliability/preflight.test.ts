// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../copilot/modes', () => ({ configuredDraftModel: () => 'draft-test', modelForTier: () => 'smart-test' }))
vi.mock('../copilot/providers', () => ({ probeAnswerModel: vi.fn(async () => {}) }))
vi.mock('../repo/agentProviders', () => ({ streamRepoModel: vi.fn(async function* () { yield { text: 'READY', model: 'fixture' } }) }))
vi.mock('../repo/modelPolicy', () => ({ repoModelFor: () => ({ model: 'fixture' }) }))
vi.mock('../repo/screenProvider', () => ({ extractScreenEvidence: vi.fn(async () => ({ observation: { files: [], visiblePaths: [], terminal: '', requirements: [] } })) }))
vi.mock('../transcription/token', () => ({ mintTranscriptionToken: vi.fn(async () => ({ token: 'PRIVATE_TEST_TOKEN', expiresAt: 0 })) }))
import { runPreflight } from './preflight'
import { probeAnswerModel } from '../copilot/providers'
import { extractScreenEvidence } from '../repo/screenProvider'
beforeEach(() => vi.clearAllMocks())
it('tests actual configured paths but never claims device verification or exposes tokens', async () => {
  const result = await runPreflight(new AbortController().signal)
  expect(result.passed).toBe(true); expect(result.deviceVerified).toBe(false)
  expect(result.checks).toHaveLength(8)
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TEST_TOKEN')
})
it('fails closed on an unavailable draft and does not hide it with fallback', async () => {
  vi.mocked(probeAnswerModel).mockRejectedValueOnce(Object.assign(new Error('PRIVATE_PROVIDER_MESSAGE'), { status: 404 }))
  const result = await runPreflight(new AbortController().signal)
  expect(result.passed).toBe(false); expect(result.checks.find(check => check.role === 'draft')).toMatchObject({ status: 'failed', code: 'provider_unavailable' })
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_MESSAGE')
})
it('fails a rendered-source mismatch even when the provider returned valid JSON', async () => {
  const result = await runPreflight(new AbortController().signal, 'fixture', () => { throw new Error('Invalid evidence') })
  expect(extractScreenEvidence).toHaveBeenCalled(); expect(result.checks.find(check => check.role === 'screen')?.status).toBe('failed')
})
