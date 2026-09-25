import type { Metadata } from 'next'
import { RepositoryWorkspace } from '@/components/repoLive/RepositoryWorkspace'
export const metadata: Metadata = { title: 'Repository Replay Lab — LiveTranscript', description: 'Replay synthetic or explicitly imported repository sessions without model calls.' }
export default function Page() { return <RepositoryWorkspace replay /> }
