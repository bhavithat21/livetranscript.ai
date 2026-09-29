import { version } from '@/package.json'

export const dynamic = 'force-dynamic'
// Release identity only; no provider secrets, user data or authentication bypass.
export async function GET() {
  return Response.json({
    status: 'ok', service: 'livetranscript', version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    features: ['repository-screenshots', 'repository-specialist-agents', 'remote-assistance', 'app-appearance', 'standalone-ai-copilot', 'answer-preferences', 'interview-workspace', 'practice-coach', 'session-diagnostics-v1'],
    diagnostics: { schema: 1, endpoint: '/api/diagnostics', content: 'metadata-only', maxBatch: 25, localEventLimit: 600 },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
