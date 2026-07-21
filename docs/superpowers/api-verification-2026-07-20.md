# API Verification & Corrections — LiveTranscript.ai

Date: 2026-07-20. Verified against current vendor docs (AssemblyAI, Deepgram, OpenAI, Clerk, MDN/W3C/caniuse).

---

## 1. AssemblyAI Universal Streaming (v3)

### Confirmed
- Token minting: `GET https://streaming.assemblyai.com/v3/token`, header `Authorization: <API_KEY>` (no `Bearer`). `expires_in_seconds` required (1–600); response has `token`. Note: `expires_in_seconds` is only the WS-redemption window, NOT session length (`max_session_duration_seconds`, 60–10800, default 10800, is the real cap).
- Audio format: raw 16-bit PCM mono LE = `pcm_s16le`, binary WS frames, `sample_rate=16000` (accepts 8000–96000).
- Terminate: client `{"type":"Terminate"}` → server `{type:"Termination", audio_duration_seconds, session_duration_seconds}`.
- Base WS URL `wss://streaming.assemblyai.com/v3/ws`; query params `sample_rate`, `speaker_labels=true`, `token` are correct (regional variants `streaming.us.` / `streaming.eu.`).
- Diarization supported via `speaker_labels=true` (optional `max_speakers` 1–10).
- `keyterms_prompt` max 100 terms (≤50 chars each), on Universal-3.5 Pro streaming.

### Corrections
| Plan said | Current reality | Fix |
|---|---|---|
| Turn has top-level numeric `speaker` | No numeric/top-level `speaker`. With diarization: turn-level `speaker_label` (STRING 'A'/'B'/'UNKNOWN') + per-word `speaker` (STRING, only on `word_is_final` words) | Read `speaker_label` (turn) and/or `words[].speaker` (string). No numeric/top-level speaker key. |
| Turn has `audio_start`/`audio_end` | Those are v2-era. v3 timing is per-word: `words[].start`/`words[].end` in ms. Turn fields: type, turn_order, turn_is_formatted, end_of_turn, transcript, utterance, end_of_turn_confidence, words[], + optional speaker_label/language_code/language_confidence | Use `words[].start`/`.end` (ms). Drop `audio_start`/`audio_end`. Message `type` is `"Turn"` (capitalized). |
| `keyterms_prompt=<jsonArray>` passed as bare array | Must be JSON-stringified then URL-encoded | `keyterms_prompt = encodeURIComponent(JSON.stringify(termsArray))`. Cap 100 terms, ≤50 chars. |
| WS string omits `speech_model` | `speech_model` selects the model; omitting falls back to a default | Add `speech_model=universal-3-5-pro` (or desired model) explicitly. |
| Hardcode model id `u3-rt-pro` | `u3-rt-pro` is a real internal enum, but code samples send `universal-3-5-pro` | Send `speech_model=universal-3-5-pro`. Expect `u3-rt-pro` possibly echoed in Begin's `configuration.model`. |
| Assumes PCM16-only | Opus also accepted: `opus` (one packet/frame), `ogg_opus` (arbitrary chunks); `pcm_mulaw` too. `sample_rate` ignored for Opus | Optional: `encoding=opus`/`ogg_opus`. Default `pcm_s16le` needs no encoding param. |

---

## 2. Deepgram live-streaming STT

### Confirmed
- Grant: `POST https://api.deepgram.com/v1/auth/grant`, header `Authorization: Token <API_KEY>`, body `{"ttl_seconds":300}` (1–3600, default 30). Response `{access_token, expires_in}`.
- WS URL `wss://api.deepgram.com/v1/listen`; `model=nova-3` (current latest); `smart_format`, `punctuate`, `interim_results`, `diarize`, `language=en-US`, `sample_rate=16000`, `channels=1`, `encoding=linear16`, `endpointing=50` (ms), `no_delay=true` all valid.
- Repeated `keyterm=X&keyterm=Y` correct; `keyterm` is the Nova-3 term param (not legacy `keywords`), works on streaming.
- Opus accepted (linear16/mulaw/alaw/opus/ogg-opus). Response path `channel.alternatives[0].transcript`; top-level `is_final`; `words[].speaker` (int, when `diarize=true`); `words[].start`. Close via `{"type":"CloseStream"}` (also `{"type":"Finalize"}` to flush).

### Corrections
| Plan said | Current reality | Fix |
|---|---|---|
| Pass JWT via subprotocol `["token", access_token]` | `token` subprotocol pairs with a RAW API key. A minted JWT uses the Bearer scheme → subprotocol keyword is `bearer` | Use `new WebSocket(url, ["bearer", access_token])` for the JWT. Reserve `["token", <API_KEY>]` for raw-key case. (Or JS SDK v5 `DeepgramClient({ accessToken })`.) |
| Per-word `words[].duration` | Word objects have `start` and `end` (+ word, confidence, punctuated_word, speaker) — no per-word `duration`. `duration` is message-level only | Use `words[].start`/`.end`; compute duration as `end - start`. Message timing = top-level `result.start`/`result.duration`. |
| `keyterm` (implicitly always) | Correct, but model-gated: `keyterm` only works on Nova-3/Flux. If model downgrades to nova-2/older it's ignored → must use `keywords` (KEYWORD:INTENSIFIER syntax) | No change while pinned to `model=nova-3`. Swap `keyterm`→`keywords` only if downgraded. |

---

## 3. OpenAI transcription / Realtime / structured output

### Confirmed
- Model IDs live now: `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize`, `whisper-1`. `gpt-4o-transcribe-diarize` is batch/file-only (`/v1/audio/transcriptions`, NOT Realtime) — matches Approach-C.
- `client.audio.transcriptions.create({ model, file, prompt, response_format })` is the correct signature; `prompt` accepted for biasing.
- `chat.completions.create` with `response_format:{type:'json_object'}` on `gpt-4o-mini` still supported (JSON mode). System prompts correctly contain the word "JSON".
- Realtime supports WebRTC (browser/mobile) + WebSocket (server). Server-minted ephemeral tokens: `POST /v1/realtime/client_secrets`, `POST /v1/realtime/transcription_sessions`.

### Corrections
| Plan said | Current reality | Fix |
|---|---|---|
| Keyterm/prompt biasing applied on the `gpt-4o-transcribe-diarize` accuracy pass | Diarize model does NOT accept `prompt` (nor logprobs / timestamp_granularities). Requires `chunking_strategy` for >30s audio and `response_format:'diarized_json'` for speaker segments | On diarize pass: NO `prompt`; set `response_format:'diarized_json'`, `chunking_strategy:'auto'`. For prompt biasing use `gpt-4o-transcribe` (no diarization). Task 9b's v2 note (re-transcribe per-utterance with `gpt-4o-transcribe`) is fine. |
| Tasks 9/9b use `json_object` + manual `JSON.parse`/`Array.isArray` guards | Works, but Structured Outputs (`type:'json_schema'`, `strict:true`) is now recommended and guarantees schema adherence (gpt-4o-mini, gpt-4o-2024-08-06+) | Optional: switch summarize/correct routes to `json_schema` strict to drop manual guards. `json_object` not broken. |
| (v2) generic "OpenAI ephemeral realtime key"; no realtime model id hardcoded | For v2: GA speech-to-speech is `gpt-realtime` (supersedes `gpt-4o-realtime-preview`); live-transcription model is `gpt-realtime-whisper`. Diarization NOT supported on Realtime | v2: mint via `POST /v1/realtime/client_secrets` (old `/v1/realtime/sessions` superseded), use `gpt-realtime-whisper` for live, no diarization on realtime (batch diarize only). |

---

## 4. Clerk + Next.js App Router (Clerk Core 3 / clerk init)

### Confirmed
- `clerk init` works on existing Next.js projects (auto-detects framework/pkg manager, installs SDK, applies setup); `--app <application_id>` links a specific app.
- Middleware: `proxy.ts` on Next 16+, `middleware.ts` on ≤15 (identical contents); `clerkMiddleware()` from `@clerk/nextjs/server`.
- Matcher ordering: frontend-API entry AFTER `/(api|trpc)(.*)`. `<ClerkProvider>` INSIDE `<body>`. `await auth()` async.
- `<Show when="signed-in">`/`<Show when="signed-out">` IS the current Core 3 API (replaced `<SignedIn>`/`<SignedOut>`) — NOT wrong. `SignInButton`/`SignUpButton`/`UserButton` from `@clerk/nextjs`.

### Corrections
| Plan said | Current reality | Fix |
|---|---|---|
| Matcher entry `"/__clerk/:path*"` | All current docs use regex-style `'/__clerk/(.*)'`, not the named-param `:path*` | Use `'/__clerk/(.*)'` after `'/(api|trpc)(.*)'`. Full array: `['/((?!_next\|[^?]*\.(?:html?\|css\|js(?!on)\|jpe?g\|webp\|png\|gif\|svg\|ttf\|woff2?\|ico\|csv\|docx?\|xlsx?\|zip\|webmanifest)).*)', '/(api\|trpc)(.*)', '/__clerk/(.*)']` |

---

## 5. Browser Web Audio → 16kHz PCM streaming

### Confirmed
- `process()` runs per 128 sample-frame block, but value may change — worklet correctly reads `ch.length`.
- `new AudioContext({sampleRate:16000})` reliably supported (Safari 14.1+/iOS 14.5+, Chrome 74+, Firefox 61+); 16000 in 8000–96000 range.
- Let the context resample the 48kHz mic → 16kHz (all AudioNodes run at context rate); do NOT hand-roll resampling. Worklet receives true 16kHz Float32.
- `linear16`/`pcm_s16le` @ matching sample_rate accepted by both providers. Both also accept Opus (container caveat below). `AudioWorklet` over deprecated `createScriptProcessor` is correct.

### Corrections
| Plan said | Current reality | Fix |
|---|---|---|
| Worklet posts `inputs[0][0]` every `process()` call (~128 frames / 8ms) | Real bug: 8ms is BELOW AssemblyAI's 50–1000ms/payload requirement; ~125 postMessages+sends/sec. Deepgram prefers ~100–250ms | Buffer ~50ms (800 frames @16k) in the worklet, then post once; flush off `channel.length`; use a transferable. |
| `connectWithFallback({ sampleRate: 16000, ... })` hardcoded | Latent bug: number sent to provider must equal actual PCM rate. If 16k context isn't honored → pitch-shifted/garbled transcription | Derive `const actualSampleRate = ctx.sampleRate` and pass that. Both accept 8000–96000 so reporting true rate (even 48000) is safe. |
| `new AudioContext({ sampleRate: 16000 })` with no error handling | Constructor throws `NotSupportedError` on some hardware/engines → unhandled, mic capture dies | `let ctx; try { ctx = new AudioContext({ sampleRate: 16000 }) } catch { ctx = new AudioContext() }` then report `ctx.sampleRate`. |
| `getUserMedia({ audio: { ..., sampleRate: 16000 } })` forces 16k | The gUM sampleRate constraint is advisory, commonly ignored; may perturb echo-cancellation DSP. Downsampling is done by the AudioContext | Drop the gUM `sampleRate` constraint; rely on the 16k AudioContext. Keep `echoCancellation`/`noiseSuppression`. |
| Spec 3a: live track is "mic → Opus (24kbps) → provider" but worklet sends linear16 | Spec/plan inconsistency. MediaRecorder emits `webm/opus` — Deepgram accepts webm/opus (encoding omitted) but AssemblyAI needs raw `opus`/`ogg_opus` (NOT webm); Safari MediaRecorder Opus is shaky; blobs don't split on 50ms | v1: keep linear16 PCM@16k (portable, implemented); correct spec 3a wording. If Opus later: per-provider (Deepgram webm/opus omit encoding; AssemblyAI `ogg_opus`). |

---

## Highest-risk fixes to apply before coding (ranked by impact)

1. **Worklet chunk cadence (§5)** — posting every ~8ms is below AssemblyAI's hard 50ms floor and produces inconsistent Turn messages; floods both threads. Buffer to ~50ms (800 frames). Highest impact: breaks live transcription on AssemblyAI.
2. **AssemblyAI Turn schema (§1)** — no numeric/top-level `speaker`, no `audio_start`/`audio_end`. Read `speaker_label` (string) + `words[].speaker` + `words[].start/.end` (ms). Wrong keys = no diarization/timestamps.
3. **Deepgram JWT subprotocol (§2)** — use `["bearer", jwt]`, not `["token", jwt]`. Wrong keyword = auth failure on the minted-token path.
4. **OpenAI diarize pass has no `prompt` (§3)** — drop `prompt`, set `response_format:'diarized_json'` + `chunking_strategy:'auto'`. Passing prompt errors on the diarize model; app theme is keyterm prompting.
5. **Provider sample_rate must derive from `ctx.sampleRate` (§5)** — hardcoded 16000 garbles audio if context resolves otherwise. Also add try/catch fallback for `NotSupportedError`.
6. **AssemblyAI query params (§1)** — `keyterms_prompt` must be `encodeURIComponent(JSON.stringify([...]))`; add `speech_model=universal-3-5-pro` explicitly.
7. **Clerk matcher syntax (§4)** — `'/__clerk/(.*)'`, not `'/__clerk/:path*'`. Low impact but trivial.
8. **Deepgram per-word timing (§2)** — read `words[].end` (not `.duration`).
9. **Spec 3a Opus wording (§5)** — correct to reflect the implemented linear16 PCM path (doc-only).
