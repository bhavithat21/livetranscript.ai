import { MODE_ORDER, type CopilotMode } from '@/lib/copilot/modes'
import type { Metadata } from 'next'
import { CopilotWorkspace } from '@/components/workspace/CopilotWorkspace'

export const metadata: Metadata = {
  title: 'AI Copilot — LiveTranscript',
  description: 'A dedicated workspace for interview questions, code and repository context. Start with a question or optionally add live audio.',
}

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const { mode } = await searchParams
  const initialMode = typeof mode === 'string' && MODE_ORDER.includes(mode as CopilotMode) ? mode as CopilotMode : 'general'
  return <CopilotWorkspace key={initialMode} initialMode={initialMode} />
}
