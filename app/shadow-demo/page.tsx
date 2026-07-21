'use client'
import { useEffect, useState } from 'react'
import { ShadowFollow } from '@/components/transcript/ShadowFollow'
import { alignIndex } from '@/lib/room/shadowAlign'

// Dev-only visual harness for the shadowing follow-along. Simulates a repeater's
// ASR arriving word by word and feeds it through the real aligner.
const SOURCE = 'Every word appears the exact moment it is said, so you never lose your place.'
const WORDS = SOURCE.split(' ')

export default function ShadowDemo() {
  const [spokenCount, setSpokenCount] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setSpokenCount((c) => (c >= WORDS.length ? 0 : c + 1)), 900)
    return () => clearInterval(t)
  }, [])

  const spoken = WORDS.slice(0, spokenCount).join(' ')
  const active = alignIndex(WORDS, spoken)

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-8 py-20">
      <p className="mb-6 text-sm font-medium uppercase tracking-widest text-emerald-700">
        Shadow follow-along · demo
      </p>
      <ShadowFollow words={WORDS} activeIndex={active} className="text-3xl sm:text-4xl" />
      <p className="mt-10 font-mono text-xs text-black/40">
        simulated ASR: “{spoken}” → active word #{active}
      </p>
    </main>
  )
}
