import { expect, it } from 'vitest'
import { liveCoachModel } from './liveModel'
import { DEFAULT_LIVE_MODEL, DEFAULT_REPO_MODEL } from '../repo/modelPolicy'
it('uses keyed operational defaults rather than requiring an unconfigured vendor', () => {
  const env = { GROQ_API_KEY: 'fixture', ANTHROPIC_API_KEY: 'fixture' }
  expect(liveCoachModel('talk', env)).toBe('openai/gpt-oss-120b')
  expect(liveCoachModel('guide', env)).toBe('claude-sonnet-5-5')
  expect(liveCoachModel('review', env)).toBe('claude-sonnet-5-5')
})
it('preserves defaults when their provider is configured', () => {
  const env = { OPENAI_API_KEY: 'fixture', ANTHROPIC_API_KEY: 'fixture' }
  expect(liveCoachModel('talk', env)).toBe(DEFAULT_LIVE_MODEL)
  expect(liveCoachModel('guide', env)).toBe(DEFAULT_REPO_MODEL)
})
it('never silently rewrites explicit role or lane configuration, even without its key', () => {
  const env = { GROQ_API_KEY: 'fixture', COPILOT_COACH_TALK_MODEL: 'gpt-explicit', COPILOT_REPO_MODEL_IMPLEMENTATION: 'gpt-other' }
  expect(liveCoachModel('talk', env)).toBe('gpt-explicit')
  expect(liveCoachModel('guide', env)).toBe('gpt-other')
})
it('does not substitute an unkeyed fallback or invent access when no provider exists', () => {
  expect(liveCoachModel('talk', {})).toBe(DEFAULT_LIVE_MODEL)
  expect(liveCoachModel('guide', {})).toBe(DEFAULT_REPO_MODEL)
})
