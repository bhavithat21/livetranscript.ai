import Link from 'next/link'
import { ArrowRight, Check, Info } from 'lucide-react'
import { SiteFooter } from '@/components/site/SiteFooter'
import styles from '@/components/site/Site.module.css'

export const metadata = {
  title: 'Pricing — LiveTranscript',
  description: 'Transcription plans and credit packs. Paid checkout is coming soon.',
}

// Preserve published transcription prices. Payment actions remain unavailable
// until the billing backend and checkout are enabled.
const PACKS = [
  { name: 'Starter', price: '$10', credits: '500 minutes', per: '$0.020 / minute', blurb: 'For occasional sessions and focused transcription.' },
  { name: 'Value', price: '$20', credits: '1,150 minutes', per: '$0.017 / minute', blurb: 'More room for regular conversations and interview prep.' },
  { name: 'Pro pack', price: '$45', credits: '3,000 minutes', per: '$0.015 / minute', blurb: '50 hours for a more active transcription workflow.' },
]

export default function PricingPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.shortHero}>
          <span className={styles.eyebrow}>Transcription pricing</span>
          <h1>Start with a conversation.<br />Choose more when you need it.</h1>
          <p>One credit covers one minute of transcription. Meetings use one credit per speaker-minute. Explore the free plan and upcoming paid options.</p>
        </header>
        <div className={styles.notice}><Info size={17} aria-hidden="true" /><p><strong>Paid checkout is coming soon.</strong> Member subscriptions and credit packs are listed for reference and cannot be purchased here yet. These are transcription prices, not an all-inclusive AI plan.</p></div>
        <section className={styles.tiers} aria-label="Transcription plans">
          <Tier name="Free" price="$0" cadence="free plan" highlight="30 minutes / month" features={['30 min of transcription each month', 'Speaker labels and Reader Mode', 'Join meetings', 'Save and share transcripts']}><Link href="/record" className={styles.primary}>Start transcribing<ArrowRight size={16} aria-hidden="true" /></Link></Tier>
          <Tier name="Member" price="$12" cadence="/ month" highlight="1,200 minutes / month" featured features={['1,200 min every month (20 hours)', 'AI accuracy correction', 'Host meetings and use all exports', 'Subscription transcription rate']}><span className={styles.unavailable}>Subscription coming soon</span></Tier>
        </section>
        <section className={styles.section} aria-labelledby="packs-title">
          <div className={styles.sectionHeader}><div><span className={styles.eyebrow}>One-time credit packs</span><h2 id="packs-title">A little more flexibility.</h2></div><p>The published packs below are coming soon. Purchased credits do not expire.</p></div>
          <div className={styles.packs}>{PACKS.map((pack) => <article key={pack.name} className={styles.pack}>
            <h3>{pack.name}</h3><div className={styles.packPrice}><strong>{pack.price}</strong><span>{pack.credits}</span></div><small>{pack.per}</small><p>{pack.blurb}</p><span className={styles.unavailable}>Credit pack coming soon</span>
          </article>)}</div>
        </section>
        <section className={`${styles.section} ${styles.faqLayout}`} aria-labelledby="pricing-questions-title">
          <div><span className={styles.eyebrow}>How credits work</span><h2 id="pricing-questions-title" className={`${styles.sectionTitle} mt-3`}>Clear before you start.</h2></div>
          <div>
            <details className={styles.faq}><summary>How are meeting minutes counted?</summary><p>Meetings use speaker-minutes. For example, two participants connected for ten minutes use twenty minutes of transcription credit.</p></details>
            <details className={styles.faq}><summary>Can I buy a plan now?</summary><p>Paid subscriptions and credit packs are not available for purchase yet. There is no checkout or payment collection on this page.</p></details>
            <details className={styles.faq}><summary>Are AI features included in these prices?</summary><p>These published prices describe transcription. They do not establish an AI usage allowance or promise unlimited AI requests. AI feature availability depends on the configured service and account access.</p></details>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  )
}

function Tier({ name, price, cadence, highlight, features, featured = false, children }: {
  name: string; price: string; cadence: string; highlight: string; features: string[]; featured?: boolean; children: React.ReactNode
}) {
  return <article className={styles.tier} data-featured={featured}>
    <div className={styles.tierName}><h2>{name}</h2>{featured && <span className={styles.badge}>Coming soon</span>}</div>
    <div className={styles.tierPrice}><strong>{price}</strong><span>{cadence}</span></div>
    <div className={styles.tierHighlight}>{highlight}</div>
    <ul>{features.map((feature) => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}</ul>
    {children}
  </article>
}
