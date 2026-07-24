'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Apple, Monitor } from 'lucide-react'
import { SiteFooter } from '@/components/site/SiteFooter'

// Desktop download page. Installer URLs are ENV-CONFIGURABLE so we can host the
// signed .dmg / .exe wherever we like (Vercel Blob public storage, a CDN, a
// releases page) without touching code — set NEXT_PUBLIC_DOWNLOAD_MAC_URL /
// NEXT_PUBLIC_DOWNLOAD_WIN_URL when installers exist. Until then the cards show
// "Coming soon" (no dead links to an empty/private releases page).
//
// Recommended host: Vercel Blob (public, same platform, no new vendor) — upload
// the signed installers and point these env vars at the returned public URLs.
const MAC_URL = process.env.NEXT_PUBLIC_DOWNLOAD_MAC_URL || ''
const WIN_URL = process.env.NEXT_PUBLIC_DOWNLOAD_WIN_URL || ''

type OS = 'mac' | 'windows' | 'other'

export default function DownloadPage() {
  const [os, setOs] = useState<OS>('other')
  useEffect(() => {
    const p = navigator.platform?.toLowerCase() ?? ''
    const ua = navigator.userAgent?.toLowerCase() ?? ''
    if (p.includes('mac') || ua.includes('mac')) setOs('mac')
    else if (p.includes('win') || ua.includes('win')) setOs('windows')
  }, [])

  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <section className="mx-auto max-w-4xl px-5 pb-8 pt-24 sm:px-8">
        <p className="rise-in text-sm font-medium uppercase tracking-widest text-[color:var(--signal)]">
          Desktop app
        </p>
        <h1
          className="rise-in mt-3 break-words font-[family-name:var(--font-serif)] leading-[1.05] tracking-[-0.02em]"
          style={{ animationDelay: '80ms', fontSize: 'var(--text-hero)' }}
        >
          LiveTranscript on your desktop.
        </h1>
        <p className="rise-in mt-5 max-w-2xl text-lg leading-relaxed text-black/65" style={{ animationDelay: '160ms' }}>
          A native window for Mac and Windows — the full app, always up to date.
          It updates itself automatically, so you&rsquo;re never on an old version.
        </p>
      </section>

      <section className="mx-auto grid max-w-4xl gap-4 px-5 sm:grid-cols-2 sm:px-8">
        <DownloadCard
          href={MAC_URL}
          icon={<Apple size={22} />}
          platform="macOS"
          detail="Apple silicon & Intel · .dmg"
          highlighted={os === 'mac'}
        />
        <DownloadCard
          href={WIN_URL}
          icon={<Monitor size={22} />}
          platform="Windows"
          detail="Windows 10 & 11 · .exe installer"
          highlighted={os === 'windows'}
        />
      </section>

      {(!MAC_URL || !WIN_URL) && (
        <p className="mx-auto max-w-4xl px-5 pt-4 text-center text-sm text-black/45 sm:px-8">
          Desktop apps are on the way. In the meantime,{' '}
          <Link href="/record" className="text-[color:var(--signal)] hover:underline">
            use LiveTranscript in your browser
          </Link>
          .
        </p>
      )}

      <section className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-[family-name:var(--font-serif)] text-xl">Automatic updates</h2>
          <p className="mt-2 text-sm leading-relaxed text-black/60">
            The desktop app checks for updates on launch and installs them in the
            background — no manual re-downloads. Prefer no install?{' '}
            <Link href="/record" className="text-[color:var(--signal)] hover:underline">
              Use it right in your browser
            </Link>
            .
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}

function DownloadCard({
  href,
  icon,
  platform,
  detail,
  highlighted,
}: {
  href: string
  icon: React.ReactNode
  platform: string
  detail: string
  highlighted: boolean
}) {
  const available = Boolean(href)
  const inner = (
    <>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/5">{icon}</span>
        <div>
          <div className="font-[family-name:var(--font-serif)] text-xl">{platform}</div>
          {available && highlighted && (
            <div className="text-xs font-medium text-emerald-700">Detected — recommended</div>
          )}
        </div>
      </div>
      <p className="text-sm text-black/55">{detail}</p>
      {available ? (
        <span className="btn-signal mt-auto w-full">Download for {platform}</span>
      ) : (
        <span className="mt-auto w-full cursor-not-allowed rounded-full border border-black/15 bg-black/5 py-2.5 text-center text-sm font-medium text-black/45">
          Coming soon
        </span>
      )}
    </>
  )
  const cls = `glass flex flex-col gap-4 rounded-3xl p-7 ${
    available ? 'transition-transform hover:-translate-y-0.5' : 'opacity-80'
  } ${available && highlighted ? 'ring-2 ring-emerald-700/40' : ''}`

  // Real link only when an installer URL is configured; otherwise a static card.
  return available ? (
    <a href={href} className={cls} download>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  )
}
