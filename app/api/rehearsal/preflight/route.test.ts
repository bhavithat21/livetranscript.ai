// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth',()=>({currentUserId:vi.fn()}))
import { currentUserId } from '@/lib/auth'
import { POST } from './route'
beforeEach(()=>{vi.stubEnv('COPILOT_REHEARSAL_ENABLED','1');vi.stubEnv('VERCEL_ENV','preview');vi.mocked(currentUserId).mockResolvedValue('test-user')})
afterEach(()=>vi.unstubAllEnvs())
const request=(origin='https://preview.example')=>new Request('https://preview.example/api/rehearsal/preflight',{method:'POST',headers:{origin}})
it('denies production',async()=>{vi.stubEnv('VERCEL_ENV','production');expect((await POST(request())).status).toBe(404)})
it('does not bypass application authentication',async()=>{vi.mocked(currentUserId).mockResolvedValue(null);expect((await POST(request())).status).toBe(401)})
it('rejects cross-origin reads and reports missing configuration without paid calls',async()=>{
  expect((await POST(request('https://other.example'))).status).toBe(403)
  vi.stubEnv('ANTHROPIC_API_KEY','');const r=await POST(request());const data=await r.json();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(data.ready).toBe(false);expect(data.providerCalls).toBe(0)
})
