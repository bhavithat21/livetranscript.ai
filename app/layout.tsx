import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { AppNav } from '@/components/nav/AppNav'
import { DesktopChrome } from '@/components/DesktopChrome'
import { PermissionPrimer } from '@/components/PermissionPrimer'
import { FeatureTour } from '@/components/FeatureTour'
import { TitleBar } from '@/components/TitleBar'
import { DiagnosticsRuntime } from '@/components/diagnostics/DiagnosticsRuntime'
import { AppIdentityEffects } from '@/lib/appIdentity/AppIdentityEffects'
import { authAppearance } from '@/components/site/authAppearance'
import { Providers } from './providers'
import './globals.css'

const geistSans = Geist({ variable: '--font-body', subsets: ['latin'], display: 'swap' })
const geistMono = Geist_Mono({ variable: '--font-code', subsets: ['latin'], display: 'swap', preload: false })

export const metadata: Metadata = {
  title: 'LiveTranscript — A clearer way to prepare and work',
  description: 'Live transcription, grounded AI answers, interview practice, and repository context in one focused workspace.',
}
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const body = (
    <body className="min-h-full font-[family-name:var(--font-body)]">
      <AppIdentityEffects />
      <DesktopChrome />
      <PermissionPrimer />
      <TitleBar />
      <AppNav clerkConfigured={clerkConfigured} />
      <Providers>{children}</Providers>
      <FeatureTour clerkConfigured={clerkConfigured} />
      <DiagnosticsRuntime release={process.env.VERCEL_GIT_COMMIT_SHA} />
    </body>
  )
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Mirror useThemeMode so the first frame uses the saved appearance. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("lt.theme");if(t!=="dark"&&t!=="light")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("lt-dark")}catch(e){}})()` }} />
        <link rel="preconnect" href="https://api.deepgram.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.eu.deepgram.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://streaming.assemblyai.com" crossOrigin="anonymous" />
      </head>
      {clerkConfigured ? <ClerkProvider appearance={authAppearance}>{body}</ClerkProvider> : body}
    </html>
  )
}
