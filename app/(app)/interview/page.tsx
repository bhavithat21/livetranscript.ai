import Link from 'next/link'
import { currentUserId } from '@/lib/auth'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { InterviewWorkspace } from '@/components/interview/InterviewWorkspace'

export const dynamic = 'force-dynamic'

export default async function InterviewPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const userId = await currentUserId()
  if (!userId) return (
    <main className="mx-auto max-w-3xl px-5 py-8 text-ink">
      <HomeMenu />
      <section className="reader-surface mt-8 rounded-2xl p-6">
        <h1 className="font-[family-name:var(--font-serif)] text-3xl">Interview workspace</h1>
        <p className="mt-3 text-black/60">Sign in to access Live Interview, Mock Interview, and Interview Feedback. Your interview history is kept separate for each account on this browser.</p>
        <div className="mt-5">{configured ? <Link className="btn-signal" href="/sign-in?redirect_url=%2Finterview">Sign in to continue</Link> : <p role="status" className="text-sm text-black/60">Sign-in is not configured on this deployment. Open <a href="https://livetranscript.ai/interview" className="underline underline-offset-4">the main interview workspace</a> to continue.</p>}</div>
      </section>
    </main>
  )
  // A different account gets a fresh store and no in-memory interview state.
  return <InterviewWorkspace key={userId} ownerId={userId} />
}
