import type { Metadata } from 'next'
import { RemoteAssist } from '@/components/remote/RemoteAssist'

export const metadata: Metadata = {
  title: 'Remote assist — LiveTranscript',
  robots: { index: false, follow: false },
}

export default function RemoteAssistPage() {
  return <RemoteAssist />
}
