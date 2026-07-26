import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Sans } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { AppNav } from '@/components/nav/AppNav'
import { DesktopChrome } from '@/components/DesktopChrome'
import { PermissionPrimer } from '@/components/PermissionPrimer'
import { FeatureTour } from '@/components/FeatureTour'
import { TitleBar } from '@/components/TitleBar'
import { Providers } from './providers'
import './globals.css'

const fraunces = Fraunces({
  variable: '--font-serif',
  subsets: ['latin'],
  display: 'swap',
})

const plexSans = IBM_Plex_Sans({
  variable: '--font-body',
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LiveTranscript — Real-time AI transcription',
  description: 'Fast, accurate live transcription with speaker labels and instant summaries.',
}

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const body = (
    <body className="min-h-full font-[family-name:var(--font-body)]">
      <DesktopChrome />
      <PermissionPrimer />
      <TitleBar />
      <AppNav clerkConfigured={clerkConfigured} />
      <Providers>{children}</Providers>
      <FeatureTour clerkConfigured={clerkConfigured} />
    </body>
  )

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} h-full antialiased`}
    >
      {/* Prime DNS + TLS to the ASR hosts before the user clicks record, so the
          first caption isn't waiting on a cold handshake — matters most for users
          far from the provider's region. Transport-only; no data sent. */}
      <head>
        <link rel="preconnect" href="https://api.deepgram.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.eu.deepgram.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://streaming.assemblyai.com" crossOrigin="anonymous" />
      </head>
      {clerkConfigured ? <ClerkProvider>{body}</ClerkProvider> : body}
    </html>
  )
}
