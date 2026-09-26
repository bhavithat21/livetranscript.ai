import { repoModelFor, repoProvider, validRepoModel } from '@/lib/repo/modelPolicy'

type Env = Record<string, string | undefined>
export function rehearsalEnabled(env: Env = process.env) {
  return env.VERCEL_ENV !== 'production' && (env.COPILOT_REHEARSAL_ENABLED === '1' || (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'fix/spoken-requirements-rehearsal-20260926'))
}
export function rehearsalPreflight(env: Env = process.env) {
  // Presence checks only: no secret values leave the server and no paid calls.
  const present = (key: string) => !!env[key]?.trim() && !/your_|xxxxxxxx|sk-your|placeholder/i.test(env[key]!)
  const speech = { deepgram: present('DEEPGRAM_API_KEY'), assemblyai: present('ASSEMBLYAI_API_KEY') }
  const models = (['talk','guide','review','vision'] as const).map(lane => {
    let model = '', configured = false
    try {
      const purpose = lane === 'talk' ? 'requirements' : lane === 'guide' ? 'implementation' : lane === 'review' ? 'reviewer' : 'vision'
      model = (lane !== 'vision' && env[`COPILOT_COACH_${lane.toUpperCase()}_MODEL`]) || repoModelFor(purpose, env).model
      const key = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY' }[repoProvider(model)]
      configured = validRepoModel(model) && present(key) && (lane !== 'vision' || model.startsWith('claude-'))
    } catch { model = 'invalid configuration' }
    return { lane, model, configured }
  })
  const ready = rehearsalEnabled(env) && (speech.deepgram || speech.assemblyai) && models.every(m => m.configured)
  return { version: 1, ready, environment: env.VERCEL_ENV || 'local', commit: env.VERCEL_GIT_COMMIT_SHA || 'local-unpinned', speech, models,
    providerCalls: 0, audioReplayed: false, note: 'Configuration presence only, not validated credentials, model availability or rehearsal accuracy. Lessons are frozen in this workspace.' }
}
