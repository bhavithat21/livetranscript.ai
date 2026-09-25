import type { Metadata } from 'next'
import { RepositoryBenchmarks } from '@/components/repoLive/RepositoryBenchmarks'
export const metadata: Metadata = { title: 'Repository model benchmarks — LiveTranscript' }
export default function Page() { return <RepositoryBenchmarks /> }
