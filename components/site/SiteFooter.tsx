import Link from 'next/link'
import { Wordmark } from '@/components/nav/Wordmark'
import styles from './Site.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerIntro}>
            <Link href="/" className={styles.brand}><Wordmark /></Link>
            <p>Follow the conversation. Understand the context. Keep improving.</p>
          </div>
          <nav className={styles.footerNav} aria-label="Product links">
            <h2>Workspace</h2>
            <Link href="/interview">Live interview</Link>
            <Link href="/copilot">AI workspace</Link>
            <Link href="/practice">Practice</Link>
            <Link href="/record">Transcription</Link>
          </nav>
          <nav className={styles.footerNav} aria-label="More links">
            <h2>Explore</h2>
            <Link href="/download">Desktop app</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/remote">Remote assist</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </div>
        <div className={styles.footerBottom}><span>© 2026 LiveTranscript</span><span>Web · macOS · Windows</span></div>
      </div>
    </footer>
  )
}
