import { expect, it } from 'vitest'
import { KeyframeGate } from './keyframes'

it('does not postpone reading forever while typing or terminal output keeps changing', () => {
  const gate = new KeyframeGate()
  const frame = (n: number) => ({ fingerprint: String(n), width: 24, height: 24, pixels: new Uint8Array(24 * 24).fill(n % 2 ? 255 : 0) })
  for (let n = 0; n < 6; n++) expect(gate.sample(frame(n), n * 200).capture).toBe(false)
  expect(gate.sample(frame(6), 1200).capture).toBe(true)
  expect(gate.sample(frame(7), 1400).reason).toBe('busy')
  gate.finish(frame(6), true)
  expect(gate.sample(frame(6), 1600).reason).toBe('unchanged')
})
