import { expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { runPreflight } from '../../lib/reliability/preflight'
import { renderVisionFixture } from '../vision/render'
import { visionFixtures } from '../vision/fixtures'
import { DeepgramProvider } from '../../lib/transcription/deepgram'
import { AssemblyAIProvider } from '../../lib/transcription/assemblyai'
import { RecoveringTranscription } from '../../lib/transcription/recovery'
import { mintTranscriptionToken } from '../../lib/transcription/token'
import { diagnosticCode } from '../../lib/diagnostics/schema'
import speech from './speech.json'

/** Paid and explicit. No skip-on-missing-key path. Reports contain no tokens,
 * source, audio or transcript. The fixture is synthetic, not interview content. */
it('requires actual model, screen and ASR reconnect probes before production release', async () => {
  const report: Record<string, unknown> = { version: 1, at: Date.now(), commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA, scope: 'synthetic-server-acceptance', deviceVerified: false, passed: false }
  const root = 'public'; mkdirSync(root, { recursive: true })
  const save = () => writeFileSync(`${root}/release-readiness.json`, JSON.stringify(report, null, 2))
  const nativeFetch = globalThis.fetch
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 165_000)
  try {
    if (process.env.VERCEL_ENV !== 'production' && process.env.LT_RUN_LIVE_ACCEPTANCE !== '1') throw new Error('Live acceptance requires explicit opt-in')
    const missing = ['DEEPGRAM_API_KEY', 'ASSEMBLYAI_API_KEY'].filter(key => !process.env[key])
    if (missing.length) throw new Error('Required ASR credentials missing: live acceptance did not run')
    if (typeof WebSocket === 'undefined') throw new Error('Live acceptance requires Node 22 or newer with WebSocket')
    const fixture = visionFixtures[0], rendered = await renderVisionFixture(fixture)
    const models = await runPreflight(abort.signal, rendered.png.toString('base64'), observation => {
      for (const expected of fixture.expected.files) {
        const actual = observation.files.find(file => file.path === expected.path && file.startLine === expected.startLine)
        if (!actual || actual.lines.join('\n') !== expected.lines.join('\n')) throw new Error('Screenshot evidence failed exact source validation')
      }
    })
    report.models = models; save()
    expect(models.passed, 'At least one configured provider/vision probe failed; inspect metadata report').toBe(true)
    // Invoke the real browser providers from Node. Only their relative token
    // request is adapted; minting, remote WebSockets and recognition remain real.
    globalThis.fetch = (async (input, init) => {
      if (input === '/api/token') {
        const provider = JSON.parse(String(init?.body)).provider
        if (provider !== 'deepgram' && provider !== 'assemblyai') throw new Error('Invalid probe token request')
        return Response.json(await mintTranscriptionToken(provider, init?.signal ?? undefined))
      }
      return nativeFetch(input, init)
    }) as typeof fetch
    const pcm = gunzipSync(Buffer.from(speech.audio, 'base64'))
    const results: Array<{ provider: string; passed: boolean; recovered: boolean; durationMs: number }> = []
    for (const name of ['deepgram', 'assemblyai'] as const) {
      const started = Date.now(), config = { sampleRate: 16000, maxSpeakers: 2, keyterms: [], signal: abort.signal }
      const make = () => name === 'deepgram' ? new DeepgramProvider() : new AssemblyAIProvider()
      const first = make(); await first.connect(config)
      let matches = 0, recovered = false, failed = false
      const wrapper = new RecoveringTranscription({ name, provider: first }, config, async next => { const provider = make(); await provider.connect(next); return { name, provider } }, event => { if (event.state === 'reconnected') recovered = true })
      const seen = new Set<string>()
      wrapper.onStatus(() => { failed = true })
      wrapper.onFinal(event => { if (/explain.*code/i.test(event.text) && !seen.has(event.utteranceId!)) { seen.add(event.utteranceId!); matches++ } })
      const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
      async function until(condition: () => boolean, limit = 15_000) {
        const end = Date.now() + limit
        while (!condition()) { abort.signal.throwIfAborted(); if (failed || Date.now() > end) throw new Error('ASR probe did not deliver recognized speech/recovery'); await wait(50) }
      }
      async function play() {
        for (let at = 0; at < pcm.length; at += 3200) {
          abort.signal.throwIfAborted()
          const chunk = Uint8Array.from(pcm.subarray(at, at + 3200)); wrapper.sendAudio(chunk.buffer); await wait(100)
        }
      }
      try {
        await play(); await until(() => matches >= 1)
        expect(wrapper.testConnectionLoss()).toBe(true)
        await until(() => recovered)
        await play(); await until(() => matches >= 2)
        await wrapper.disconnect()
        expect(wrapper.testConnectionLoss()).toBe(false)
        results.push({ provider: name, passed: true, recovered, durationMs: Date.now() - started })
        report.transcription = results; save()
      } finally { await wrapper.disconnect() }
    }
    report.passed = true; save()
  } catch (error) {
    // Fail closed without dumping SDK error bodies, tokens, or recognized text.
    report.failure = diagnosticCode(error, (error as { status?: number })?.status); save()
    throw new Error('Live acceptance failed. See release-readiness.json for safe check results.')
  } finally { clearTimeout(timeout); abort.abort(); globalThis.fetch = nativeFetch }
})
