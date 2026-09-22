import { describe, expect, it } from 'vitest'
import { AnswerClock, deliveryMetrics } from './metrics'

describe('practice delivery measurements', () => {
  it('counts words and whole English filler phrases without treating substrings as speech events', () => {
    const metrics = deliveryMetrics('Um, a human knows. UH! I mean, you know, I like a likely outcome.', 12_000, 'microphone')
    expect(metrics.words).toBe(14)
    expect(metrics.approximateWpm).toBe(70)
    expect(metrics.fillers).toEqual([
      { phrase: 'um', count: 1, contextual: false }, { phrase: 'uh', count: 1, contextual: false },
      { phrase: 'like', count: 1, contextual: true }, { phrase: 'you know', count: 1, contextual: true }, { phrase: 'I mean', count: 1, contextual: true },
    ])
  })
  it('does not manufacture speech speed from typing, no time, or a very short sample', () => {
    expect(deliveryMetrics('This is typed.', 60_000, 'typed')).toMatchObject({ activeMs: 0, approximateWpm: null })
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 999]) expect(deliveryMetrics('Hello there', duration, 'microphone').approximateWpm).toBeNull()
    expect(deliveryMetrics('', 60_000, 'microphone').approximateWpm).toBeNull()
  })
  it('accumulates only listening intervals and excludes setup, feedback and paused time', () => {
    const clock = new AnswerClock()
    expect(clock.elapsed(5_000)).toBe(0)
    clock.start(5_000)
    clock.start(10_000)
    clock.pause(15_000)
    expect(clock.elapsed(40_000)).toBe(10_000)
    clock.start(40_000)
    expect(clock.elapsed(45_000)).toBe(15_000)
    clock.pause(50_000)
    clock.pause(55_000)
    expect(clock.elapsed(90_000)).toBe(20_000)
    clock.reset()
    expect(clock.elapsed(100_000)).toBe(0)
  })
})
