'use client'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { PACKS } from '@/lib/transcription/keytermPacks'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'

export default function SettingsPage() {
  const { enabledIds, toggle, keyterms } = useKeytermPrefs()

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
      <div className="flex items-center gap-3">
        <HomeMenu />
        <Link href="/dashboard" className="text-sm text-black/50 transition-colors hover:text-ink">
          ← Library
        </Link>
      </div>

      <h1 className="mt-6 font-[family-name:var(--font-serif)] text-4xl tracking-[-0.02em]">Settings</h1>

      <section className="mt-8">
        <h2 className="font-[family-name:var(--font-serif)] text-xl">Vocabulary packs</h2>
        <p className="mt-1 max-w-2xl leading-relaxed text-black/55">
          Boost recognition of the jargon in your conversations. Turn on the packs that match what
          you talk about — the transcriber will spell those terms right. Packs are applied when a
          session starts, so they never add any latency.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {PACKS.map((pack) => {
            const on = pack.base || enabledIds.includes(pack.id)
            return (
              <button
                key={pack.id}
                onClick={() => !pack.base && toggle(pack.id)}
                disabled={pack.base}
                data-active={on}
                className="glass glass-interactive flex flex-col rounded-2xl p-4 text-left disabled:cursor-default data-[active=true]:ring-1 data-[active=true]:ring-emerald-700/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{pack.name}</span>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${
                      on ? 'bg-[color:var(--signal)]' : 'bg-black/10'
                    }`}
                  >
                    {on && <Check size={13} />}
                  </span>
                </div>
                <span className="mt-1 text-sm text-black/55">{pack.description}</span>
                {pack.base && <span className="mt-2 text-xs text-black/35">Always on</span>}
              </button>
            )
          })}
        </div>

        <p className="mt-4 text-sm text-black/45">
          <span className="font-medium tabular-nums text-black/70">{keyterms.length}</span> / 100
          terms active. {keyterms.length >= 100 && 'At the cap — deselect a pack to add another.'}
        </p>
      </section>
    </main>
  )
}
