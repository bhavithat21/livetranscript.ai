import type { Metadata } from 'next'
import { RepositoryWorkspace } from '@/components/repoLive/RepositoryWorkspace'
export const metadata: Metadata = { title: 'Live repository copilot — LiveTranscript', description: 'Permission-based screen observation, repository exploration, code guidance and verification.' }
export default function Page() { return <RepositoryWorkspace /> }
