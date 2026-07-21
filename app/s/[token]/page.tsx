import { eq } from 'drizzle-orm'
import { getDb, sessions } from '@/lib/db'
import { isShareValid } from '@/lib/share'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import type { Segment } from '@/lib/transcript/store'

function Expired() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="font-[family-name:var(--font-serif)] text-3xl">This link has expired</h1>
      <p className="mt-3 text-black/60">Ask the owner to share a new link.</p>
    </main>
  )
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = getDb()
  if (!db) return <Expired />

  const [row] = await db.select().from(sessions).where(eq(sessions.shareToken, token)).limit(1)
  if (!row || !isShareValid(row, Date.now())) return <Expired />

  const segments = (row.segments as Segment[]) ?? []
  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <header className="border-b border-black/10 px-6 py-4">
        <h1 className="font-[family-name:var(--font-serif)] text-2xl">{row.title}</h1>
        <p className="text-sm text-black/50">Shared transcript · read-only</p>
      </header>
      <TranscriptView segments={segments} theme="light" readerMode />
    </main>
  )
}
