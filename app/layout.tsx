import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Sans } from 'next/font/google'
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
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

function AuthControls() {
  return (
    <>
      <Show when="signed-out">
        <div className="flex items-center gap-3 text-sm">
          <SignInButton />
          <SignUpButton />
        </div>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  )
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const body = (
    <body className="min-h-full font-[family-name:var(--font-body)]">
      {clerkConfigured && (
        <div className="fixed right-4 top-4 z-50">
          <AuthControls />
        </div>
      )}
      <Providers>{children}</Providers>
    </body>
  )

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} h-full antialiased`}
    >
      {clerkConfigured ? <ClerkProvider>{body}</ClerkProvider> : body}
    </html>
  )
}
