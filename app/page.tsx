import Link from 'next/link'
import { ArrowRight, AudioLines, Code2, FileText, FlaskConical, FolderCode, GraduationCap, Radio, Settings2, Sparkles, Users } from 'lucide-react'
import { SiteFooter } from '@/components/site/SiteFooter'
import { ProductPreview } from '@/components/site/ProductPreview'
import styles from '@/components/site/Site.module.css'

export const metadata = {
  title: 'LiveTranscript — Your interview workspace',
  description: 'Follow live conversations, reason through code, rehearse interviews and improve your AI answer profile in one workspace.',
}

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={`${styles.container} ${styles.hero}`}>
        <span className={styles.eyebrow}><AudioLines size={16} aria-hidden="true" />Your interview workspace</span>
        <h1>Stay with the conversation.<br /><em>Go deeper on the answer.</em></h1>
        <p>Live transcription, grounded AI guidance and room to practice. Bring the question, your experience and your codebase into one focused workspace.</p>
        <div className={styles.heroActions}>
          <Link href="/interview" className={styles.primary}>Open interview workspace<ArrowRight size={16} aria-hidden="true" /></Link>
          <Link href="/copilot" className={styles.secondary}><Sparkles size={16} aria-hidden="true" />Ask AI a question</Link>
        </div>
        <p className={styles.finePrint}>Start in your browser. Desktop apps available for Mac and Windows.</p>
      </section>

      <section className={styles.container} aria-label="Explore the workspace">
        <ProductPreview />
      </section>

      <section id="workflows" className={`${styles.container} ${styles.section}`}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.eyebrow}>A workspace for each moment</span><h2>Prepare with intention.<br />Respond with context.</h2></div>
          <p>Move from rehearsal to a live conversation, then use what happened to make the next session better.</p>
        </div>
        <div className={styles.workflowGrid}>
          <article className={styles.workflowCard}>
            <span className={styles.iconBox}><GraduationCap size={22} aria-hidden="true" /></span>
            <h3>Practice your thinking</h3>
            <p>Choose a role and focus area. Answer adaptive interview questions by text or microphone, then review feedback grounded in what you said.</p>
            <Link href="/practice" className={styles.textLink}>Start a practice session<ArrowRight size={15} aria-hidden="true" /></Link>
          </article>
          <article className={styles.workflowCard}>
            <span className={styles.iconBox}><Radio size={22} aria-hidden="true" /></span>
            <h3>Follow the live conversation</h3>
            <p>Keep detected questions, answer guidance and the transcript side by side. Choose your audio sources and stay in control of capture.</p>
            <Link href="/interview" className={styles.textLink}>Open Live<ArrowRight size={15} aria-hidden="true" /></Link>
          </article>
          <article className={styles.workflowCard}>
            <span className={styles.iconBox}><FlaskConical size={22} aria-hidden="true" /></span>
            <h3>Improve the assistant</h3>
            <p>Test the live answer pipeline in Mock Lab. Review an answer against your own criteria, refine its instructions and apply a reviewed profile.</p>
            <Link href="/interview#mock" className={styles.textLink}>Explore Mock Lab<ArrowRight size={15} aria-hidden="true" /></Link>
          </article>
        </div>
      </section>

      <section className={`${styles.featureSection} ${styles.section}`}>
        <div className={`${styles.container} ${styles.featureLayout}`}>
          <div>
            <span className={styles.eyebrow}><Code2 size={15} aria-hidden="true" />Made for technical depth</span>
            <h2 className={styles.sectionTitle}>The context behind a better answer.</h2>
            <p>A good response starts with more than a prompt. Work with your actual experience, the conversation so far and the files you choose to share.</p>
            <Link href="/copilot" className={`${styles.textLink} mt-5`}>Explore the AI workspace<ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          <div className={styles.featureList}>
            <article className={styles.featureItem}><FolderCode size={20} aria-hidden="true" /><div><h3>Understand an unfamiliar repository</h3><p>Select local project files, ask about architecture and trace answers back to code. Keep partial screenshot evidence distinct from a complete repository.</p><Link href="/copilot?mode=repoInterview" className={styles.textLink}>Open Repository<ArrowRight size={13} aria-hidden="true" /></Link></div></article>
            <article className={styles.featureItem}><FileText size={20} aria-hidden="true" /><div><h3>Ground answers in your own experience</h3><p>Add your resume text, target role and relevant stories. Give the assistant facts to work from and a response style you can use.</p><Link href="/settings#profile" className={styles.textLink}>Set up your profile<ArrowRight size={13} aria-hidden="true" /></Link></div></article>
            <article className={styles.featureItem}><Settings2 size={20} aria-hidden="true" /><div><h3>Control how much help you see</h3><p>Move between keywords, concise points and detailed explanations. Choose a technical or collaborative tone and request likely follow-up questions.</p></div></article>
            <article className={styles.featureItem}><Users size={20} aria-hidden="true" /><div><h3>Work with a mentor</h3><p>Share a desktop session with explicit approval, exchange notes and grant or revoke control from the host laptop.</p><Link href="/remote" className={styles.textLink}>Open Remote assist<ArrowRight size={13} aria-hidden="true" /></Link></div></article>
          </div>
        </div>
      </section>

      <section className={`${styles.container} ${styles.section} ${styles.faqLayout}`} aria-labelledby="questions-title">
        <div><span className={styles.eyebrow}>Before you start</span><h2 id="questions-title" className={`${styles.sectionTitle} mt-3`}>A few useful details.</h2><Link href="/download" className={`${styles.textLink} mt-4`}>Get the desktop app<ArrowRight size={15} aria-hidden="true" /></Link></div>
        <div>
          <details className={styles.faq}><summary>Can I use AI without joining a meeting?</summary><p>Yes. The AI workspace lets you type a question, work through code or explore selected repository files. Audio capture is optional and starts only when you choose to listen.</p></details>
          <details className={styles.faq}><summary>What is the difference between Practice and Mock Lab?</summary><p>Practice helps you rehearse: it asks questions and gives feedback on your answers. Mock Lab helps you test the assistant: it runs the live answer pipeline so you can review and improve an answer profile before using it in Live.</p></details>
          <details className={styles.faq}><summary>Do I need the desktop app?</summary><p>You can use the AI workspace, practice and browser-supported audio capture on the web. Native system audio and hosting laptop control use the desktop app and your operating system&rsquo;s permissions. Browser audio support varies by browser and selected source.</p></details>
          <details className={styles.faq}><summary>When does the app start listening?</summary><p>Capture starts from an explicit action and a source selection. The workspace shows its listening state and a stop control. Use live audio and collaboration only in sessions where participants and the relevant rules permit them.</p></details>
          <details className={styles.faq}><summary>Can I rely on every AI answer?</summary><p>AI can make mistakes. Review claims, verify generated code and use the answer as support for your own reasoning. Repository context and your profile help ground a response, but do not guarantee correctness.</p></details>
        </div>
      </section>

      <section className={`${styles.container} ${styles.closing}`}>
        <div><h2>Bring your next question.</h2><p>A focused place to work through it, from the first thought to the follow-up.</p></div>
        <Link href="/copilot" className={styles.primary}>Open AI workspace<ArrowRight size={16} aria-hidden="true" /></Link>
      </section>
      <SiteFooter />
    </main>
  )
}
