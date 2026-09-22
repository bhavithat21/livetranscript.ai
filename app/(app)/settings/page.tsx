import type { Metadata } from 'next'
import { SettingsWorkspace } from '@/components/settings/SettingsWorkspace'

export const metadata: Metadata = {
  title: 'Settings — LiveTranscript',
}

export default function SettingsPage() {
  return <SettingsWorkspace />
}
