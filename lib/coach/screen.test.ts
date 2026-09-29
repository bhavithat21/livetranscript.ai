import { afterEach, expect, it, vi } from 'vitest'
import { httpCapture, ScreenObserver } from './screen'
afterEach(() => vi.unstubAllGlobals())
it('shows the safe server error instead of hiding its reason behind status 502', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Screenshot extraction returned invalid evidence. Try a clearer capture.' }), { status: 502 })))
  await expect(httpCapture('data:image/png;base64,AAAA', new AbortController().signal)).rejects.toThrow('invalid evidence')
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
