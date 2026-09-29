import { describe, expect, it } from 'vitest'
import { restoreOverlayLayout, type OverlayLayout } from './overlayLayout'
const rect = { x: 16, y: 24, width: 300, height: 160, opacity: 78 }
const defaults: OverlayLayout = { next: rect, say: rect, code: rect, writing: rect, transcript: rect }
describe('saved overlay upgrades', () => {
  it('fills newly introduced panels in an older saved layout without losing valid preferences', () => {
    const result = restoreOverlayLayout(JSON.stringify({ say: { ...rect, opacity: 60 }, code: rect, transcript: rect }), defaults)
    expect(result.next.opacity).toBe(78)
    expect(result.writing.height).toBe(160)
    expect(result.say.opacity).toBe(60)
    expect(defaults.say.opacity).toBe(78)
  })
  it.each(['null', '[]', '3', '"text"', '{bad', '{}', '{"next":null,"say":7}'])('survives invalid persisted layout %s', raw => {
    const result = restoreOverlayLayout(raw, defaults)
    for (const panel of Object.values(result)) expect(panel.opacity).toBe(78)
  })
  it('rejects non-numeric fields and bounds coordinates, dimensions and opacity', () => {
    expect(restoreOverlayLayout('{"next":{"x":-1,"y":999999,"width":"800","height":-20,"opacity":500}}', defaults).next)
      .toEqual({ x: 0, y: 4000, width: 300, height: 96, opacity: 96 })
  })
})
