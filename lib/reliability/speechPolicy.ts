export const SPEECH_PROVIDERS = ['deepgram', 'assemblyai'] as const
export function configuredSpeechProviders(env: Record<string, string | undefined> = process.env) {
  return SPEECH_PROVIDERS.filter(provider => Boolean(env[provider === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'ASSEMBLYAI_API_KEY']))
}
/** Gate every enabled adapter, not an unconfigured optional vendor. At least one
 * adapter is required, and any failure of an enabled adapter still blocks release. */
export function speechConfiguration(env: Record<string, string | undefined> = process.env) {
  const enabled = configuredSpeechProviders(env)
  return { enabled, unconfigured: SPEECH_PROVIDERS.filter(provider => !enabled.includes(provider)), hasProvider: enabled.length > 0 }
}
