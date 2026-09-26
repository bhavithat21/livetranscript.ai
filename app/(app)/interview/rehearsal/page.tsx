import Link from 'next/link'
import { currentUserId } from '@/lib/auth'
import { rehearsalEnabled } from '@/lib/rehearsal/preflight'
import { InterviewTuningProvider } from '@/lib/interview/TuningContext'
import { InteractiveRehearsal } from '@/components/rehearsal/InteractiveRehearsal'
export const dynamic = 'force-dynamic'
export default async function RehearsalPage() {
  if (!rehearsalEnabled()) return <main className="mx-auto max-w-xl p-8"><h1>Rehearsal environment is not enabled</h1><p>Enable COPILOT_REHEARSAL_ENABLED only on the approved Preview branch. Production rehearsal access remains disabled.</p></main>
  const user = await currentUserId()
  if (!user) return <main className="p-8"><h1>Sign in to the isolated rehearsal</h1><Link href="/sign-in?redirect_url=%2Finterview%2Frehearsal">Sign in</Link></main>
  // No live LearningProvider: session tactics are explicit and frozen; post-run evaluation is separate.
  // Ordinary application authentication is unchanged.
  return <InterviewTuningProvider ownerId={user}><InteractiveRehearsal ownerId={user}/></InterviewTuningProvider>
}
