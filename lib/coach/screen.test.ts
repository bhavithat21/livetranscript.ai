import { afterEach, expect, it, vi } from 'vitest'
import { httpCapture, ScreenObserver } from './screen'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
it('shows the safe server error instead of hiding its reason behind status 502', async () => {
  // Match the endpoint's permanent validation-failure contract. A real fetch
  // returns a fresh, consumable response for each request, not one shared body.
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Screenshot extraction returned invalid evidence. Try a clearer capture.' }), { status: 502, headers: { 'x-lt-retryable': 'false' } }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(httpCapture('data:image/png;base64,AAAA', new AbortController().signal)).rejects.toThrow('invalid evidence')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('preserves the safe response reason after transient retries are exhausted', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const fetchMock = vi.fn(async () => Response.json({ error: 'Screen provider is temporarily busy.' }, { status: 502 }))
  vi.stubGlobal('fetch', fetchMock)
  const failure = httpCapture('data:image/png;base64,AAAA', new AbortController().signal).catch(error => error)
  await vi.advanceTimersByTimeAsync(1500)
  expect(await failure).toHaveProperty('message', 'Screen provider is temporarily busy.')
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
it('can retry failed analysis using the already selected screen', async () => {
  const stop = vi.fn(), transport = vi.fn().mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValue({ files: [], visiblePaths: [], terminal: '', requirements: [] })
  const observer = new ScreenObserver(vi.fn(), transport)
  await observer.attach({ signal: async () => null, image: async () => 'data:image/png;base64,AAAA', stop }, 'native')
  await observer.captureNow()
  expect(observer.getSnapshot()).toMatchObject({ sharing: true, reading: false, watching: false })
  await observer.captureNow()
  expect(observer.getSnapshot()).toMatchObject({ sharing: true, captures: 1, error: null })
  expect(stop).not.toHaveBeenCalled()
  await observer.stop()
})
