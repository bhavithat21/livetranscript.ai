import type { Metadata } from 'next'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { PracticeWorkspace } from '@/components/practice/PracticeWorkspace'

export const metadata: Metadata = {
  title: 'Practice interview — LiveTranscript',
  robots: { index: false, follow: false },
}

export default function PracticePage() {
  return <WorkspaceShell active="practice"><PracticeWorkspace /></WorkspaceShell>
}
