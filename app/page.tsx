import Link from 'next/link'
import type { CSSProperties } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Code2, FileText, FlaskConical, GraduationCap } from 'lucide-react'
import { SiteFooter } from '@/components/site/SiteFooter'
import { ProductPreview } from '@/components/site/ProductPreview'
import { StudioMotion } from '@/components/site/StudioMotion'
import { BrandMark } from '@/components/brand/BrandMark'
import styles from '@/components/site/StudioHome.module.css'

export const metadata = {
  title: 'LiveTranscript — Be here. Keep every word.',
  description: 'Live transcripts, grounded repository guidance and interview practice. Stay with the conversation while your context stays with you.',
}
const workflows = [
  { number: '01', name: 'Live conversations', icon: AudioLines, text: 'Catch the question. Keep the thread. Follow the latest words without chasing the scrollbar.', href: '/interview', detail: 'Listen & respond' },
  { number: '02', name: 'Repository context', icon: Code2, text: 'Connect the files you have seen. Know where to look, what to change and what still needs checking.', href: '/interview/repository', detail: 'Explore & understand' },
  { number: '03', name: 'Interview practice', icon: GraduationCap, text: 'Think out loud, try another approach and learn from feedback grounded in your actual answer.', href: '/practice', detail: 'Rehearse & improve' },
  { number: '04', name: 'Your Mock Lab', icon: FlaskConical, text: 'Replay a session, compare the guidance and refine a profile before you bring it into Live.', href: '/interview#mock', detail: 'Test & refine' },
]
export default function Home() {
  return <main className={styles.page}><StudioMotion>
    <section className={`${styles.container} ${styles.hero}`} aria-labelledby="home-heading">
      <div className={styles.kicker}><span><i aria-hidden />Made for the conversation</span><span>WEB / MACOS / WINDOWS</span></div>
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy} data-reveal>
          <h1 id="home-heading">Be here.<br />Keep <em>every</em><br />word.</h1>
          <div className={styles.heroBottom}><p>Your attention belongs in the room.<br />Live transcripts and grounded AI guidance keep the context close.</p><Link href="/interview" className={styles.cta}>Open workspace<ArrowUpRight size={20} aria-hidden /></Link></div>
        </div>
        <div className={styles.signalPoster} data-reveal>
          <div className={styles.posterTop}><BrandMark size={34} /><span>FROM SOUND<br />TO UNDERSTANDING</span></div>
          <div className={styles.signalSculpture} aria-hidden="true"><div className={styles.signalDisc} /><div className={styles.signalBars}>{[0,1,2,3,4,5,6].map(i=><i key={i} style={{ '--bar': i } as CSSProperties} />)}</div><span className={styles.posterCross}>+</span></div>
          <div className={styles.posterCaption}><span>Less chasing.<br /><strong>More presence.</strong></span><ArrowDown size={28} aria-hidden /></div>
          <p className={styles.posterNote}>A visual expression of listening — not an active recording.</p>
        </div>
      </div>
      <div className={styles.heroFoot}><span>A little assistance. A lot more clarity.</span><Link href="#workflows">Explore the workspace<ArrowDown size={15} aria-hidden /></Link></div>
    </section>

    <section id="workflows" className={`${styles.container} ${styles.workflows}`} aria-labelledby="workflows-heading">
      <div className={styles.sectionHeading} data-reveal><p className={styles.eyebrow}>01 / The workspace</p><h2 id="workflows-heading">One place.<br />More possibilities.</h2><p>Prepare, stay present, then come back better. Each space has a purpose. Nothing extra in your way.</p></div>
      <div className={styles.workflowList}>{workflows.map(({ number,name,icon:Icon,text,href,detail })=><Link key={number} href={href} className={styles.workflow} data-reveal><span className={styles.number}>{number}</span><div><small><Icon size={13} aria-hidden />{detail}</small><h3>{name}</h3></div><p>{text}</p><span className={styles.roundArrow}><ArrowUpRight size={26} aria-hidden /></span></Link>)}</div>
    </section>

    <section className={styles.productSection} aria-labelledby="product-heading">
      <div className={styles.container}>
        <div className={styles.productHeading} data-reveal><div><p className={styles.eyebrow}>02 / See it in context</p><h2 id="product-heading">The conversation moves.<br /><em>Your workspace follows.</em></h2></div><Link href="/record" className={styles.inverseLink}>Start a transcript<ArrowUpRight size={18} aria-hidden /></Link></div>
        <div data-reveal className={styles.productFrame}><ProductPreview /></div>
        <div className={styles.productNotes}><p><span>LIVE EDGE</span>Newest speech stays in view. Scroll up when you need to revisit a thought.</p><p><span>GROUNDED HELP</span>Observed code stays separate from suggested changes. Missing evidence stays visible.</p><p><span>YOUR CONTROL</span>Choose what to share. Stop capture at any time. Review AI output before relying on it.</p></div>
      </div>
    </section>

    <section className={`${styles.container} ${styles.manifesto}`}>
      <p className={styles.eyebrow} data-reveal>03 / Built around your attention</p>
      <h2 data-reveal>Good tools don&rsquo;t<br />take over.<br /><span>They make room.</span></h2>
      <div className={styles.manifestoBottom}><BrandMark size={80} /><p>No racing to copy every sentence. No digging through a pile of screenshots. Just the next useful thought, with the context to back it up.</p><Link href="/settings#profile" className={styles.textLink}>Make it yours<ArrowRight size={16} aria-hidden /></Link></div>
    </section>

    <section className={`${styles.container} ${styles.faqSection}`} aria-labelledby="faq-heading">
      <div data-reveal><p className={styles.eyebrow}>A few things worth knowing</p><h2 id="faq-heading">Before you<br />press play.</h2><FileText size={30} aria-hidden /></div>
      <div data-reveal>
        <details><summary>Does it listen automatically?</summary><p>No. You choose the audio source and start capture. Screen sharing is separate and permission-based. Stop either at any time.</p></details>
        <details><summary>Can I use this in an interview?</summary><p>Use Live with the interviewer&rsquo;s permission and where external AI assistance is allowed. Practice and Mock Lab let you rehearse and test the workflow independently.</p></details>
        <details><summary>Is every transcript or AI answer correct?</summary><p>No. Speech recognition can miss words, and AI guidance needs your review. Original segments remain available, and uncertain repository evidence is not treated as complete source code.</p></details>
        <details><summary>Why use the desktop app?</summary><p>The website handles practice, transcripts and browser-supported capture. Native system audio and selected-display capture use the desktop app and your operating system&rsquo;s permissions.</p></details>
      </div>
    </section>

    <section className={`${styles.container} ${styles.closing}`} data-reveal><div><p className={styles.eyebrow}>Your next conversation starts here</p><h2>Stay present.<br />We&rsquo;ll keep the thread.</h2></div><Link href="/interview" aria-label="Open your interview workspace" className={styles.closingArrow}><ArrowUpRight aria-hidden /></Link></section>
    <SiteFooter />
  </StudioMotion></main>
}
