import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
const production = process.env.VERCEL_ENV === 'production'
// Isolated diagnostic preview only. Never promotes a failed probe to production.
const diagnosticPreview = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'diagnostic/provider-acceptance'
const enabled = production || diagnosticPreview || process.env.LT_RUN_LIVE_ACCEPTANCE === '1'
mkdirSync('public', { recursive: true })
if (!enabled) {
  writeFileSync('public/release-readiness.json', JSON.stringify({ passed: false, scope: 'not-run', deviceVerified: false }))
  console.log('[readiness] Paid live acceptance was NOT run for this local/preview build.')
} else {
  console.log('[readiness] Running bounded synthetic model, vision and ASR recovery checks; failures block production.')
  const child = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'vitest', 'run', '--config', 'evals/reliability/vitest.config.ts'], { stdio: 'inherit', env: { ...process.env, LT_RUN_LIVE_ACCEPTANCE: '1' }, timeout: 190_000 })
  if (diagnosticPreview) {
    // Fixed metadata only. No credentials, error strings, output, or user content.
    writeFileSync('public/acceptance-harness.json', JSON.stringify({ scope: 'isolated-preview-diagnostics', node: process.version, codeVersion: process.env.VERCEL_GIT_COMMIT_SHA, exitStatus: child.status, signal: child.signal, spawnFailed: !!child.error, reportWritten: existsSync('public/release-readiness.json'), providersConfigured: Object.fromEntries(['ANTHROPIC', 'OPENAI', 'GROQ', 'GEMINI', 'DEEPGRAM', 'ASSEMBLYAI'].map(provider => [provider.toLowerCase(), !!process.env[`${provider}_API_KEY`]])), productionVerified: false }))
  }
  if ((child.error || child.status !== 0) && !diagnosticPreview) process.exit(1)
}
