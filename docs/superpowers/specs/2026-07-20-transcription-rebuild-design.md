# Live Transcription App — Design Spec (v1)

**Date:** 2026-07-20
**Status:** Approved for planning
**Goal:** A greenfield live-transcription web app — faster and more readable than Otter.ai — replacing the old nojumper.wtf. General-purpose (interviews, meetings, dictation), built on a swappable transcription provider layer with server-side key security.

---

## 1. Scope

### v1 (this spec)
- Core real-time transcription via a swappable provider layer.
- Speaker diarization, up to **5 speakers**.
- AI post-session summary + action items.
- Otter-style 3-zone workspace **and** a full-screen text-only Reader Mode with per-speaker colors.

### Deferred to v2+ (designed for, not built)
- Clerk auth.
- Stripe pay-as-you-go billing (packs, custom minutes, portal).
- Supabase persistence + Row Level Security.
- Shareable `/view/:id` links with expiry.
- Affiliate program, admin console.

**v1 has no server persistence** — a session lives in the browser until stopped, then is summarized. Persistence arrives with Supabase in v2.

---

## 2. Architecture

Next.js App Router on Vercel. Live audio streams **browser → provider directly** using a short-lived scoped token; the real provider API keys never reach the browser. Batch AI work runs server-side.

**Approach A → C** (chosen):
- **A (live path):** server mints an ephemeral, session-scoped token; browser opens the WebSocket directly to the provider. Lowest latency (no relay hop), keys stay server-side, a leaked token expires in minutes. This is the primary latency win over the old app and over Otter.
- **C (batch path):** the optional OpenAI diarized accuracy pass runs server-side over the stored transcript/audio, where latency does not matter.
- **B (server WebSocket relay) is explicitly rejected** — it adds a per-chunk hop that fights the latency goal and needs always-on infra Vercel serverless handles poorly.

### Server responsibilities (only three)
- `POST /api/token` — mint a short-lived scoped token for the active provider (AssemblyAI temporary token / Deepgram `/v1/auth/grant` / OpenAI ephemeral realtime key). Holds the real keys.
- `POST /api/summarize` — LLM pass over the finished transcript → summary + key points + action items.
- `POST /api/final-transcript` — optional OpenAI diarized accuracy pass over stored audio (Approach C).

---

## 3. Transcription Provider Layer

Single provider-neutral interface; the UI never knows which provider is live.

```typescript
interface TranscriptionProvider {
  connect(config: TranscriptionConfig): Promise<void>;
  sendAudio(chunk: ArrayBuffer): void;
  updateKeyterms(terms: string[]): Promise<void>;
  onPartial(callback: (event: TranscriptEvent) => void): void;
  onFinal(callback: (event: TranscriptEvent) => void): void;
  disconnect(): Promise<void>;
}
```

`TranscriptEvent` normalizes across providers: `{ text, isFinal, speaker, startMs, endMs }`.

| Rank | Provider | Role | Model | Notes |
|------|----------|------|-------|-------|
| 1 | AssemblyAI | Primary live | `u3-rt-pro` | sub-300ms, `keyterms_prompt` (<=100 terms), streaming `speaker_labels`. `wss://streaming.assemblyai.com/v3/ws` |
| 2 | Deepgram | Fallback + benchmark | `nova-3` | `keyterm`, `diarize=true`, `interim_results`. `wss://api.deepgram.com/v1/listen` |
| 3 | OpenAI | Accuracy final pass | `gpt-4o-transcribe-diarize` | server-side batch over stored audio (Approach C), not the live caption stream |

**Fallback:** client-side in v1 — if the primary WS fails or closes early, the factory reconnects via Deepgram and a toast tells the user which engine is live. Centralized/server-driven fallback is a v2 concern.

**Keyterm prompting is on by default** (the accuracy win the old app advertised but never used).

### Module layout
```
lib/transcription/
  types.ts              # TranscriptionProvider, TranscriptEvent, TranscriptionConfig
  assemblyai.ts         # AssemblyAIProvider (primary)
  deepgram.ts           # DeepgramProvider (fallback/benchmark)
  openai.ts             # OpenAIProvider (accuracy pass)
  index.ts              # provider factory + fallback logic
lib/audio/
  worklet-processor.js  # AudioWorklet: Float32 -> Int16 PCM (replaces deprecated ScriptProcessor)
  useMicStream.ts       # getUserMedia + worklet hook; emits PCM + RMS/peak level
app/api/token/route.ts
app/api/summarize/route.ts
app/api/final-transcript/route.ts
app/(app)/record/       # live transcription screen
components/transcript/  # TranscriptView, SpeakerLabel, AudioMeter, SummaryPanel, ReaderMode
```

**Audio pipeline upgrade:** old app used deprecated `createScriptProcessor(256,1,1)` (main-thread churn). v1 uses an **AudioWorklet** at 16kHz — lower latency, no main-thread jank. Same Float32->Int16 linear16 conversion.

---

## 4. Data Flow (one session)

1. User hits Record -> `useMicStream` opens mic, AudioWorklet emits 16kHz Int16 PCM + live audio level.
2. Client calls `/api/token` -> scoped ephemeral token for the active provider.
3. Provider adapter opens WS direct to provider; streams PCM; emits `onPartial` (interim) and `onFinal` (committed) events with speaker labels.
4. `TranscriptView` renders interim text dimmed/live, final text committed in the speaker's color.
5. On stop -> transcript held in browser; `/api/summarize` produces summary + action items; optional `/api/final-transcript` runs the OpenAI diarized pass.

---

## 5. UI Direction — readability-first, Otter-style + Reader Mode

**Priority: text visibility above all.** Two views.

### Default workspace (Otter's familiar 3-zone layout, refined)
- **Left rail** — session list / nav, collapsible and quiet.
- **Center — the transcript, owns the screen.** Speaker-labeled blocks (avatar dot + name + timestamp), but larger reading type (~18-20px, generous line-height) and a measured column width so lines don't sprawl.
- **Right panel** — live Summary / Outline / Action Items, collapsible so it never steals transcript width.
- **Top** — pinned live waveform + audio meter + record controls.

### Reader Mode (full-screen, text-only) — a differentiator Otter lacks
- One toggle/keystroke collapses rail, right panel, and top controls. Nothing but the transcript at maximum comfortable reading width.
- **Each speaker's words are rendered in that speaker's high-visibility color** (color on the text itself, not just a label).
- Live captions still stream in Reader Mode: interim dims, final lands in the speaker's color.

### Speaker color palette (up to 5)
Fixed, ordered, assigned as speakers appear:
1. Ink blue  2. Rust orange  3. Teal green  4. Violet  5. Amber/ochre

Constraints:
- Every color >= **WCAG AA 4.5:1** against the reading background (light and dark variants swap per theme).
- Spaced around the hue wheel **and** color-blind-safe (validated against deuteranopia/protanopia — no red/green collision).
- Color is **always paired with the speaker name** — never hue-alone.
- A 6th+ speaker (rare) falls back to a neutral labeled style, not an unsafe color.

### Typography & motion
- Distinctive but legible pairing: a characterful **serif for speaker names/headings**, a crisp **humanist sans or mono for transcript body**. Not Inter/Roboto/Arial.
- Motion reserved for high-signal moments: live audio meter, interim->final settle (subtle, no abrupt jump), one staggered page load. No decoration that lowers contrast.

---

## 6. Error Handling

- **Token mint fails** -> clear error + retry; never silent.
- **Primary provider WS fails/closes early** -> auto-fallback to Deepgram; toast names the live engine.
- **Mic permission denied** -> explicit prompt with recovery steps (user-visible, unlike the old app's silent fallback).
- **AI pass fails** -> transcript still saved/shown; summary panel offers retry; transcript never lost.
- All boundaries validate input; no swallowed errors.

---

## 7. Testing

- **Unit (one runnable assert each):** Float32->Int16 PCM conversion correctness; provider factory fallback logic; `TranscriptEvent` normalization across providers; speaker->color assignment (AA contrast + stable ordering).
- **Manual/e2e smoke:** live mic -> captions per provider; Reader Mode toggle; summary generation.

---

## 8. Security (carried from prior audit)

- No provider secret, Supabase service-role key, or Pusher secret ever in the browser. Ephemeral tokens only.
- When v2 persistence lands: RLS default-deny on every table; sharing is an explicit `share_token` grant, not world-readable.
- Old leaked keys (Deepgram, Pusher secret, Supabase, Stripe) to be rotated before any reuse of those projects.
