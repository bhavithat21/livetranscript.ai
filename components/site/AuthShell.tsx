import Link from 'next/link'
import { ArrowLeft, AudioLines, Code2, GraduationCap } from 'lucide-react'
import { Wordmark } from '@/components/nav/Wordmark'
import styles from './Site.module.css'

export function AuthShell({ children }: { children: React.ReactNode }) {
  return <main className={styles.authPage}>
    <aside className={styles.authStory}>
      <Link href="/" className={styles.brand}><Wordmark /></Link>
      <div><h1>Your next conversation starts here.</h1><p>A focused workspace to understand the question, explore the context and practice your response.</p><ul className={styles.authBenefits}><li><AudioLines size={18} aria-hidden="true" />Follow live conversations</li><li><Code2 size={18} aria-hidden="true" />Go deeper on code and architecture</li><li><GraduationCap size={18} aria-hidden="true" />Build confidence through practice</li></ul></div>
      <small>LiveTranscript · Web, Mac and Windows</small>
    </aside>
    <section className={styles.authPanel} aria-label="Account access"><Link href="/" className={styles.authBack}><ArrowLeft size={15} aria-hidden="true" />Back to LiveTranscript</Link>{children}</section>
  </main>
}

export function AuthUnavailable() {
  return <div className={styles.authUnavailable}><h2>Sign-in is not configured here.</h2><p>This deployment does not have account access configured. Continue to the main LiveTranscript website to sign in.</p><a href="https://livetranscript.ai/sign-in" className={styles.primary}>Go to LiveTranscript sign-in</a></div>
}
