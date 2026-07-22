# LiveTranscript — The Lowest-Latency Build

> Companion to `low-latency-design.md` (which documents the *current* pipeline).
> This is the forward plan: how to reach the lowest achievable latency, phased.
> Every claim below was verified against the actual code.

## 1. Where the time actually goes (p50, us-east, steady state)

Perceived latency = **mouth → pixels**. Today's partial path:

```
speak → worklet buffers 50ms → main-thread encode/copy → ws.send
  → network to api.deepgram.com → nova-3 inference + endpointing(50ms)
  → interim frame back over network → mergeSegments → React render
```

| Stage | Cost | Owner |
|---|---|---|
| Capture buffering (50 ms frame, avg = frame/2) | ~25 ms | **us** |
| Encode + redundant `.slice()` copy | <2 ms | **us** |
| Network browser→Deepgram RTT | 30–120 ms (us-east ~30, EU ~90, APAC ~150+) | **network** |
| nova-3 inference + `endpointing=50` | 80–150 ms | **ASR cloud** |
| Interim frame back | half of RTT | **network** |
| merge + full-transcript render | <2 ms (grows w/ length) | **us** |

**p50 ≈ 200–400 ms, dominated by two terms we don't control: network RTT + cloud inference.** Everything the client owns totals ~30 ms.

**Theoretical floor:** you can't beat ~frame/2 of capture buffering + inference. Remove the network and the desktop floor drops to **~80–150 ms** (50 ms buffer + on-device inference), at **zero per-minute cost**. That's the only lever that moves p50 by an order of magnitude; everything else is ms-shaving.

## 2. Core decision: **remove the network, don't optimize it**

Tier-1 (instant partial) runs **on-device**; the cloud becomes an **async tier-2 correction on finals only**. Why this is the right call — and cheap to reach:

1. **The two-track machinery already exists.** `record/page.tsx` fires `correctLine` per final; `applyCorrection(id, text)` swaps a finalized line in place, fail-soft. Making the cloud a tier-2 corrector is *re-wiring, not re-architecting*.
2. **Optimizing the cloud path has a floor you can't cross** — setup/RTT wins are real and free but can't zero out RTT or cloud inference.
3. **On-device zeroes the two dominant terms at once** — network RTT *and* the ~90%-of-spend per-minute bill (cloud runs only on finals).
4. **Accuracy objection is answered by the same async track** — partials are ephemeral; instant on-device text *sharpens* 0.5–2 s later when tier-2 lands, exactly like today's LLM correction swap. Instant + eventually-accurate beats slow + accurate for live captions.

Still do the cloud-path optimizations (Phase A) — they're free, help every user now, and remain the fallback/accuracy tier and the mobile default.

## 3. Phased plan

### Phase A — quick wins, days, no architecture change

| # | Item | Latency delta | Touches web app |
|---|---|---|---|
| A1 | **Pre-mint `/api/token` on Start `pointerdown`, parallel with `getUserMedia`** (token TTL is already 300 s). Cache `{token,expiresAt}`; keep mint-on-Start fallback. | −110 ms (us-east) to −210 ms+ (EU/APAC) off click→first-caption | yes |
| A2 | **`React.memo(TranscriptView)`** — `setLevel` fires ~20×/s and re-maps the whole transcript, but `level` is only read by `Waveform` via a ref. | Kills ~20 full-list reconciliations/s; big jank win on long/Windows sessions | yes |
| A3 | **`<link rel="preconnect" href="https://api.deepgram.com" crossorigin>`** (+ AssemblyAI host) in the record page head. | −40–100 ms (us-east) to −120–200 ms (EU) off WS open | yes |
| A4 | **Fold int16 encode into the worklet's existing RMS loop; drop the `.slice()`** (`pcm.ts` already returns a fresh exact-length array — the slice is pure waste). | <2 ms but moves work off the main thread + deletes an alloc/frame | yes |
| A5 | **Regional endpoint** — Deepgram EU is GA (`wss://api.eu.deepgram.com/v1/listen`, same token); AssemblyAI already edge-routes. Pick by coarse geo. | EU user: −150–225 ms setup **and** −75–150 ms off *every* interim | yes |
| A6 | **20 ms capture frame on the Deepgram path only** (`no_delay=true` already set; AssemblyAI requires 50–1000 ms, so gate it). | −15 ms avg / −30 ms worst-case — the only true audio-path shave | yes |

**Net:** −250–400 ms off click→first-caption for far users, ~−15 ms steady-state, smoother long sessions, same accuracy, ~zero new deps.

**Do NOT (Phase A):** rAF-coalesce or `startTransition` on live partials (no headroom at ~10–20 partials/s; deferring the live text *worsens* perceived latency). Skip WebTransport (both providers are WSS-only → a self-run relay adds a hop + routes raw audio through your infra against an ASR-cost-dominated budget). Skip edge token-mint (A1 hides it).

### Phase B — two-tier on-device (browser), weeks

**Moonshine Base (ONNX) via transformers.js, WebGPU + WASM fallback** as an on-device tier-1 provider; nova-3 becomes async tier-2 on finals. Moonshine over Whisper because it's *natively streaming/variable-length* (no 30 s mel window, no sliding-window re-compute → Whisper-web adds ~500 ms–2 s first-token jitter).

Maps ~1:1 onto existing interfaces:
- **B1. `OnDeviceProvider implements TranscriptionProvider`** — consumes the same 50 ms chunks (float directly, **skip `floatTo16BitPCM`**), buffers to ~300–500 ms windows, `pipeline('automatic-speech-recognition','onnx-community/moonshine-base-ONNX',{device:'webgpu',dtype:'q8'})`, `onPartial` per window, `onFinal` on VAD pause. Register in `DEFAULT_MAKERS`/`ProviderChoice`; expose as an **"Instant / offline"** engine option.
- **B2. Tier-2 on finals** — keep the instant on-device line, then async-correct. **Option A (recommended):** re-ASR the finalized audio buffer via nova-3 → `applyCorrection(id, betterText)` (recovers genuinely misheard words + keyterms). **Option B:** route text through the existing `/api/correct` (cheaper; fixes homophones/punctuation only). Both fail-soft, both reuse `applyCorrection` verbatim.

| Item | Latency | Cost/accuracy |
|---|---|---|
| B1 on-device (Base, WebGPU) | partial floor **~80–150 ms** desktop (network-independent), WASM fallback ~200–400 ms | one-time ~60–80 MB (q8, IndexedDB-cached); **zero per-minute** for tier-1; battery drain; Whisper-base-class WER (below nova-3) |
| B2 correction (Option A) | **zero** perceived (async) | only *finals* hit the cloud → the ~90% minutes win; recovers most of nova-3's edge |

**Guardrails:** opt-in third engine, WebGPU-gated + WASM fallback, **cloud-only on mobile** (iOS Safari WebGPU is recent + thermally throttles). Instrument a real mouth→pixels p50 + WER before making it default.

### Phase C — native desktop, bundled model (Windows endgame)

Kills per-minute cost *and* WS RTT, works offline.

**Blocker first:** `src-tauri/tauri.conf.json` uses `frontendDist: "https://livetranscript.ai"` (remote origin) → `invoke` can't reach Rust. Enable remote-domain IPC access, or bundle the frontend for the desktop build, **before any engine work.**

**Engine: sherpa-onnx streaming Zipformer transducer (int8) via official Rust bindings** — the only option that's genuinely streaming, real-time on plain CPU (RTF ~0.077, no NVIDIA), ships prebuilt Win/Mac/Linux binaries + a streaming-mic example, ~70 MB int8.

**Lowest-churn wiring:** keep the AudioWorklet 50 ms capture (already handles mic + `getDisplayMedia` + instant mute); replace the WS sink with `invoke('stt_push_pcm', {samples})` into a persistent Rust `OnlineRecognizer` that `emit`s `transcript` events; a new `LocalProvider` satisfies `onPartial`/`onFinal` → `store.ts`, `TranscriptView`, `shadowAlign` untouched.

| Item | Latency | Cost/accuracy |
|---|---|---|
| C1 sherpa-onnx Zipformer int8 (primary) | ~150–350 ms p50 interim; deletes WS RTT; real-time on any modern CPU | removes ~90% ASR spend on local path; +~70 MB/language; ~4–5% clean / ~10–11% other WER (below nova-3); **no built-in diarization** (app uses Deepgram `diarize=true`) |
| C2 (later) Moonshine base via `ort` crate | ~107 ms | tiny bundle, but you own the encoder/decoder/KV-cache loop + Silero VAD — real work; ~6.65% WER (beats Whisper-large) |

Keep Deepgram/AssemblyAI as opt-in **"high accuracy"** mode via `connectWithFallback`; on-device is the free/offline default.

**Do NOT (Phase C):** offline Parakeet TDT (not streaming), NeMo cache-aware-in-ONNX (hand-rolled cache/decode in Rust; research-grade), whisper.cpp for the interim path (sliding-window flicker), Vosk as default (weakest WER, no keyterm equivalent).

## 4. Honest tradeoffs (small team)

- **Phase A** — pure win. No accuracy cost, ~zero $, ~zero ops. Only real tradeoff: A6's provider-conditional frame size.
- **Phase B** — big latency + cost win, at a ~60–80 MB one-time download, battery drain, and a worse *partial* accuracy floor that only tier-2 hides. **Mobile is the weak spot — don't default it there.**
- **Phase C** — biggest cost/latency win + offline, but native Rust work, the IPC blocker, per-language bundled model, and **you lose diarization**. Highest ops.

**The honest catch across B & C:** on-device is Whisper-base/Zipformer class — behind nova-3 on exactly the hard/jargon audio the keyterm feature targets. The two-tier design makes this acceptable *only if tier-2 correction lands fast and reliably*.

## 5. Recommended sequence — start Monday

**Week 1 (Phase A, ship each as it lands):** A1+A3 together → A2 → A4 → A5 → A6 (optional). **Then instrument a real mouth→pixels p50** before Phase B.

**Weeks 2–4 (Phase B):** `OnDeviceProvider` (Moonshine Base, WebGPU + WASM fallback), opt-in "Instant / offline", tier-2 nova-3 re-ASR on finals via `applyCorrection`, cloud-only on mobile. Measure latency + WER before defaulting.

**Later (Phase C):** clear the `frontendDist` IPC blocker → sherpa-onnx Zipformer behind `LocalProvider`, cloud kept as opt-in accuracy mode.

The async-correction track and the `TranscriptionProvider` interface already in the codebase mean **every phase is re-wiring, not re-architecting.**

**Files:** `lib/transcription/{types,index,deepgram,assemblyai}.ts`, `lib/audio/{useMicStream,pcm}.ts`, `public/worklet-processor.js`, `app/(app)/record/page.tsx`, `lib/transcript/store.ts`, `components/transcript/TranscriptView.tsx`, `app/api/token/route.ts`, `src-tauri/tauri.conf.json`.
