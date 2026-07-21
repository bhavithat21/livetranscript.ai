import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb, sessions } from '@/lib/db'
import { PREVIEW_NO_AUTH, PREVIEW_USER_ID } from '@/lib/auth'

// Dev-only: seed a couple of sample sessions for the preview user so the
// dashboard + detail screens have real content to render. 404 outside preview.
const SAMPLE = [
  {
    title: 'Design sync — realtime pipeline',
    durationSeconds: 1_524,
    segments: [
      { id: 1, speaker: 0, text: 'Okay, let me walk through the two-track transcription flow.', isFinal: true },
      { id: 2, speaker: 1, text: 'Sounds good — is the correction pass adding latency to the live captions?', isFinal: true },
      { id: 3, speaker: 0, text: 'No, the live track renders immediately; correction swaps text in place, fail-soft.', isFinal: true },
      { id: 4, speaker: 2, text: 'And diarization handles up to five speakers with the AA-contrast palette.', isFinal: true },
    ],
    summary: {
      summary:
        'The team reviewed the two-track transcription architecture: a fast live-caption track plus a fail-soft LLM correction pass that swaps text in place without adding latency.',
      keyPoints: ['Live track renders instantly', 'Correction is fail-soft', 'Up to 5 speakers diarized'],
      actionItems: ['Benchmark correction swap timing', 'Verify palette contrast on dark theme'],
    },
  },
  {
    title: 'Customer call — onboarding feedback',
    durationSeconds: 842,
    segments: [
      { id: 1, speaker: 0, text: 'The reader mode is genuinely the clearest transcript view I have used.', isFinal: true },
      { id: 2, speaker: 1, text: 'Great to hear. Anything you would change about sharing?', isFinal: true },
      { id: 3, speaker: 0, text: 'Expiring links are perfect. Maybe a one-click export to text.', isFinal: true },
    ],
    summary: {
      summary:
        'A customer praised Reader Mode clarity and expiring share links, and requested a one-click text export.',
      keyPoints: ['Reader Mode clarity valued', 'Expiring links work well'],
      actionItems: ['Ship one-click .txt export'],
    },
  },
]

export async function GET() {
  if (!PREVIEW_NO_AUTH) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const db = getDb()
  if (!db) return NextResponse.json({ error: 'No database configured' }, { status: 500 })

  const existing = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, PREVIEW_USER_ID))
  if (existing.length) return NextResponse.json({ seeded: false, count: existing.length })

  await db.insert(sessions).values(
    SAMPLE.map((s) => ({
      userId: PREVIEW_USER_ID,
      title: s.title,
      language: 'en',
      durationSeconds: s.durationSeconds,
      segments: s.segments,
      summary: s.summary,
    })),
  )
  return NextResponse.json({ seeded: true, count: SAMPLE.length })
}
