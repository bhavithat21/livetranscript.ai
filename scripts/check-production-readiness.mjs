import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const enabled = process.env.VERCEL_ENV === 'production' || process.env.LT_RUN_LIVE_ACCEPTANCE === '1'
if (!enabled) {
  mkdirSync('public', { recursive: true })
  writeFileSync('public/release-readiness.json', JSON.stringify({ passed: false, scope: 'not-run', deviceVerified: false }))
  console.log('[readiness] Paid live acceptance was NOT run for this local/preview build.')
} else {
  console.log('[readiness] Running bounded synthetic model, vision and ASR recovery checks; failures block this build.')
  const child = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'vitest', 'run', '--config', 'evals/reliability/vitest.config.ts'], { stdio: 'inherit', env: process.env, timeout: 190_000 })
  if (child.error || child.status !== 0) process.exit(1)
}
