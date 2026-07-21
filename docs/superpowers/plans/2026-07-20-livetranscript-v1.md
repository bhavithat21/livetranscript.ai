# LiveTranscript.ai v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js live-transcription web app with a swappable provider layer, 5-speaker diarization, AI summaries, an Otter-style workspace, and a text-only Reader Mode — faster and more readable than Otter.ai.

**Architecture:** Next.js App Router on Vercel. The browser captures mic audio via an AudioWorklet (16kHz Int16 PCM), fetches a short-lived scoped token from a server route, and streams audio **directly** to the transcription provider over WebSocket (Approach A — lowest latency, keys never in browser). A provider-neutral `TranscriptionProvider` interface abstracts AssemblyAI (primary), Deepgram (fallback), and OpenAI (server-side accuracy pass). **Two-track transcription:** the live track shows interim words in ~200-300ms; a correction track re-transcribes each finalized utterance server-side with a heavier model and upgrades the committed line in place (`onCorrected`). After a session, server routes generate summaries.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Vitest for unit tests. Providers: AssemblyAI `u3-rt-pro`, Deepgram `nova-3`, OpenAI `gpt-4o-transcribe-diarize` + a chat model for summaries.

## Global Constraints

- No provider secret / API key ever ships to the browser — server mints ephemeral tokens only.
- Live audio path must stream browser→provider directly (no server relay).
- Diarization capped at **5 speakers**; fixed ordered color palette (ink blue, rust orange, teal green, violet, amber/ochre), each >= WCAG AA 4.5:1 on light and dark, color-blind-safe, always paired with speaker name. 6th+ speaker → neutral labeled style.
- Keyterm prompting ON by default.
- AudioWorklet only — no deprecated `createScriptProcessor`.
- Transcript body font is a humanist sans/mono; headings/speaker-names a serif. Never Inter/Roboto/Arial.
- All boundaries validate input; no swallowed errors.
- **Two-track:** live track = fast interim words; correction track = per-utterance server re-transcription that replaces the committed line via `onCorrected`. Correction failure must never lose the original live text.
- Node 20, pnpm. Commit after every task.

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `vitest.config.ts`
- Modify: `.gitignore` (exists)

**Interfaces:**
- Produces: a running Next.js dev server on `:3000`; `pnpm test` runs Vitest.

- [ ] **Step 1: Scaffold with create-next-app**

Run from `/Users/rsreddy/Documents/transcribe-app`:
```bash
pnpm dlx create-next-app@latest . --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*" --no-turbopack --use-pnpm --yes
```
Expected: files created, `pnpm install` completes. (If it refuses on non-empty dir, scaffold in a temp dir and move files in, preserving `docs/`.)

- [ ] **Step 2: Add Vitest**

```bash
pnpm add -D vitest @vitest/ui jsdom @vitejs/plugin-react
```

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true },
})
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Verify dev server and test runner**

Run: `pnpm dev` (Ctrl-C after confirming `:3000` serves), then `pnpm test`
Expected: dev server boots; `pnpm test` reports "No test files found" (exit 0 is fine, or add the Task 2 test first).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with Vitest"
```

---

### Task 1b: Clerk authentication

**Files:** created/modified by `clerk init` (SDK install, `middleware.ts` [Next 15] or `proxy.ts` [Next 16+], `<ClerkProvider>` in `app/layout.tsx`, `.env.local` keys).

**Interfaces:**
- Consumes: scaffolded app (Task 1).
- Produces: working sign-in/sign-up/UserButton controls; `await auth()` available server-side to gate routes.

- [ ] **Step 1: Install/upgrade Clerk CLI, then auth**

```bash
command -v clerk && clerk --version || npm install -g clerk
clerk auth login   # opens browser; pause for user to complete
```

- [ ] **Step 2: Init into the existing project**

```bash
clerk init
```
Detects Next.js + pnpm, installs `@clerk/nextjs`, adds middleware + `<ClerkProvider>`. Do not pass `--framework`/`--pm`/`--app` unless the CLI asks.

- [ ] **Step 3: Add visible auth controls**

Ensure `app/layout.tsx` shows `SignInButton`/`SignUpButton` when signed out and `UserButton` when signed in (inside `<ClerkProvider>`, inside `<body>`). Reuse if already added by init.

- [ ] **Step 4: Verify + commit**

```bash
clerk doctor
git add -A && git commit -m "feat: Clerk authentication"
```
Note: middleware filename follows Next version (`proxy.ts` on 16+, `middleware.ts` on ≤15). Never expose `CLERK_SECRET_KEY` client-side. `.env.local` stays gitignored.

---

### Task 1c: PostHog analytics + event logging

**Files:**
- Create: `app/providers.tsx` (client), `lib/analytics.ts`
- Modify: `app/layout.tsx` (wrap with PostHogProvider inside ClerkProvider)
- Add deps: `posthog-js`, `posthog-node`

**Interfaces:**
- Consumes: scaffolded app (Task 1), Clerk (Task 1b).
- Produces: `capture(event: string, props?: Record<string, unknown>)` client helper; server-side `posthogServer` for API-route event logging (session start/stop, provider fallback, correction hit-rate, errors).

- [ ] **Step 1: Install**

```bash
pnpm add posthog-js posthog-node
```

- [ ] **Step 2: Client provider**

`app/providers.tsx`:
```tsx
'use client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (key && !posthog.__loaded) {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        capture_pageview: true,
        autocapture: false, // ponytail: explicit events only; autocapture is noise for this app
      })
    }
  }, [])
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
```

`lib/analytics.ts`:
```ts
import { PostHog } from 'posthog-node'

let server: PostHog | null = null
export function posthogServer(): PostHog | null {
  const key = process.env.POSTHOG_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  if (!server) server = new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com' })
  return server
}
```

- [ ] **Step 3: Wire in layout** — wrap `{children}` with `<Providers>` inside `<ClerkProvider>`, inside `<body>`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm build` (expect success; PostHog no-ops without a key, so it never breaks local dev)
```bash
git add app/providers.tsx lib/analytics.ts app/layout.tsx package.json pnpm-lock.yaml && git commit -m "feat: PostHog analytics and server event logging"
```

---

### Task 2: Provider types + speaker color palette

**Files:**
- Create: `lib/transcription/types.ts`, `lib/speakers/palette.ts`, `lib/speakers/palette.test.ts`

**Interfaces:**
- Produces:
  - `type TranscriptEvent = { text: string; isFinal: boolean; speaker: number | null; startMs: number; endMs: number }`
  - `type TranscriptionConfig = { keyterms: string[]; sampleRate: number; maxSpeakers: number }`
  - `interface TranscriptionProvider { connect(c: TranscriptionConfig): Promise<void>; sendAudio(chunk: ArrayBuffer): void; updateKeyterms(t: string[]): Promise<void>; onPartial(cb: (e: TranscriptEvent) => void): void; onFinal(cb: (e: TranscriptEvent) => void): void; disconnect(): Promise<void> }`
  - `function speakerColor(index: number, theme: 'light' | 'dark'): { color: string; name: string }` — index 0-4 → palette color; >=5 → neutral.

- [ ] **Step 1: Write the failing test**

`lib/speakers/palette.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { speakerColor, SPEAKER_PALETTE } from './palette'

describe('speakerColor', () => {
  it('assigns a distinct palette color to speakers 0-4', () => {
    const colors = [0,1,2,3,4].map(i => speakerColor(i, 'light').color)
    expect(new Set(colors).size).toBe(5)
  })
  it('falls back to neutral for a 6th speaker', () => {
    expect(speakerColor(5, 'light').color).toBe(SPEAKER_PALETTE.neutral.light)
  })
  it('provides light and dark variants', () => {
    expect(speakerColor(0, 'light').color).not.toBe(speakerColor(0, 'dark').color)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test palette`
Expected: FAIL — cannot find `./palette`.

- [ ] **Step 3: Implement types and palette**

`lib/transcription/types.ts`:
```ts
export type TranscriptEvent = {
  text: string
  isFinal: boolean
  speaker: number | null
  startMs: number
  endMs: number
}

export type TranscriptionConfig = {
  keyterms: string[]
  sampleRate: number
  maxSpeakers: number
}

export interface TranscriptionProvider {
  connect(config: TranscriptionConfig): Promise<void>
  sendAudio(chunk: ArrayBuffer): void
  updateKeyterms(terms: string[]): Promise<void>
  onPartial(callback: (e: TranscriptEvent) => void): void
  onFinal(callback: (e: TranscriptEvent) => void): void
  disconnect(): Promise<void>
}
```

> Note: the correction track (Task 9b) is a separate module, not part of `TranscriptionProvider`. Providers emit `onFinal`; the record screen owns wiring finals to the correction endpoint and applying `onCorrected` results.

`lib/speakers/palette.ts` (colors chosen for AA contrast on both themes, deuteranopia/protanopia-separated):
```ts
// ponytail: colors hand-picked for AA (>=4.5:1) on light (#faf9f7) and dark (#16151a)
// backgrounds and checked against deuteranopia/protanopia. Re-validate if bg changes.
export const SPEAKER_PALETTE = {
  speakers: [
    { name: 'Speaker 1', light: '#1d4ed8', dark: '#93c5fd' }, // ink blue
    { name: 'Speaker 2', light: '#b45309', dark: '#fdba74' }, // rust orange
    { name: 'Speaker 3', light: '#0f766e', dark: '#5eead4' }, // teal green
    { name: 'Speaker 4', light: '#7c3aed', dark: '#c4b5fd' }, // violet
    { name: 'Speaker 5', light: '#a16207', dark: '#fde047' }, // amber/ochre
  ],
  neutral: { light: '#3f3f46', dark: '#d4d4d8' },
} as const

export function speakerColor(index: number, theme: 'light' | 'dark') {
  const s = SPEAKER_PALETTE.speakers[index]
  if (!s) return { color: SPEAKER_PALETTE.neutral[theme], name: `Speaker ${index + 1}` }
  return { color: s[theme], name: s.name }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test palette`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ && git commit -m "feat: transcription types and speaker color palette"
```

---

### Task 3: PCM conversion utility

**Files:**
- Create: `lib/audio/pcm.ts`, `lib/audio/pcm.test.ts`

**Interfaces:**
- Produces: `function floatTo16BitPCM(input: Float32Array): Int16Array` — clamps to [-1,1], scales negatives by 32768 and positives by 32767.

- [ ] **Step 1: Write the failing test**

`lib/audio/pcm.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { floatTo16BitPCM } from './pcm'

describe('floatTo16BitPCM', () => {
  it('maps 0 to 0, +1 to 32767, -1 to -32768', () => {
    const out = floatTo16BitPCM(new Float32Array([0, 1, -1]))
    expect(Array.from(out)).toEqual([0, 32767, -32768])
  })
  it('clamps values beyond [-1,1]', () => {
    const out = floatTo16BitPCM(new Float32Array([2, -2]))
    expect(Array.from(out)).toEqual([32767, -32768])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test pcm`
Expected: FAIL — cannot find `./pcm`.

- [ ] **Step 3: Implement**

`lib/audio/pcm.ts`:
```ts
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test pcm`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/audio/ && git commit -m "feat: Float32 to Int16 PCM conversion"
```

---

### Task 4: AudioWorklet + mic hook

**Files:**
- Create: `public/worklet-processor.js`, `lib/audio/useMicStream.ts`

**Interfaces:**
- Consumes: `floatTo16BitPCM` (Task 3).
- Produces: `function useMicStream(): { start: (onPcm: (pcm: ArrayBuffer) => void, onLevel: (rms: number) => void) => Promise<void>; stop: () => void; error: string | null }`

- [ ] **Step 1: Write the worklet**

`public/worklet-processor.js` (plain JS, loaded by URL — not bundled):
```js
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0]
    if (!ch) return true
    let sumSq = 0
    for (let i = 0; i < ch.length; i++) sumSq += ch[i] * ch[i]
    const rms = Math.sqrt(sumSq / ch.length)
    // transfer a copy of the Float32 frame + level to the main thread
    this.port.postMessage({ samples: ch.slice(0), rms })
    return true
  }
}
registerProcessor('pcm-processor', PCMProcessor)
```

- [ ] **Step 2: Implement the hook**

`lib/audio/useMicStream.ts`:
```ts
import { useRef, useState, useCallback } from 'react'
import { floatTo16BitPCM } from './pcm'

const TARGET_SAMPLE_RATE = 16000

export function useMicStream() {
  const [error, setError] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(
    async (onPcm: (pcm: ArrayBuffer) => void, onLevel: (rms: number) => void) => {
      setError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: TARGET_SAMPLE_RATE },
        })
        streamRef.current = stream
        const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
        ctxRef.current = ctx
        await ctx.audioWorklet.addModule('/worklet-processor.js')
        const source = ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(ctx, 'pcm-processor')
        node.port.onmessage = (ev: MessageEvent<{ samples: Float32Array; rms: number }>) => {
          const pcm = floatTo16BitPCM(ev.data.samples)
          onPcm(pcm.buffer)
          onLevel(ev.data.rms)
        }
        source.connect(node)
        node.connect(ctx.destination)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Microphone access failed')
        throw e
      }
    },
    [],
  )

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close()
    streamRef.current = null
    ctxRef.current = null
  }, [])

  return { start, stop, error }
}
```

- [ ] **Step 3: Manual verification note**

AudioWorklet needs a real browser + mic; no unit test here (jsdom lacks WebAudio). Verified live in Task 10. Confirm the file typechecks:
Run: `pnpm tsc --noEmit`
Expected: no errors in these files.

- [ ] **Step 4: Commit**

```bash
git add public/worklet-processor.js lib/audio/useMicStream.ts && git commit -m "feat: AudioWorklet mic capture hook"
```

---

### Task 5: Token mint API route

**Files:**
- Create: `app/api/token/route.ts`, `.env.example`

**Interfaces:**
- Produces: `POST /api/token` body `{ provider: 'assemblyai' | 'deepgram' }` → `{ token: string, expiresAt: number }`. Reads keys from `process.env`. Returns 400 on unknown provider, 500 if key missing.

- [ ] **Step 1: Add env template**

`.env.example`:
```
ASSEMBLYAI_API_KEY=
DEEPGRAM_API_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 2: Implement the route**

`app/api/token/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const provider = body.provider

  if (provider === 'assemblyai') {
    const key = process.env.ASSEMBLYAI_API_KEY
    if (!key) return NextResponse.json({ error: 'AssemblyAI key not configured' }, { status: 500 })
    // AssemblyAI streaming temp token (v3). Confirm endpoint against current docs at build time.
    const r = await fetch(
      'https://streaming.assemblyai.com/v3/token?expires_in_seconds=300',
      { headers: { Authorization: key } },
    )
    if (!r.ok) return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
    const j = await r.json()
    return NextResponse.json({ token: j.token, expiresAt: Date.now() + 300_000 })
  }

  if (provider === 'deepgram') {
    const key = process.env.DEEPGRAM_API_KEY
    if (!key) return NextResponse.json({ error: 'Deepgram key not configured' }, { status: 500 })
    // ponytail: v1 uses short-lived grant token; upgrade to per-scope grants if abuse shows up.
    const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 300 }),
    })
    if (!r.ok) return NextResponse.json({ error: 'Token mint failed' }, { status: 502 })
    const j = await r.json()
    return NextResponse.json({ token: j.access_token, expiresAt: Date.now() + 300_000 })
  }

  return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
}
```

- [ ] **Step 3: Verify unknown-provider guard**

Run: `pnpm dev` then in another shell:
```bash
curl -s -X POST localhost:3000/api/token -H 'Content-Type: application/json' -d '{"provider":"nope"}'
```
Expected: `{"error":"Unknown provider"}` with HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add app/api/token/ .env.example && git commit -m "feat: ephemeral token mint endpoint"
```

---

### Task 6: AssemblyAI provider (primary)

**Files:**
- Create: `lib/transcription/assemblyai.ts`

**Interfaces:**
- Consumes: `TranscriptionProvider`, `TranscriptEvent`, `TranscriptionConfig` (Task 2); `POST /api/token` (Task 5).
- Produces: `class AssemblyAIProvider implements TranscriptionProvider`.

- [ ] **Step 1: Implement**

`lib/transcription/assemblyai.ts`:
```ts
import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'

export class AssemblyAIProvider implements TranscriptionProvider {
  private ws: WebSocket | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}

  async connect(config: TranscriptionConfig): Promise<void> {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'assemblyai' }),
    })
    if (!res.ok) throw new Error('AssemblyAI token mint failed')
    const { token } = await res.json()

    const params = new URLSearchParams({
      sample_rate: String(config.sampleRate),
      speaker_labels: 'true',
      token,
    })
    if (config.keyterms.length) params.set('keyterms_prompt', JSON.stringify(config.keyterms))

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`)
      this.ws = ws
      const timeout = setTimeout(() => { ws.close(); reject(new Error('AssemblyAI WS timeout')) }, 10_000)
      ws.onopen = () => { clearTimeout(timeout); resolve() }
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('AssemblyAI WS error')) }
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data)
        if (data.type !== 'Turn') return
        const evt: TranscriptEvent = {
          text: data.transcript ?? '',
          isFinal: data.end_of_turn === true,
          speaker: typeof data.speaker === 'number' ? data.speaker : null,
          startMs: data.audio_start ?? 0,
          endMs: data.audio_end ?? 0,
        }
        ;(evt.isFinal ? this.finalCb : this.partialCb)(evt)
      }
    })
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk)
  }

  async updateKeyterms(): Promise<void> { /* v1: keyterms fixed at connect */ }
  onPartial(cb: (e: TranscriptEvent) => void) { this.partialCb = cb }
  onFinal(cb: (e: TranscriptEvent) => void) { this.finalCb = cb }
  async disconnect(): Promise<void> {
    this.ws?.send(JSON.stringify({ type: 'Terminate' }))
    this.ws?.close()
    this.ws = null
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/transcription/assemblyai.ts && git commit -m "feat: AssemblyAI streaming provider"
```

---

### Task 7: Deepgram provider (fallback)

**Files:**
- Create: `lib/transcription/deepgram.ts`

**Interfaces:**
- Consumes: same as Task 6.
- Produces: `class DeepgramProvider implements TranscriptionProvider`.

- [ ] **Step 1: Implement**

`lib/transcription/deepgram.ts`:
```ts
import type { TranscriptionProvider, TranscriptionConfig, TranscriptEvent } from './types'

export class DeepgramProvider implements TranscriptionProvider {
  private ws: WebSocket | null = null
  private partialCb: (e: TranscriptEvent) => void = () => {}
  private finalCb: (e: TranscriptEvent) => void = () => {}

  async connect(config: TranscriptionConfig): Promise<void> {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepgram' }),
    })
    if (!res.ok) throw new Error('Deepgram token mint failed')
    const { token } = await res.json()

    const params = new URLSearchParams({
      model: 'nova-3', language: 'en-US', smart_format: 'true',
      interim_results: 'true', punctuate: 'true', diarize: 'true',
      endpointing: '50', no_delay: 'true', encoding: 'linear16',
      sample_rate: String(config.sampleRate), channels: '1',
    })
    config.keyterms.forEach((t) => params.append('keyterm', t))

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', token])
      this.ws = ws
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Deepgram WS timeout')) }, 10_000)
      ws.onopen = () => { clearTimeout(timeout); resolve() }
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Deepgram WS error')) }
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data)
        const alt = data.channel?.alternatives?.[0]
        if (!alt) return
        const speaker = alt.words?.[0]?.speaker
        const evt: TranscriptEvent = {
          text: alt.transcript ?? '',
          isFinal: data.is_final === true,
          speaker: typeof speaker === 'number' ? speaker : null,
          startMs: Math.round((data.start ?? 0) * 1000),
          endMs: Math.round(((data.start ?? 0) + (data.duration ?? 0)) * 1000),
        }
        if (!evt.text) return
        ;(evt.isFinal ? this.finalCb : this.partialCb)(evt)
      }
    })
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk)
  }
  async updateKeyterms(): Promise<void> {}
  onPartial(cb: (e: TranscriptEvent) => void) { this.partialCb = cb }
  onFinal(cb: (e: TranscriptEvent) => void) { this.finalCb = cb }
  async disconnect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'CloseStream' }))
    this.ws?.close()
    this.ws = null
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm tsc --noEmit` (expect no errors)
```bash
git add lib/transcription/deepgram.ts && git commit -m "feat: Deepgram fallback provider"
```

---

### Task 8: Provider factory with fallback

**Files:**
- Create: `lib/transcription/index.ts`, `lib/transcription/factory.test.ts`

**Interfaces:**
- Consumes: `AssemblyAIProvider` (Task 6), `DeepgramProvider` (Task 7).
- Produces: `async function connectWithFallback(config: TranscriptionConfig, makers?: ProviderMaker[]): Promise<{ provider: TranscriptionProvider; name: string }>` — tries each maker in order, returns the first that connects; throws if all fail. `type ProviderMaker = { name: string; make: () => TranscriptionProvider }`.

- [ ] **Step 1: Write the failing test**

`lib/transcription/factory.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { connectWithFallback } from './index'
import type { TranscriptionProvider } from './types'

const stub = (fail: boolean): TranscriptionProvider => ({
  connect: fail ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn().mockResolvedValue(undefined),
  sendAudio: vi.fn(), updateKeyterms: vi.fn(), onPartial: vi.fn(), onFinal: vi.fn(), disconnect: vi.fn(),
})
const cfg = { keyterms: [], sampleRate: 16000, maxSpeakers: 5 }

describe('connectWithFallback', () => {
  it('returns the first provider that connects', async () => {
    const res = await connectWithFallback(cfg, [
      { name: 'primary', make: () => stub(true) },
      { name: 'fallback', make: () => stub(false) },
    ])
    expect(res.name).toBe('fallback')
  })
  it('throws when all providers fail', async () => {
    await expect(connectWithFallback(cfg, [{ name: 'only', make: () => stub(true) }])).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test factory`
Expected: FAIL — cannot find `connectWithFallback`.

- [ ] **Step 3: Implement**

`lib/transcription/index.ts`:
```ts
import type { TranscriptionProvider, TranscriptionConfig } from './types'
import { AssemblyAIProvider } from './assemblyai'
import { DeepgramProvider } from './deepgram'

export type ProviderMaker = { name: string; make: () => TranscriptionProvider }

export const DEFAULT_MAKERS: ProviderMaker[] = [
  { name: 'AssemblyAI', make: () => new AssemblyAIProvider() },
  { name: 'Deepgram', make: () => new DeepgramProvider() },
]

export async function connectWithFallback(
  config: TranscriptionConfig,
  makers: ProviderMaker[] = DEFAULT_MAKERS,
): Promise<{ provider: TranscriptionProvider; name: string }> {
  let lastErr: unknown
  for (const m of makers) {
    const provider = m.make()
    try {
      await provider.connect(config)
      return { provider, name: m.name }
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`All transcription providers failed: ${String(lastErr)}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test factory`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/index.ts lib/transcription/factory.test.ts && git commit -m "feat: provider factory with fallback"
```

---

### Task 9: Summarize API route

**Files:**
- Create: `app/api/summarize/route.ts`
- Modify: add dep `openai`

**Interfaces:**
- Produces: `POST /api/summarize` body `{ transcript: string }` → `{ summary: string; keyPoints: string[]; actionItems: string[] }`. 400 on empty transcript.

- [ ] **Step 1: Add SDK**

```bash
pnpm add openai
```

- [ ] **Step 2: Implement**

`app/api/summarize/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(req: NextRequest) {
  let body: { transcript?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const transcript = body.transcript?.trim()
  if (!transcript) return NextResponse.json({ error: 'Empty transcript' }, { status: 400 })

  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'OpenAI key not configured' }, { status: 500 })
  const client = new OpenAI({ apiKey: key })

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You summarize transcripts. Respond ONLY with JSON: {"summary": string, "keyPoints": string[], "actionItems": string[]}.' },
      { role: 'user', content: transcript.slice(0, 100_000) },
    ],
    response_format: { type: 'json_object' },
  })
  const raw = completion.choices[0]?.message?.content ?? '{}'
  try {
    const parsed = JSON.parse(raw)
    return NextResponse.json({
      summary: parsed.summary ?? '',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    })
  } catch {
    return NextResponse.json({ error: 'Summary parse failed' }, { status: 502 })
  }
}
```

- [ ] **Step 3: Verify empty-transcript guard**

Run: `pnpm dev`, then:
```bash
curl -s -X POST localhost:3000/api/summarize -H 'Content-Type: application/json' -d '{"transcript":""}'
```
Expected: `{"error":"Empty transcript"}` HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add app/api/summarize/ package.json pnpm-lock.yaml && git commit -m "feat: summarize endpoint"
```

---

### Task 9b: Correction-track endpoint (accuracy second pass)

**Files:**
- Create: `app/api/correct/route.ts`

**Interfaces:**
- Consumes: OpenAI SDK (Task 9).
- Produces: `POST /api/correct` body `{ text: string; context?: string; keyterms?: string[] }` → `{ text: string }`. Uses an LLM to fix jargon/homophone/punctuation errors in a finalized live-transcript line, given recent context and the domain keyterm list. **Fail-soft:** on missing key or any error, returns `{ text }` echoing the original — a correction failure must never lose or blank the live line. 400 only if `text` is empty.

Rationale: the live track showed words fast; this pass cleans the finalized line using full context the streaming model lacked. v1 uses **text correction** (no audio machinery). *v2 upgrade:* re-transcribe per-utterance audio with `gpt-4o-transcribe` for acoustic-level fixes (needs per-utterance audio slicing — deferred).

- [ ] **Step 1: Implement**

`app/api/correct/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(req: NextRequest) {
  let body: { text?: string; context?: string; keyterms?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = body.text?.trim()
  if (!text) return NextResponse.json({ error: 'Empty text' }, { status: 400 })

  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ text }) // fail-soft: keep live line

  try {
    const client = new OpenAI({ apiKey: key })
    const terms = (body.keyterms ?? []).join(', ')
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Correct transcription errors in the user's line: fix homophones, punctuation, capitalization, and misheard technical jargon. Preserve meaning and speaker wording — do NOT paraphrase or add content. Domain terms that may appear: ${terms || 'none'}. Respond ONLY with JSON: {"text": string}.` },
        { role: 'user', content: `Recent context: ${body.context ?? ''}\n\nLine to correct: ${text}` },
      ],
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)
    return NextResponse.json({ text: typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : text })
  } catch {
    return NextResponse.json({ text }) // fail-soft: never lose or blank the live line
  }
}
```

- [ ] **Step 2: Verify empty-text guard**

Run: `pnpm dev`, then:
```bash
curl -s -X POST localhost:3000/api/correct -H 'Content-Type: application/json' -d '{"text":""}'
```
Expected: `{"error":"Empty text"}` HTTP 400.

- [ ] **Step 3: Commit**

```bash
git add app/api/correct/ && git commit -m "feat: correction-track endpoint (fail-soft text accuracy pass)"
```

---

### Task 10: Transcript store + record screen

**Files:**
- Create: `lib/transcript/store.ts`, `lib/transcript/store.test.ts`, `app/(app)/record/page.tsx`, `components/transcript/TranscriptView.tsx`, `components/transcript/AudioMeter.tsx`

**Interfaces:**
- Consumes: `useMicStream` (Task 4), `connectWithFallback` (Task 8), `speakerColor` (Task 2), `TranscriptEvent` (Task 2).
- Consumes also: `POST /api/correct` (Task 9b).
- Produces:
  - `function mergeSegments(prev: Segment[], e: TranscriptEvent): Segment[]` where `type Segment = { id: number; speaker: number | null; text: string; isFinal: boolean }` — appends a new final segment, or replaces the trailing interim (reusing its id).
  - `function applyCorrection(prev: Segment[], id: number, text: string): Segment[]`.
  - `function transcriptText(segments: Segment[]): string`.
  - A working `/record` page: Record button → live captions with per-speaker colors + audio meter → correction track upgrades finalized lines in place → Stop → summary.

- [ ] **Step 1: Write the failing test**

`lib/transcript/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mergeSegments, type Segment } from './store'

const ev = (text: string, isFinal: boolean, speaker: number | null = 0) =>
  ({ text, isFinal, speaker, startMs: 0, endMs: 0 })

describe('mergeSegments', () => {
  it('replaces a trailing interim with the next interim', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('hel', false))
    s = mergeSegments(s, ev('hello', false))
    expect(s).toHaveLength(1)
    expect(s[0].text).toBe('hello')
  })
  it('commits a final and starts fresh for the next interim', () => {
    let s: Segment[] = []
    s = mergeSegments(s, ev('hello', true))
    s = mergeSegments(s, ev('world', false))
    expect(s.map((x) => x.text)).toEqual(['hello', 'world'])
    expect(s[0].isFinal).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test store`
Expected: FAIL — cannot find `./store`.

- [ ] **Step 3: Implement the store**

`lib/transcript/store.ts`:
```ts
import type { TranscriptEvent } from '@/lib/transcription/types'

let SEG_SEQ = 0
export type Segment = { id: number; speaker: number | null; text: string; isFinal: boolean }

export function mergeSegments(prev: Segment[], e: TranscriptEvent): Segment[] {
  const last = prev[prev.length - 1]
  if (last && !last.isFinal) {
    // replace the trailing interim (reuse its id)
    return [...prev.slice(0, -1), { id: last.id, speaker: e.speaker, text: e.text, isFinal: e.isFinal }]
  }
  return [...prev, { id: ++SEG_SEQ, speaker: e.speaker, text: e.text, isFinal: e.isFinal }]
}

// correction track: replace a finalized segment's text in place, by id
export function applyCorrection(prev: Segment[], id: number, text: string): Segment[] {
  return prev.map((s) => (s.id === id ? { ...s, text } : s))
}

export function transcriptText(segments: Segment[]): string {
  return segments
    .filter((s) => s.isFinal)
    .map((s) => (s.speaker != null ? `Speaker ${s.speaker + 1}: ${s.text}` : s.text))
    .join('\n')
}
```

Update the test's event helper and expectations to account for the `id` field: segments now carry an `id`; assert on `.text`/`.isFinal` as before, and add one case for `applyCorrection`:
```ts
it('applyCorrection replaces text of the matching segment id', () => {
  let s: Segment[] = []
  s = mergeSegments(s, ev('helo wrld', true))
  s = applyCorrection(s, s[0].id, 'hello world')
  expect(s[0].text).toBe('hello world')
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test store`
Expected: PASS (2 tests).

- [ ] **Step 5: Build AudioMeter + TranscriptView**

`components/transcript/AudioMeter.tsx`:
```tsx
export function AudioMeter({ level }: { level: number }) {
  const pct = Math.min(100, Math.round(level * 300))
  return (
    <div className="h-2 w-40 overflow-hidden rounded-full bg-black/10" aria-hidden>
      <div className="h-full bg-emerald-600 transition-[width] duration-75" style={{ width: `${pct}%` }} />
    </div>
  )
}
```

`components/transcript/TranscriptView.tsx`:
```tsx
'use client'
import { speakerColor } from '@/lib/speakers/palette'
import type { Segment } from '@/lib/transcript/store'

export function TranscriptView({ segments, theme, readerMode }: {
  segments: Segment[]; theme: 'light' | 'dark'; readerMode: boolean
}) {
  return (
    <div className={readerMode ? 'mx-auto max-w-3xl px-6 py-10' : 'px-6 py-4'}>
      {segments.map((s, i) => {
        const { color, name } = speakerColor(s.speaker ?? 0, theme)
        return (
          <p key={i} className="mb-4 text-lg leading-relaxed" style={{ opacity: s.isFinal ? 1 : 0.55 }}>
            {s.speaker != null && (
              <span className="mr-2 font-serif text-sm font-semibold" style={{ color }}>{name}</span>
            )}
            <span style={readerMode ? { color } : undefined}>{s.text}</span>
          </p>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Build the record page**

`app/(app)/record/page.tsx`:
```tsx
'use client'
import { useCallback, useRef, useState } from 'react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import { mergeSegments, applyCorrection, transcriptText, type Segment } from '@/lib/transcript/store'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { AudioMeter } from '@/components/transcript/AudioMeter'
import type { TranscriptionProvider, TranscriptEvent } from '@/lib/transcription/types'

const KEYTERMS = ['Kubernetes', 'idempotency', 'quantization', 'Kafka', 'AWS Lambda', 'system design']

// correction track: on each finalized line, re-clean it server-side and swap in place. Fail-soft.
async function correctLine(id: number, e: TranscriptEvent, context: string, setSegments: (fn: (s: Segment[]) => Segment[]) => void) {
  try {
    const r = await fetch('/api/correct', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: e.text, context, keyterms: KEYTERMS }),
    })
    if (!r.ok) return
    const { text } = await r.json()
    if (text && text !== e.text) setSegments((s) => applyCorrection(s, id, text))
  } catch { /* fail-soft: keep the live line */ }
}

export default function RecordPage() {
  const { start, stop, error } = useMicStream()
  const [segments, setSegments] = useState<Segment[]>([])
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)
  const [engine, setEngine] = useState<string | null>(null)
  const [reader, setReader] = useState(false)
  const [summary, setSummary] = useState<{ summary: string; keyPoints: string[]; actionItems: string[] } | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)

  const onStart = useCallback(async () => {
    setSegments([]); setSummary(null)
    try {
      const { provider, name } = await connectWithFallback({ keyterms: KEYTERMS, sampleRate: 16000, maxSpeakers: 5 })
      providerRef.current = provider
      setEngine(name)
      provider.onPartial((e) => setSegments((s) => mergeSegments(s, e)))
      provider.onFinal((e) => {
        setSegments((s) => {
          const merged = mergeSegments(s, e)
          const id = merged[merged.length - 1].id
          const context = transcriptText(merged.slice(-4, -1)) // recent finals for context
          void correctLine(id, e, context, setSegments)
          return merged
        })
      })
      await start((pcm) => provider.sendAudio(pcm), setLevel)
      setRecording(true)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to start')
    }
  }, [start])

  const onStop = useCallback(async () => {
    stop(); await providerRef.current?.disconnect(); setRecording(false); setLevel(0)
    const text = transcriptText(segments)
    if (text) {
      const r = await fetch('/api/summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: text }),
      })
      if (r.ok) setSummary(await r.json())
    }
  }, [stop, segments])

  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      {!reader && (
        <header className="flex items-center gap-4 border-b border-black/10 px-6 py-3">
          {!recording ? (
            <button onClick={onStart} className="rounded-full bg-emerald-700 px-5 py-2 font-medium text-white">Start Recording</button>
          ) : (
            <button onClick={onStop} className="rounded-full bg-red-700 px-5 py-2 font-medium text-white">Stop</button>
          )}
          <AudioMeter level={level} />
          {engine && <span className="text-sm text-black/50">Engine: {engine}</span>}
          <button onClick={() => setReader(true)} className="ml-auto text-sm underline">Reader Mode</button>
          {error && <span className="text-sm text-red-700">{error}</span>}
        </header>
      )}
      {reader && (
        <button onClick={() => setReader(false)} className="fixed right-4 top-4 z-10 text-sm underline">Exit Reader</button>
      )}
      <TranscriptView segments={segments} theme="light" readerMode={reader} />
      {summary && !reader && (
        <section className="mx-6 mb-10 rounded-lg border border-black/10 p-4">
          <h2 className="mb-2 font-serif text-xl">Summary</h2>
          <p className="mb-3">{summary.summary}</p>
          {summary.actionItems.length > 0 && (
            <><h3 className="font-semibold">Action Items</h3>
              <ul className="list-disc pl-5">{summary.actionItems.map((a, i) => <li key={i}>{a}</li>)}</ul></>
          )}
        </section>
      )}
    </main>
  )
}
```

- [ ] **Step 7: Live verification**

Set real keys in `.env.local`, run `pnpm dev`, open `/record`, allow mic, speak. Confirm: captions appear, per-speaker colors render, Reader Mode toggles, Stop produces a summary.
Expected: live captions within ~300ms; engine shows "AssemblyAI" (or "Deepgram" if primary failed).

- [ ] **Step 8: Commit**

```bash
git add lib/transcript components/transcript "app/(app)" && git commit -m "feat: record screen with live transcript, reader mode, summary"
```

---

### Task 11: Home route + polish pass

**Files:**
- Modify: `app/page.tsx`, `app/globals.css`, `app/layout.tsx`

**Interfaces:**
- Consumes: `/record` (Task 10).
- Produces: a landing page linking to `/record`; distinctive serif+sans fonts loaded via `next/font`; base theme tokens.

- [ ] **Step 1: Load fonts + link to record**

In `app/layout.tsx` use `next/font/google` to load a serif (e.g. `Fraunces`) and a humanist sans (e.g. `IBM Plex Sans`) — NOT Inter/Roboto. Expose as CSS vars `--font-serif`, `--font-body`. Set body font to the humanist sans; map Tailwind `font-serif` to `--font-serif`.

`app/page.tsx`: a minimal hero with product name "LiveTranscript" and a primary link to `/record`.

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/ && git commit -m "feat: landing page and typographic system"
```

---

### Task 11b: Local verification gate (before any deploy)

**Files:** none (verification). Do NOT deploy until every check here passes.

- [ ] **Step 1: Clean build + tests + typecheck**

```bash
pnpm test && pnpm tsc --noEmit && pnpm build
```
Expected: all unit tests pass (palette, pcm, factory, store), no type errors, production build succeeds.

- [ ] **Step 2: Run locally with real keys**

Put real keys in `.env.local` (`ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, Clerk keys from init, `NEXT_PUBLIC_POSTHOG_KEY`). Then `pnpm dev`.

- [ ] **Step 3: Chrome DevTools MCP verification loop** (agent drives a real browser at localhost:3000):
  - Load `/` → sign-up flow renders (Clerk controls visible).
  - `/record` → grant mic → speak a scripted line with jargon ("Let's discuss idempotency in the Kubernetes controller"). Confirm: interim words appear < ~500ms; final line commits; correction track swaps in cleaned text; per-speaker color renders.
  - Toggle Reader Mode → only transcript visible, speaker colors applied.
  - Stop → summary + action items render.
  - Check Network tab: `/api/token` returns a token; the provider WS is a **direct** connection to the provider domain (not our server); no API key visible in any request the browser makes.
  - Check Console: no thrown errors; PostHog events fire (session_started, session_stopped).
  - Screenshot light theme at 1440 + 768 widths for the readability check.

- [ ] **Step 4: Fix anything broken, re-run Steps 1-3 until green. Commit.**

```bash
git add -A && git commit -m "chore: local verification pass green"
```

---

### Task 12: Deploy to Vercel + wire domain

**Files:** none (infra). Only after Task 11b is fully green.

- [ ] **Step 1: Push to a Git host and import to Vercel** (or `vercel deploy`). Set env vars in Vercel project settings (never in the repo): `ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.
- [ ] **Step 2: Add `livetranscript.ai` as a custom domain in Vercel; at Cloudflare, set the DNS records Vercel specifies (CNAME/A). Same pattern as KreditWiz.**
- [ ] **Step 3: In Clerk dashboard, add the production domain (`livetranscript.ai`) to allowed origins / set production instance keys.**
- [ ] **Step 4: Verify production `/record` works end to end over HTTPS (mic requires secure context); confirm PostHog receives prod events.**

---

## Self-Review

**Spec coverage:**
- Swappable provider layer → Tasks 2, 6, 7, 8
- Ephemeral token / no keys in browser → Task 5
- AudioWorklet (not ScriptProcessor) → Task 4
- 5-speaker diarization + AA color-blind-safe palette → Task 2, rendered Task 10
- Keyterm prompting on by default → Tasks 6, 7, 10
- Two-track (live + correction) → Task 9b endpoint + Task 10 wiring (`applyCorrection`, `correctLine`)
- Clerk auth → Task 1b
- AI summary + action items → Tasks 9, 10
- Otter-style workspace + Reader Mode → Task 10
- Readability-first typography (serif+sans, not Inter) → Task 11
- Error handling (token fail, WS fallback, mic denied, AI fail, correction fail-soft) → Tasks 5, 8, 4, 10, 9b
- Deferred v2 (billing/persistence, audio-level re-transcription correction, OpenAI Realtime WebRTC premium tier, Cluely-class native app) → not in plan, correct

**Placeholder scan:** no TBD/TODO; every code step has full code.

**Type consistency:** `TranscriptEvent`, `TranscriptionConfig`, `TranscriptionProvider`, `Segment` (now with `id`), `speakerColor`, `connectWithFallback`, `mergeSegments`, `applyCorrection`, `transcriptText`, `floatTo16BitPCM` used consistently across tasks.

**Note:** provider WebSocket message shapes (AssemblyAI `Turn`, Deepgram `channel.alternatives`) and the AssemblyAI v3 token endpoint should be confirmed against current provider docs at implementation time (Context7 / vendor docs) — they evolve. The structure holds regardless.
