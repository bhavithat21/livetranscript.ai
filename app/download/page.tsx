'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Apple, Monitor } from 'lucide-react'
import { SiteFooter } from '@/components/site/SiteFooter'

// Desktop download page. Links resolve to the LATEST GitHub release (built +
// signed by the release CI workflow on each version tag). Points at the releases
// page so users get the current signed installers.
const REPO = 'https://github.com/bhavithat21/livetranscript.ai'
const MAC_URL = `${REPO}/releases/latest`
const WIN_URL = `${REPO}/releases/latest`

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
  return (
    <a
      href={href}
      className={`glass flex flex-col gap-4 rounded-3xl p-7 transition-transform hover:-translate-y-0.5 ${
        highlighted ? 'ring-2 ring-emerald-700/40' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/5">{icon}</span>
        <div>
          <div className="font-[family-name:var(--font-serif)] text-xl">{platform}</div>
          {highlighted && <div className="text-xs font-medium text-emerald-700">Detected — recommended</div>}
        </div>
      </div>
      <p className="text-sm text-black/55">{detail}</p>
      <span className="btn-signal mt-auto w-full">Download for {platform}</span>
    </a>
  )
}
