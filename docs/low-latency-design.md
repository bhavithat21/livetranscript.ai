# LiveTranscript — Low-Latency Low-Level Design

**Goal:** spoken word → visible caption in **< 400 ms p50 / < 700 ms p95**, and follow-along highlight movement in **< 250 ms** from utterance. This document is the low-level design of how the current system achieves that and where each millisecond goes.

The guiding principle: **the only unavoidable network hop is the ASR round-trip; every other stage is either local or removed from the hot path.**

---

## 1. Latency budget (end-to-end, single speaker)

Per-stage estimate for the live caption path:

| # | Stage | Where | Budget (p50) | Notes |
|---|---|---|---|---|
| 1 | Mic → AudioWorklet | browser audio thread | ~5 ms | 128-sample quanta @ 16 kHz |
| 2 | Frame buffering | `worklet-processor.js` | **50 ms** | fixed: buffer 50 ms before posting (provider min payload) |
| 3 | Worklet → main thread | browser | ~1 ms | transferable `ArrayBuffer` (zero-copy) |
| 4 | PCM encode (f32 → int16) | main thread | ~1 ms | `floatTo16BitPCM`, per 50 ms frame |
| 5 | WebSocket send → ASR | network | 20–60 ms | client → provider directly (no app-server hop) |
| 6 | ASR partial inference | provider | 80–200 ms | `no_delay=true`, `interim_results=true` |
| 7 | ASR partial → client | network | 20–60 ms | |
| 8 | Parse + state merge | main thread | ~2 ms | `mergeSegments`, no-op guard skips identical re-emits |
| 9 | Paint | browser | ~16 ms | one frame |
| | **Total (interim caption)** | | **~200–400 ms** | dominated by stage 6 (ASR) |
| +| Finalization (endpointing) | provider | +50 ms | `endpointing=50` commits a final 50 ms after a pause |

**Key facts that keep this tight:**
- **Client connects *directly* to the ASR WebSocket** (`wss://api.deepgram.com/...`); the app server only mints a short-lived token (`/api/token`). Audio never round-trips through our backend — removing an entire server hop (~50–150 ms each way) from the hot path.
- **50 ms frame** is the floor set by the provider's minimum payload (AssemblyAI 50–1000 ms). Smaller frames flood threads and get rejected; larger frames add latency linearly.
- **`no_delay=true` + `endpointing=50`** (Deepgram nova-3): emit partials immediately, commit finals 50 ms after a pause instead of the ~300 ms default.

---

## 2. Component architecture

```
┌────────────────────── BROWSER (hot path, no app-server) ───────────────────────┐
│                                                                                 │
│  getUserMedia / getDisplayMedia                                                 │
│         │  MediaStream                                                          │
│         ▼                                                                       │
│  AudioContext({sampleRate:16000}) ─► AudioWorkletNode 'pcm-processor'           │
│         │                                 │  buffers 50ms, posts {samples, rms} │
│         │                                 ▼                                     │
│         │                          main-thread onmessage                        │
│         │                            ├─ isMuted()? → drop (keep graph alive)     │
│         │                            ├─ floatTo16BitPCM → provider.sendAudio()    │
│         │                            └─ onLevel(rms) → Waveform                  │
│         ▼                                                                        │
│   muted GainNode sink (gain=0) → destination  (pulls graph; no feedback)         │
│                                                                                 │
│   TranscriptionProvider (WebSocket) ◄────────► ASR (Deepgram / AssemblyAI)       │
│         │  onPartial / onFinal                                                   │
│         ▼                                                                        │
│   mergeSegments / mergeRoomSegments (pure, immutable, no-op-guarded)             │
│         ├─► TranscriptView (render, autoscroll-if-near-bottom, break-words)      │
│         ├─► FollowAlong → alignIndex (PURE LOCAL) → ShadowFollow highlight       │
│         └─► [rooms] Ably publish (interim throttled 100ms) → peers               │
└─────────────────────────────────────────────────────────────────────────────┘
         │ (off hot path, async, fail-soft)
         ▼
  /api/token (mint scoped ASR token)   /api/correct (post-final LLM cleanup)
  /api/summarize (on stop)             Ably token (room-scoped auth)
```

**Design rule: two tracks.**
1. **Live track** (stages 1–9) — capture → send → render. No LLM, no DB, no app-server in the loop.
2. **Enrichment track** — correction, summaries, persistence — run **after** a line is on screen, async, fail-soft. Their latency is invisible to the user.

---

## 3. Hot path, stage by stage

### 3.1 Capture — `lib/audio/useMicStream.ts`
- `AudioContext({ sampleRate: 16000 })` requests 16 kHz directly; falls back to device rate and passes the *actual* rate to the ASR, so there's no resample mismatch.
- Mic path: `echoCancellation + noiseSuppression`. System-audio path: raw tracks (no double-AEC).
- **Mute is a flag, not a teardown**: while muted we `return` before sending PCM but keep the graph running → instant unmute (no re-prompt).

### 3.2 Framing — `public/worklet-processor.js`
- Runs on the audio render thread, so captions don't stutter during heavy main-thread React work.
- Buffers `round(sampleRate * 0.05)` = 50 ms, computes RMS in the same pass (free level meter), posts via **transferable** `ArrayBuffer` (zero-copy).

### 3.3 Transport — `lib/transcription/deepgram.ts`
- One client→provider WebSocket. `sendAudio` is a bare `ws.send(chunk)` — no queue, no framing overhead.
- Token minted once at connect (`/api/token`, the only server touch); keyterms attached **once** in the query string (100 cap) — zero per-word cost.

### 3.4 Merge — `lib/transcript/store.ts` / `lib/room/roomStore.ts`
- Pure, immutable. **No-op guard**: identical interim re-emit returns the *same array reference* → React skips the re-render. At ~10 partials/sec this removes most renders.
- IDs derived from `max(id)+1` (no global counter) — pure, restart-safe.

### 3.5 Render — `components/transcript/TranscriptView.tsx`
- Autoscroll only when near the bottom (< 120 px) and **instant** (`scrollTop = scrollHeight`, not smooth), so 10 updates/sec don't stack scroll animations.
- `colorMap` memoized; `break-words` prevents reflow blow-ups on long tokens.

---

## 4. Follow-along: the zero-network highlight

- The **source text is already on the client**. The follower's mic drives an ASR stream, but **positioning** (which word) is `alignIndex(sourceWords, spokenText)`: a **pure local string match**, no network, no model.
- Highlight advances on each **ASR partial** (~200 ms), not on any app-server round-trip.
- Accuracy at speed: the reader's ASR is biased with `sourceKeyterms(source)` (exact words being read, sent once), so a fast engine still positions correctly.
- Band width computed locally (`bandWordCount`, syllable-paced) — also zero cost.
- **Contrast the naive design** (LLM "which word now?" per tick): 500–1500 ms/update, unusable. We never do that.

---

## 5. Rooms: fan-out without coupling latency

- Each participant runs their **own** capture→ASR pipeline; their captions are local-fast, independent of peers.
- Cross-client sync via **Ably**: finals always published; **interims throttled to 100 ms** (`INTERIM_THROTTLE_MS`).
- Colors/slots computed **receiver-side** (`colorMap`) from the sender set — no coordination round-trip to agree on colors.
- Presence (roster, audio source) is a separate channel, so roster churn never delays captions.

---

## 6. Where the desktop app helps (Tauri phase 2)

- The one hot-path stage a native shell can shave is **Capture (3.1)**: browsers need `getDisplayMedia` for system audio (picker + tab-only on macOS). A native **WASAPI/CoreAudio loopback** taps the OS mixer directly — lower capture latency, no picker, full-system on Windows. It feeds PCM into the same stage-4 encoder via an additive, feature-detected bridge (web path unchanged).
- Everything downstream (WS, merge, render, align) is identical, so the desktop app inherits the same budget with a cleaner stage 1.

---

## 7. Failure & degradation (never blocks the live track)

| Failure | Behavior |
|---|---|
| Primary ASR connect fails | `connectWithFallback` tries the next provider; "Engine unavailable" only if all fail |
| Correction API error | `logError`, keep the live (uncorrected) line |
| Summarize fails | transcript still shown/saved; summary omitted |
| DB / not signed in | transcript renders; just not persisted |
| Ably drops | local captions continue; reconnect + re-sync |
| Muted | PCM dropped at boundary; graph stays warm for instant unmute |

---

## 8. Tuning knobs (latency/accuracy trade)

| Knob | File | Effect |
|---|---|---|
| Frame size (50 ms) | `worklet-processor.js` | ↓ = lower latency but risks rejection/thread flood; 50 ms is the floor |
| `endpointing` (50) | `deepgram.ts` | ↓ = faster finals, more mid-phrase splits |
| `no_delay` | `deepgram.ts` | on = partials without smoothing delay |
| Interim throttle (100 ms) | `useRoom.ts` | rooms only; ↑ = less bandwidth, choppier peer view |
| Keyterm count (≤100) | `keytermPacks.ts` | sent once; **no latency effect**, only accuracy/dilution |
| Engine choice | picker | "fastest" (Deepgram) vs "highest accuracy" (AssemblyAI) |

---

## 9. Anti-patterns deliberately avoided

- ❌ Routing audio through our server before the ASR (adds 2 hops).
- ❌ Calling an LLM on the live path (correction is post-final, async).
- ❌ Per-word model calls for follow-along (local alignment instead).
- ❌ Smooth-scroll / per-partial animation (instant scroll; compositor-only motion).
- ❌ Re-rendering on identical interims (no-op guard returns same reference).
- ❌ Re-requesting the mic on mute (flag-gate, keep graph warm).
