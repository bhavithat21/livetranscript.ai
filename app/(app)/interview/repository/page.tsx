import Link from 'next/link'
import { currentUserId } from '@/lib/auth'
import { RepositoryCoach } from '@/components/coach/RepositoryCoach'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
export const dynamic = 'force-dynamic'
export default async function RepositoryCoachPage() {
  const userId = await currentUserId()
  if (!userId) return <main className="mx-auto max-w-xl p-8 text-ink"><h1 className="text-2xl font-semibold">Repository coach</h1><p className="my-5">Sign in to use permitted repository assistance and session replay.</p><Link className="btn-signal" href="/sign-in?redirect_url=%2Finterview%2Frepository">Sign in</Link></main>
  return <WorkspaceShell active="repository"><main className="mx-auto max-w-[1600px] p-3 sm:p-6"><header className="mb-5"><h1 className="text-2xl font-semibold">Repository coach</h1><p className="mt-2 text-sm text-ink/60">Practice an investigation or replay observed code. For hands-free interviewer audio, enable Repository coding interview in Live.</p><Link className="mt-3 inline-block text-sm underline" href="/interview">Live interview and Mock Lab</Link><span className="mx-3 text-ink/40">·</span><Link className="text-sm underline" href="/copilot?mode=repoInterview">Classic repository tools</Link></header><RepositoryCoach key={userId} /></main></WorkspaceShell>
}
