import { describe, it, expect } from 'vitest'
import { speakerColor, SPEAKER_PALETTE } from './palette'

describe('speakerColor', () => {
  it('assigns a distinct palette color to speakers 0-4', () => {
    const colors = [0, 1, 2, 3, 4].map((i) => speakerColor(i, 'light').color)
    expect(new Set(colors).size).toBe(5)
  })
  it('falls back to neutral for a 6th speaker', () => {
    expect(speakerColor(5, 'light').color).toBe(SPEAKER_PALETTE.neutral.light)
  })
  it('provides light and dark variants', () => {
    expect(speakerColor(0, 'light').color).not.toBe(speakerColor(0, 'dark').color)
  })
})
