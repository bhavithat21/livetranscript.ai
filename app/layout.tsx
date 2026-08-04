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
    // suppressHydrationWarning: the inline script below adds `lt-dark` to this
    // element before React hydrates, so the client className legitimately differs
    // from what the server rendered. React keeps the DOM, which is what we want.
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Paint the saved theme on the FIRST frame. An effect runs after paint,
            so a dark-mode user would see a white flash on every page load. This
            runs synchronously during HTML parsing, before anything is painted.
            Must mirror read() in lib/transcript/useThemeMode.ts — same key, same
            OS fallback — so React's first render agrees with the DOM.
            NOTE: next.config.ts sets no script-src, so this inline script is
            allowed; if a script-src is added later it needs a nonce. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("lt.theme");if(t!=="dark"&&t!=="light")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("lt-dark")}catch(e){}})()`,
          }}
        />
        {/* Prime DNS + TLS to the ASR hosts before the user clicks record, so the
            first caption isn't waiting on a cold handshake — matters most for users
            far from the provider's region. Transport-only; no data sent. */}
        <link rel="preconnect" href="https://api.deepgram.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.eu.deepgram.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://streaming.assemblyai.com" crossOrigin="anonymous" />
      </head>
      {clerkConfigured ? <ClerkProvider>{body}</ClerkProvider> : body}
    </html>
  )
}
