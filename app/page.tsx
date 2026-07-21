import Link from 'next/link'
import { SiteFooter } from '@/components/site/SiteFooter'

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-8 pb-8 pt-24">
        <p
          className="rise-in mb-4 text-sm font-medium uppercase tracking-widest text-[color:var(--signal)]"
          style={{ animationDelay: '0ms' }}
        >
          Real-time AI transcription
        </p>
        <h1
          className="rise-in font-[family-name:var(--font-serif)] leading-[1.02] tracking-[-0.02em]"
          style={{ animationDelay: '80ms', fontSize: 'var(--text-hero)' }}
        >
          Every word, the moment it&rsquo;s said.
        </h1>
        <p
          className="rise-in mt-6 max-w-2xl text-lg leading-relaxed text-black/70"
          style={{ animationDelay: '200ms' }}
        >
          Live captions with speaker labels, technical-jargon accuracy, and instant summaries.
          Faster and more readable than the rest — with a distraction-free Reader Mode that colors
          every speaker.
        </p>
        <div className="rise-in mt-10 flex flex-wrap items-center gap-4" style={{ animationDelay: '320ms' }}>
          <Link href="/record" className="btn-signal px-7 py-3 text-base">
            Start transcribing
          </Link>
          <Link href="/room/new" className="btn-ghost px-7 py-3 font-medium">
            Open a meeting
          </Link>
          <span className="text-sm text-black/50">No install. Works in your browser.</span>
        </div>
      </section>

      {/* Feature bento — grid-breaking, unequal cells. */}
      <section className="mx-auto max-w-5xl px-8 py-16">
        <div className="grid gap-4 sm:grid-cols-3">
          <Cell className="sm:col-span-2" title="Two-track accuracy" eyebrow="Live + correction">
            Fast live captions appear instantly, then a fail-soft AI pass cleans jargon and
            homophones in place — accuracy without the latency.
          </Cell>
          <Cell title="Up to 5 speakers" eyebrow="Diarized">
            Every voice gets its own color, in a live meeting or a single mic.
          </Cell>
          <Cell title="Reader Mode" eyebrow="Distraction-free">
            Full-screen, measured, high-contrast reading — the transcript is the product.
          </Cell>
          <Cell className="sm:col-span-2" title="Live meetings across devices" eyebrow="Shareable">
            Send a friendly meeting link — up to five people join from their own computers, everyone
            speaks, and the synced transcript scrolls in real time. Summaries and expiring share
            links when you&rsquo;re done.
          </Cell>
        </div>
      </section>

      {/* Quiet, honest proof strip. */}
      <section className="mx-auto max-w-5xl px-8 pb-20">
        <div className="glass flex flex-wrap items-center justify-between gap-6 rounded-3xl px-8 py-8">
          <p className="max-w-md font-[family-name:var(--font-serif)] text-2xl leading-snug tracking-[-0.01em]">
            Built for interviews, meetings, lectures, and dictation.
          </p>
          <Link href="/record" className="btn-signal px-7 py-3 text-base">
            Try it free
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}

function Cell({
  title,
  eyebrow,
  children,
  className = '',
}: {
  title: string
  eyebrow: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`glass glass-interactive flex flex-col rounded-2xl p-6 ${className}`}>
      <span className="text-xs font-medium uppercase tracking-widest text-[color:var(--signal)]">
        {eyebrow}
      </span>
      <h3 className="mt-2 font-[family-name:var(--font-serif)] text-2xl tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 leading-relaxed text-black/60">{children}</p>
    </div>
  )
}
