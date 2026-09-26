// @vitest-environment node
import { expect, it } from 'vitest'
import { rehearsalEnabled, rehearsalPreflight } from './preflight'
it('denies production even when explicitly enabled and enables only the named preview by default',()=>{
  expect(rehearsalEnabled({VERCEL_ENV:'production',COPILOT_REHEARSAL_ENABLED:'1'})).toBe(false)
  expect(rehearsalEnabled({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'other'})).toBe(false)
  expect(rehearsalEnabled({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fix/spoken-requirements-rehearsal-20260926'})).toBe(true)
})
it('reports presence only, refuses missing/placeholder credentials and does not reveal secrets',()=>{
  const env={COPILOT_REHEARSAL_ENABLED:'1',DEEPGRAM_API_KEY:'test-nonsecret-speech',ANTHROPIC_API_KEY:'test-nonsecret-anthropic'}
  const report=rehearsalPreflight(env)
  expect(report.ready).toBe(true);expect(report.providerCalls).toBe(0);expect(JSON.stringify(report)).not.toContain('test-nonsecret')
  expect(rehearsalPreflight({...env,ANTHROPIC_API_KEY:'your_anthropic_api_key'}).ready).toBe(false)
  expect(rehearsalPreflight({...env,COPILOT_COACH_TALK_MODEL:'gpt-x'}).ready).toBe(false)
})
