import { expect, it, vi } from 'vitest'
import { startIndependentChannels } from './channelStartup'
it('starts a microphone even when call permission is denied, with no stop of healthy inputs', async () => {
  const mic = vi.fn(async () => {})
  const errors = await startIndependentChannels([{ name: 'system', start: async () => { throw new Error('Permission denied') } }, { name: 'mic', start: mic }], () => true)
  expect(errors).toEqual(['Call audio: Permission denied']); expect(mic).toHaveBeenCalledTimes(1)
})
it('does not open another permission dialog after cancellation', async () => {
  let current = true
  const mic = vi.fn()
  await startIndependentChannels([{ name: 'system', start: async () => { current = false } }, { name: 'mic', start: mic }], () => current)
  expect(mic).not.toHaveBeenCalled()
})
