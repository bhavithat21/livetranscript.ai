import Link from 'next/link'
import { SiteFooter } from '@/components/site/SiteFooter'

export const metadata = {
  title: 'Pricing — LiveTranscript',
  description: 'Simple credit-based pricing. Pay for what you use, or subscribe.',
}

// 1 credit = 1 minute of transcription. Meetings use minutes × speakers.
const PACKS = [
  { name: 'Starter', price: '$10', credits: '500 min', per: '$0.020 / min', blurb: 'A few hours of transcription. Credits never expire.' },
  { name: 'Value', price: '$20', credits: '1,150 min', per: '$0.017 / min', blurb: 'Best for regular use — 19 hours, better rate.', featured: true },
  { name: 'Pro pack', price: '$45', credits: '3,000 min', per: '$0.015 / min', blurb: '50 hours at our lowest per-minute rate.' },
]

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <section className="mx-auto max-w-5xl px-8 pb-8 pt-24">
        <p className="rise-in text-sm font-medium uppercase tracking-widest text-[color:var(--signal)]">
          Pricing
        </p>
        <h1
          className="rise-in mt-3 font-[family-name:var(--font-serif)] leading-[1.05] tracking-[-0.02em]"
          style={{ animationDelay: '80ms', fontSize: 'var(--text-hero)' }}
        >
          Pay for what you speak.
        </h1>
        <p className="rise-in mt-5 max-w-2xl text-lg leading-relaxed text-black/65" style={{ animationDelay: '160ms' }}>
          One credit is one minute. Buy credits that never expire, or subscribe for the best rate.
          Meetings use one credit per speaker-minute. No surprises.
        </p>
      </section>

      {/* Free + Membership */}
      <section className="mx-auto grid max-w-5xl gap-4 px-8 sm:grid-cols-2">
        <Tier
          name="Free"
          price="$0"
          cadence="forever"
          highlight="30 minutes / month"
          features={['30 min of transcription each month', 'Speaker labels + Reader Mode', 'Join meetings', 'Save & share transcripts']}
          cta={<Link href="/record" className="btn-ghost block w-full py-2.5 text-center">Start free</Link>}
        />
        <Tier
          name="Member"
          price="$12"
          cadence="/ month"
          featured
          highlight="1,200 minutes / month"
          features={['1,200 min every month (20 hrs)', 'AI accuracy correction', 'Host meetings, all exports', 'Best per-minute rate']}
          cta={<ComingSoon />}
        />
      </section>

      {/* Credit packs */}
      <section className="mx-auto max-w-5xl px-8 py-14">
        <h2 className="font-[family-name:var(--font-serif)] text-2xl tracking-[-0.01em]">Or buy credits</h2>
        <p className="mt-1 text-black/55">Pay once, use anytime. Credits never expire.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {PACKS.map((p) => (
            <div
              key={p.name}
              className={`glass flex flex-col rounded-2xl p-6 ${p.featured ? 'ring-1 ring-emerald-700/30' : ''}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-[family-name:var(--font-serif)] text-xl">{p.name}</h3>
                <span className="font-[family-name:var(--font-serif)] text-2xl">{p.price}</span>
              </div>
              <div className="mt-1 text-sm text-black/50">{p.credits} · {p.per}</div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-black/60">{p.blurb}</p>
              <div className="mt-5">
                <ComingSoon />
              </div>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}

function Tier({
  name,
  price,
  cadence,
  highlight,
  features,
  cta,
  featured = false,
}: {
  name: string
  price: string
  cadence: string
  highlight: string
  features: string[]
  cta: React.ReactNode
  featured?: boolean
}) {
  return (
    <div className={`glass flex flex-col rounded-3xl p-7 ${featured ? 'ring-1 ring-emerald-700/30' : ''}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-serif)] text-2xl">{name}</h2>
        {featured && (
          <span className="rounded-full bg-emerald-700/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            Best value
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-[family-name:var(--font-serif)] text-4xl tracking-[-0.01em]">{price}</span>
        <span className="text-black/45">{cadence}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-[color:var(--signal)]">{highlight}</div>
      <ul className="mt-5 flex-1 space-y-2 text-sm text-black/70">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-[color:var(--signal)]">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-6">{cta}</div>
    </div>
  )
}

// Payments open once the business + Stripe account are live.
function ComingSoon() {
  return (
    <button
      disabled
      className="w-full cursor-not-allowed rounded-full border border-black/15 bg-black/5 py-2.5 text-center text-sm font-medium text-black/45"
    >
      Coming soon
    </button>
  )
}
