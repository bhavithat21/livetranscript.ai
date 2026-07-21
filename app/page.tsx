import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <header className="flex items-center justify-between px-8 py-6">
        <span className="font-[family-name:var(--font-serif)] text-xl font-semibold">
          LiveTranscript
        </span>
        <Link href="/record" className="text-sm underline underline-offset-4">
          Open app
        </Link>
      </header>

      <section className="mx-auto max-w-4xl px-8 py-24">
        <p
          className="rise-in mb-4 text-sm font-medium uppercase tracking-widest text-emerald-700"
          style={{ animationDelay: '0ms' }}
        >
          Real-time AI transcription
        </p>
        <h1
          className="rise-in font-[family-name:var(--font-serif)] text-5xl leading-[1.05] sm:text-7xl"
          style={{ animationDelay: '80ms' }}
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
        <div
          className="rise-in mt-10 flex flex-wrap items-center gap-5"
          style={{ animationDelay: '320ms' }}
        >
          <Link href="/record" className="btn-signal px-7 py-3">
            Start transcribing
          </Link>
          <Link href="/room/new" className="btn-ghost px-7 py-3 font-medium">
            Open a shadowing room
          </Link>
          <span className="text-sm text-black/50">No install. Works in your browser.</span>
        </div>
        <p className="mt-4 text-sm text-black/50">
          Shadowing rooms sync two people on different computers — one reads, the other repeats,
          with the repeater&rsquo;s words shown large. Use any room name in the URL to share it.
        </p>
      </section>
    </main>
  )
}
