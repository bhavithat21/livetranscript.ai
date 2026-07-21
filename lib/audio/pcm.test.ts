import { describe, it, expect } from 'vitest'
import { floatTo16BitPCM } from './pcm'

describe('floatTo16BitPCM', () => {
  it('maps 0 to 0, +1 to 32767, -1 to -32768', () => {
    const out = floatTo16BitPCM(new Float32Array([0, 1, -1]))
    expect(Array.from(out)).toEqual([0, 32767, -32768])
  })
  it('clamps values beyond [-1,1]', () => {
    const out = floatTo16BitPCM(new Float32Array([2, -2]))
    expect(Array.from(out)).toEqual([32767, -32768])
  })
})
