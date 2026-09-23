'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Apple, ArrowDownToLine, ArrowRight, Check, ExternalLink, Monitor, ShieldCheck } from 'lucide-react'
import { SiteFooter } from '@/components/site/SiteFooter'
import styles from '@/components/site/Site.module.css'

// Keep the stable download channel and deployment overrides independent from
// the explicitly selected 0.1.8 remote-assistance preview.
const MAC_URL = process.env.NEXT_PUBLIC_DOWNLOAD_MAC_URL || '/downloads/LiveTranscript-mac-arm64.dmg'
const WIN_URL = process.env.NEXT_PUBLIC_DOWNLOAD_WIN_URL || '/downloads/LiveTranscript-win-x64-setup.exe'
const PREVIEW_RELEASE = 'https://github.com/bhavithat21/livetranscript.ai/releases/tag/v0.1.8'
const PREVIEW_MAC = 'https://github.com/bhavithat21/livetranscript.ai/releases/download/v0.1.8/LiveTranscript_0.1.8_universal.dmg'
const PREVIEW_WINDOWS = 'https://github.com/bhavithat21/livetranscript.ai/releases/download/v0.1.8/LiveTranscript_0.1.8_x64-setup.exe'

type OS = 'mac' | 'windows' | 'other'

export default function DownloadPage() {
  const os = useSyncExternalStore(subscribeToNavigator, detectOS, () => 'other')
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.shortHero}>
          <span className={styles.eyebrow}><Monitor size={16} aria-hidden="true" />Desktop app</span>
          <h1>A dedicated space.<br />Right on your desktop.</h1>
          <p>Bring LiveTranscript into its own window on Mac or Windows. Keep your conversation, technical context and controls close at hand.</p>
          <Link href="/copilot" className={`${styles.textLink} mt-3`}>Prefer the browser? Open AI workspace<ArrowRight size={15} aria-hidden="true" /></Link>
        </header>
        <section className={styles.downloadLayout} aria-label="Desktop downloads">
          <DownloadCard href={MAC_URL} icon={<Apple size={24} aria-hidden="true" />} platform="macOS" detail="Mac installer · .dmg" highlighted={os === 'mac'} />
          <DownloadCard href={WIN_URL} icon={<Monitor size={24} aria-hidden="true" />} platform="Windows" detail="Windows 10 & 11 · .exe installer" highlighted={os === 'windows'} />
        </section>
        <section className={styles.releasePanel} aria-labelledby="preview-release-title">
          <div><span className={styles.badge}>Optional preview · v0.1.8</span><h2 id="preview-release-title">Try approved remote assistance.</h2><p>This preview adds laptop sharing and control with explicit host approval. Both platform builds passed CI; real-device permissions and connections still need a smoke test.</p><p>Install the preview explicitly. The stable updater remains on the stable release.</p></div>
          <div className={styles.releaseActions}>
            <a href={PREVIEW_MAC} className={styles.secondary}><Apple size={16} aria-hidden="true" />Download Mac preview<ArrowDownToLine size={15} aria-hidden="true" /></a>
            <a href={PREVIEW_WINDOWS} className={styles.secondary}><Monitor size={16} aria-hidden="true" />Download Windows preview<ArrowDownToLine size={15} aria-hidden="true" /></a>
            <a href={PREVIEW_RELEASE} className={styles.textLink}>View v0.1.8 release details<ExternalLink size={13} aria-hidden="true" /></a>
          </div>
        </section>
        <div className={`${styles.notice} mt-5`}><ShieldCheck size={18} aria-hidden="true" /><p><strong>Preview installation.</strong> The v0.1.8 Mac app is signed and notarized. The Windows preview has no publisher signature and may display an installation warning. Review the release details before installing.</p></div>
        <section className={`${styles.section} ${styles.installGuide}`} aria-labelledby="installation-title">
          <div><span className={styles.eyebrow}>Getting started</span><h2 id="installation-title" className="mt-3">Set up once.<br />Choose what to share.</h2><p>Audio and screen access depend on your operating system. The app asks for the access needed by the feature you start.</p></div>
          <ol className={styles.installSteps}>
            <li><span>1</span><div><h3>Install the version you chose</h3><p>Download the installer for your computer. On Mac, open the DMG and move the app to Applications. On Windows, open the installer and follow its setup steps.</p></div></li>
            <li><span>2</span><div><h3>Sign in and set your context</h3><p>Open the app and add your profile in Settings. You can also use the standalone AI workspace without starting audio capture.</p></div></li>
            <li><span>3</span><div><h3>Allow the features you need</h3><p>Mac screen sharing and system audio need recording permissions. Remote keyboard and pointer control also need Accessibility permission. Host approval and stop controls remain part of the session.</p></div></li>
          </ol>
        </section>
        <section className={`${styles.closing}`}>
          <div><h2>Your browser is a workspace, too.</h2><p>Ask a question, explore your code or practice before you install.</p></div>
          <Link href="/copilot" className={styles.primary}>Continue on the web<ArrowRight size={16} aria-hidden="true" /></Link>
        </section>
      </div>
      <SiteFooter />
    </main>
  )
}

function subscribeToNavigator(): () => void { return () => {} }
function detectOS(): OS {
  const platform = navigator.platform?.toLowerCase() ?? ''
  const userAgent = navigator.userAgent?.toLowerCase() ?? ''
  if (platform.includes('mac') || userAgent.includes('mac')) return 'mac'
  if (platform.includes('win') || userAgent.includes('win')) return 'windows'
  return 'other'
}

function DownloadCard({ href, icon, platform, detail, highlighted }: {
  href: string; icon: React.ReactNode; platform: string; detail: string; highlighted: boolean
}) {
  return <article className={styles.downloadCard} data-recommended={highlighted}>
    <div className={styles.downloadHeading}><span className={styles.iconBox}>{icon}</span><div><h2>{platform}</h2>{highlighted && <span className={styles.badge}><Check size={11} aria-hidden="true" />Detected on this device</span>}</div></div>
    <p>{detail}</p>
    {href ? <a href={href} download className={styles.primary}><ArrowDownToLine size={17} aria-hidden="true" />Download for {platform}</a> : <span className={styles.unavailable}>Download coming soon</span>}
  </article>
}
