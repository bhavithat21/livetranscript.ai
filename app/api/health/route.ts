import { version } from '@/package.json'

export const dynamic = 'force-dynamic'

// Confirms which release is serving a domain without exposing model credentials,
// user data, or an authentication bypass. Provider readiness requires signed-in tests.
export async function GET() {
  return Response.json({
    status: 'ok',
    service: 'livetranscript',
    version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    features: ['repository-screenshots', 'repository-specialist-agents', 'remote-assistance', 'app-appearance', 'standalone-ai-copilot', 'answer-preferences', 'interview-workspace', 'practice-coach'],
  }, { headers: { 'Cache-Control': 'no-store' } })
}
