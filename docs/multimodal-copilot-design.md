# LiveTranscript Copilot — Multimodal "Cluely-style" Side Panel

**Status:** Design, pre-build · **Owner:** Principal Eng · **Reviewer:** Founder
**Decisions locked:** hybrid (on-demand default + opt-in proactive) · grounding = transcript + web/docs RAG (phased) · multiple models/processes · must see the screen · **HIGH ACCURACY + LOW LATENCY are the hard priorities**

---

## 1. What we're building

A side panel in the LiveTranscript recorder that answers questions from the **live transcript** and, when the question needs it, from a **frame of the user's screen** — grounded, cited, and streamed token-by-token. It defaults to **on-demand chat** (user asks, copilot answers) with an **opt-in proactive** mode that surfaces suggestion cards during silences. This is the same product surface Cluely popularized (overlay that sees + hears a meeting and answers in real time), and the same shape as the OSS "open Cluely" family — `pickle-com/glass`, `sohzm/cheating-daddy`, `Blueturboguy07/cue`. We differ in one structural way: instead of one live multimodal socket doing everything (cheating-daddy's approach), we run a **multi-model router** where a cheap classifier gates each turn and specialists (vision / retrieval / answer) run in parallel, with vision kept **off the text critical path** via an async description cache. Crucially, LiveTranscript already has ~90% of the plumbing (Deepgram-first ASR over a direct WebSocket, a two-track "fast captions + async enrichment" pattern, `getDisplayMedia` already open, a Tauri shell) — so the copilot is an **additive layer**, not a rewrite.

---

## 2. Best OSS repo to learn from

**Primary architectural reference: `pickle-com/glass`** (7,559 stars, **GPL-3.0**, Electron + Lit + Next.js dashboard). It is the single best fit because it already embodies every decision LiveTranscript has made: Deepgram-first STT over a raw provider WebSocket (identical to our `connectWithFallback`), a clean multi-provider **factory** (`common/ai/factory.js` — the "multiple models/processes" the founder wants), a two-track split of fast STT vs async LLM enrichment (identical to our live captions + `/api/summarize`), and an **interval-gated proactive analyzer** (`summaryService.triggerAnalysisIfNeeded()`, fires every 5 turns) — plus it solves our two gaps: seeing the screen and staying invisible.

**What to PORT (patterns, re-implemented — not files):**
- **Long-session STT survival constants** from `sttService.js`: 2s completion debounce (coalesce interims into finals), 60s keep-alive heartbeat, 20-min proactive session renewal (dodge the ~30-min provider hard cap), 2s dual-socket overlap so no packets drop on renewal. Our long recordings will hit these exact walls.
- **Dual mic/system-audio STT sessions** → free "Me"/"Them" speaker labels with no diarization.
- **Provider factory shape** (`createLLM` / `createStreamingLLM` / `createSTT` registry) — mirrors our `DEFAULT_MAKERS` maker-registry so a slow/failed LLM falls back the same way ASR already does.
- **On-demand screenshot at 384px height / JPEG quality 80** (`askService.captureScreenshot()`) — the proven token-cheap frame size.
- **Multimodal-error → text-only retry**, **`_processStream` reader + `AbortController`** (new turn aborts prior stream), **history `.slice(-30)`**, and the **`%5` proactive debounce with `previousAnalysisResult` fed back** as the dedup mechanism.

**Secondary references:**
- **`sohzm/cheating-daddy`** (5,528★, GPL-3.0) — the **lowest-latency screen+audio path**: one bidirectional Gemini Live socket carrying audio-in + transcription + answer. Borrow the **5s screenshot cadence + JPEG quality tiers (0.5/0.7/0.9)** and **reconnect-with-context-replay (max 3, 2s, replay last 20 turns)**. Keep as a possible high-speed *alternate provider*, not the core.
- **`JWM0203/MeetingCopilot`** (132★, **Apache-2.0**) — the best **latency-engineering** ideas on a permissive license: **LLM prefix-cache prewarm** (fire a 1-token request on session start to pre-build the provider KV cache so the first real answer prefills from cache) and a **rolling memo** that keeps 60-min sessions consistent at flat per-request token cost.
- **`Blueturboguy07/cue`** (763★, **MIT**) — near-exact product blueprint in liftable plain JS: `src/llm.js` (one `streamOpenAI` with `onToken`), `src/prompts.js` MODES where each mode declares `needsScreen` + a small-model flag (this *is* the vision-gate + router), and the fast/smart toggle.

**License reality (hard rule):** Glass, cheating-daddy, and pluely are **GPL-3.0**; interview-coder variants are **AGPL-3.0** — viral, hostile to a hosted SaaS. **Study and re-implement their patterns; do NOT copy source into LiveTranscript.** If we need copy-paste-legal starting code, lift only from **cue (MIT)**, **MeetingCopilot (Apache-2.0)**, **free-cluely (Apache-2.0)**, or **meetily (MIT)**.

---

## 3. Architecture — multi-model router + processes

**Capability tiers (name tiers, not vendors — SKUs churn):**
- **Tier-R (Router/classifier):** cheapest fastest model, TTFT ~0.65s. Returns `{needsScreen, needsWeb, complexity, answerable}`.
- **Tier-A (Cheap answer/OCR-vision):** default answer + ambient screen reads. TTFT ~0.7–1.1s. "What's on screen / read this dialog."
- **Tier-B (Balanced reasoning):** on-demand escalation ("Smart" toggle) + reasoning-over-UI. TTFT ~0.9–1.5s.
- **Tier-C (Flagship / high-res vision):** explicit "look closely at this diagram" only. TTFT 1.5–3s+. Never on the ambient loop.

```
CLIENT (record page)                         SERVER (Next.js route handlers, all fail-soft)
─────────────────────                        ───────────────────────────────────────────────
audio ─► provider WS ─► segments[]  ─┐
(unchanged, connectWithFallback)     │
                                     ├─► transcript tail (transcriptText(finals.slice(-K)))
screen ─► useScreenStream ─► frame   │
  (getDisplayMedia video track,      │
   worker: throttle→MAD diff→        │
   downscale→JPEG q0.6)              │
                                     ▼
user question / proactive trigger ─► POST /api/copilot/route  (Tier-R)
                                        heuristic-first (regex); model only if ambiguous
                                        └─► {needsScreen, needsWeb, complexity, answerable}
                                     │
                        ┌────────────┼─────────────────────────┐   PARALLEL (Promise.all)
                        ▼            ▼                          ▼
             /api/copilot/vision   retrieval (web/docs RAG   [answer awaits only what
             (Tier-A, ASYNC-        — phased)                 router requested]
              CACHED screenDesc)
                        │            │                          │
                        └──── context assembly (token budget, trim oldest-first,
                              every slice sanitized like sanitizeKeyterms) ─────┐
                                                                                ▼
                                        POST /api/copilot/answer (STREAMED, Tier-A default / Tier-B on complexity)
                                         └─► ReadableStream Response ─► client res.body.getReader() ─► side panel
                                             (AbortController: new turn aborts prior stream)
```

**Parallel vs async-cached — the core latency trick:**
- **Parallel per turn:** router → then retrieval + answer prompt-assembly run concurrently.
- **Vision is async-cached, NOT on the critical path.** A Tier-A vision call turns the latest frame into a short text `screenDescription` cached client-side with a timestamp (Glass's `lastScreenshot`). Answers read the *cached description*. A **fresh synchronous** vision call happens **only** when the turn is explicitly about the screen **and** the cache is stale (>~5s); otherwise the frame refresh runs in the background exactly like our existing fire-and-forget `correctLine`.
- **Speculative:** for proactive mode, start drafting on an interim question-shaped utterance (~300ms head start), cancel if the final says otherwise. Do **not** race two full answer models — race model-vs-heuristic only.

**Accuracy levers baked into the router:** retrieved snippets carry `[n]` ids; the answer prompt requires inline `[n]` citations; a cheap post-check validates each cited id exists before render (drop hallucinated cites). An optional **verification pass** (a second cheap LLM-judge) runs **only** on `complexity: reasoning` turns so simple turns stay fast.

---

## 4. How it reuses LiveTranscript's existing pieces

Everything below is **verified in the repo** — the copilot is additive.

| Existing piece | File (verified) | How the copilot reuses it |
|---|---|---|
| **ASR / direct-WS + fallback ladder** | `lib/transcription/index.ts` (`connectWithFallback`, `DEFAULT_MAKERS`, `ProviderMaker`, L2–16) | Unchanged. The `ProviderMaker` registry shape is copied for the **LLM provider layer** so a slow/failed answer model falls back the same way ASR does. |
| **Live wiring + async-enrichment hook** | `app/(app)/record/page.tsx` (`connectWithFallback` L95, `provider.onFinal(...)` L104, `correctLine` fire-and-forget L109) | Proactive-mode trigger hangs off the **existing `onFinal` callback**. The copilot is a *third* async track alongside `correctLine`. |
| **Two-track server pattern (auth+caps+fail-soft+sanitize)** | `app/api/correct/route.ts` (`currentUserId` L26, `sanitizeKeyterms` L12, input caps `MAX_TEXT`/`.slice` L35/L53, `logError` L64, `response_format` L56) and `app/api/summarize/route.ts` (`currentUserId` L8, `.slice(0,100_000)` L33, `logError` L45) | **Template for every new copilot route.** Clone verbatim: `currentUserId()` guard (blocks anon quota drain), input caps, fail-soft try/catch, `logError`. `sanitizeKeyterms` (L12–18) is the prompt-injection defense — transcript/screen/RAG slices are all untrusted and get the same treatment. |
| **`getDisplayMedia` (video track already opened!)** | `lib/audio/useMicStream.ts` (`getDisplayMedia({audio,video})` L37, `getVideoTracks().forEach(t=>t.stop())` L38) | Today we **throw the video track away**. The copilot keeps it. Screen-vision is a small addition, not a new capability. New hook `lib/vision/useScreenStream.ts` forks this logic. |
| **Transcript state + helpers** | `lib/transcript/store.ts` (`Segment` L7, `mergeSegments` L21 dedupes trailing interims, `transcriptText` L71 finals-only "Speaker N:", `splitSentences` L65) | Rolling context is just `transcriptText(finals.slice(-K))`. Transcript is **already in client `segments[]`** → ~0ms to assemble context, no fetch. |
| **Two-track split** | live captions + `/api/summarize` | Copilot answer + proactive cards are the generalization of this exact split. |
| **Tauri shell** | `src-tauri/src/lib.rs` (comment L13–14: "register a `#[tauri::command]` here and feed PCM to the web layer via an additive, feature-detected bridge") | The native screen-capture upgrade follows the **exact bridge pattern the code already sketches** for audio (Phase 2/3). |

**New this app:** streaming. Both existing routes return one JSON blob. `/api/copilot/answer` is the **first token-streaming route** — return `new Response(readableStream)` (Next 16 App Router, native, no SSE lib); client reads `res.body.getReader()`. **Stream plain markdown, not `json_object`** (JSON mode fights streaming — keep it only for the structured summarize track).

---

## 5. Screen capture design

**Web path (v1, reuses `getDisplayMedia`):**
1. `lib/vision/useScreenStream.ts` — fork `useMicStream.ts:37` but **keep the video track**. Same user gesture, same OS picker, same MediaStream teardown in `stop()`.
2. Attach track to an offscreen `<video>`; draw to an **`OffscreenCanvas` in a Web Worker** (keeps draw/diff/encode off the main thread so live captions never stutter — same worker pattern the ASR worklet already uses). Throttle to a timestamp-gated **2–4s** tick; never per-frame (30fps = 30 useless near-identical frames/sec).
3. **Perceptual-diff gate (THE cost lever):** downscale each frame to a **64×64 luma thumbnail**, compute mean-absolute-difference vs the previous thumbnail; if MAD < ~2–3% of 255, screen is "unchanged" → **skip upload entirely**. Two `Uint8ClampedArray`s and one loop, microseconds. This kills 90%+ of frames on a static screen — a mostly-static screen sends **~5–20 vision calls/hour instead of 900+**. `pixelmatch` (ISC, mapbox) only if false-positives (cursor blink, ads, antialiasing) actually appear.
4. **On change (or on an explicit screen question):** downscale to **~768px long edge** (Glass uses 384px height), `convertToBlob({type:'image/jpeg', quality:0.6})`, base64. Sending a 4K screenshot wastes tokens for zero accuracy gain at these tiers.

**Tauri native upgrade (Phase 3):** `#[tauri::command] fn capture_frame() -> Vec<u8>`, feature-detected on the JS side (`if (window.__TAURI__) useNativeCapture else useScreenStream`) — the additive bridge `lib.rs:13-14` already describes. Rust crate: **`scap`** (MIT/Apache, ScreenCaptureKit/DXGI continuous streams — better than one-shot for a throttled loop) or **`xcap`** (Apache-2.0). No picker, no per-frame browser overhead, silent full-screen. macOS needs the Screen Recording entitlement (TCC prompt on first use).

**Privacy guardrails (MUST-HAVE — frames may contain passwords/PII):**
1. **Opt-in, off by default.** Screen-see is a separate explicit toggle from transcription; `getDisplayMedia` already forces a gesture + picker — never auto-start.
2. **Visible persistent indicator whenever capturing.** Browser shows its sharing bar; we add our own in-app recording dot too. **Native Tauri capture has NO OS indicator — a self-rendered indicator + global stop hotkey are mandatory there.**
3. **Throttle + diff are privacy controls, not just cost** — fewer frames leaving the device = smaller exposure. Cap max frames/min even on a constantly-changing screen.
4. **On-device redaction before upload:** downscaling to 768px already destroys most password legibility; add a client-side `tesseract.js` (Apache-2.0, WASM) pass on the thumbnail, regex for card numbers (Luhn), SSNs, emails, `sk-`/`ghp_` token shapes, paint black boxes on the canvas **before encoding**. Support user-defined static exclusion zones; auto-pause on focused `<input type=password>`.
5. **Never persist raw frames server-side.** Process in-memory, return derived text, drop the image. `logError` already logs context not payloads — keep it that way. Strip EXIF (canvas re-encode does this), route through our app server (mints tokens, enforces rate limit + audit per `currentUserId()`), never client-direct.

---

## 6. Accuracy plan

Ranked highest-leverage first; every technique cites where it comes from.

1. **Ground everything in transcript + screen, refuse when absent.** System prompt: "answer only from the conversation/screen below; quote the exact line you used." Give an explicit escape hatch — `{grounded:false, reason:"not in transcript"}` renders "Not enough context" rather than a confident guess. cue's prompts are *not* grounded and will confabulate — this is the fix we add on port.
2. **Cheap answerability pre-check (Tier-R).** A one-token-ish "is this answerable from context? yes/no" (TTFT ~0.65s) is a strong, fast refuse-gate that *also* decides whether to escalate to RAG/web.
3. **Citations with pre-render validation (RAG phase).** Retrieved chunks carry `[n]` ids; require inline `[n]`; **drop any answer whose cited chunk doesn't exist** before render.
4. **Reasoning-only verification pass.** A second cheap LLM-judge checks the draft for unsupported claims — **only** on `complexity:reasoning` turns (skip on simple turns to protect latency).
5. **Escalate to Tier-B/C on demand** (the "Smart" toggle, cue's pattern) — strong model synthesizes only *after* grounding is assembled.
6. **Rolling memo** (MeetingCopilot) keeps 60-min sessions self-consistent at flat per-request token cost.
7. **`temperature` 0–0.3** for factual answers; **`sanitizeKeyterms`-style** scrubbing of every untrusted slice (a live meeting can literally say "ignore previous instructions").
8. **Speaker labels for free** via dual mic/system STT (Glass) so answers attribute correctly.

**Accuracy budget:** simple transcript turn = grounded + refuse-gate. High-accuracy turn additionally pays for fresh vision + retrieval + verification — but only because the router set the flags, so cheap turns never pay for it.

## 7. Latency plan

The three moves that dominate perceived latency, in order (OpenAI's own guidance + Artificial Analysis medians; add ~50–150ms client RTT):

1. **Stream tokens** — "the single most effective approach." First visible token drops from full-generation (2–4s) to ~TTFT (0.7–1.2s). `stream:true` → `ReadableStream` Response (cue's `_processStream`/`streamOpenAI` shape).
2. **Fast model by default, escalate on demand** — Tier-A default (TTFT ~0.9s); Tier-B/C only when the router says `reasoning`. (cue's fast/smart toggle.)
3. **Gate vision** — the single biggest latency + token tax; a downscaled frame is ~700–1100 input tokens and pushes TTFT ~0.5–1.5s higher. Attach a frame **only** when the classifier detects deictic words ("this/that/here/on screen/this error"). Default chat = transcript-only, no frame. Reuse the existing `getDisplayMedia` stream — never spin up a second capture; grab via `canvas.drawImage → toBlob(jpeg,0.6)` (~50–200ms), event-gated only, never per-timer on the answer path.

Secondary (add after the top 3):
4. **Prefix-stable prompt caching** — order the prompt `[fixed system][rolling transcript history][NEW QUESTION LAST]`. Provider caches prompts ≥1024 tokens on exact-prefix match; the transcript prefix stays byte-identical between follow-ups, so each re-uses the cached prefill. **Never prepend timestamps/nonces** — one changed early token busts the whole prefix. (Trimming input buys only 1–5% latency, so caching > trimming for latency.)
5. **Prefix-cache prewarm** (MeetingCopilot) — fire a 1-token request on session start so the first real answer prefills from cache.
6. **Async-cached vision** (§3) — vision never blocks the text answer.
7. **Speculative drafting** on interim utterances for proactive mode (~300ms head start).

**Latency budget (first-visible-token / full ~60-token answer):**
| Path | First token | Full answer |
|---|---|---|
| On-demand text (transcript only) | **~0.7–1.2s** (~0.9s if we skip router→mini) | ~1.5–2.3s |
| Screen-aware (frame grab 0.05–0.2s parallel + vision prefill) | **~1.6–2.6s** | ~2.5–3.5s |
| Proactive (opt-in, non-blocking): utterance-end → Tier-R gate 0.65s → Tier-A draft | surfaced **~2–4s** after the triggering line | — |
| ASR floor (already ours) | ~300ms interim, 200–500ms final | — |

---

## 8. Cost impact

Honest stacking on top of the existing bill (ASR ≈ **90% of current spend**):

- **Vision is the scary line, and the frame-diff gate is what makes it viable.** Naively streaming frames = 900+ vision calls/hour/user. With the MAD gate on a mostly-static screen: **~5–20 calls/hour**. On top of that, **downscale + low-detail** is a 3–10× *token* lever: a downscaled low-detail screenshot is ~85–260 tokens ≈ **fractions of a cent per look** (`detail:low` is a flat ~85 tokens on OpenAI tile-based; ~258 flat on Gemini for ≤384px; Claude ≈ `w×h/750`). Net: gated ambient vision is **noise** against the ASR bill; ungated vision would dwarf it. The gate is non-negotiable.
- **Answer models:** default Tier-A is cheap ($0.10–0.20/M in-class). Tier-B/C escalation is rare (router-gated) so its higher $/M ($3/$15 balanced, $5/$25 flagship) applies to a small fraction of turns.
- **Router calls:** heuristic-first means **most turns never pay for a classifier call**; the Tier-R model runs only on ambiguous turns and is the cheapest tier.
- **Proactive mode** is the cost risk (fires unprompted) — that's exactly why it's opt-in and Tier-R-gated + debounced (fires on ~2–3s silence OR every N new finals, never on interims, only if there's new final content).

**Gating that keeps it viable, summarized:** (1) `currentUserId()` guard blocks anon quota drain; (2) frame-diff gate → 5–20 vision calls/hr not 900+; (3) downscale + low-detail → fractions of a cent/look; (4) fast-model default, on-demand escalation; (5) prefix caching cuts prefill $ on long transcripts; (6) proactive off by default + Tier-R gate; (7) hard input caps + rolling memo keep per-request tokens flat over 60-min sessions.

---

## 9. Phased build

Each phase clones the `/api/correct` template (auth guard + caps + fail-soft + `logError` + sanitize) — no new framework.

### Phase 1 — On-demand transcript chat *(ship first)*
- **Ships:** `/api/copilot/answer` cloned from `/api/summarize`, **`stream:true` → `ReadableStream` Response** (first streaming route in the app). Tier-A default. Prompt ordered `[system][transcript tail][question last]` for prefix caching. Grounding + refuse-when-absent. Side panel with `res.body.getReader()` + `AbortController` (new turn aborts prior stream). Transcript pulled straight from client `segments[]` via `transcriptText(finals.slice(-K))`.
- **Touches:** new `/api/copilot/answer/route.ts`, new panel component, read-only use of `lib/transcript/store.ts` + `app/(app)/record/page.tsx`.
- **Latency:** first token ~0.9s, done ~2s. **Accuracy:** grounded, refuses when not in transcript. **Cost:** cheap Tier-A only.
- **Blocked on founder:** ✅ answer-model API key (probably already have OpenAI key from existing routes — confirm budget for chat volume).

### Phase 2 — Screen vision *(opt-in)*
- **Ships:** `lib/vision/useScreenStream.ts` (keep the `getDisplayMedia` video track, worker + MAD gate + 768px/q0.6 encode); `/api/copilot/vision` returning a cached `screenDescription`; Tier-R classifier `{needsScreen}` (heuristic-first) attaches a frame **only** when the question references the screen; vision runs async-cached (fresh sync call only on explicit stale-cache screen turns). Privacy: opt-in toggle off by default, self-rendered indicator, `tesseract.js` redaction, never persist frames.
- **Touches:** new `useScreenStream.ts`, new `/api/copilot/vision/route.ts` + `/api/copilot/route.ts` (classifier), panel toggle.
- **Latency:** screen-aware first token ~1.6–2.6s. **Accuracy:** grounded in screen text + transcript. **Cost:** gated → 5–20 vision calls/hr, fractions of a cent each.
- **Blocked on founder:** ⚠️ **vision-model access + budget sign-off** (this is the line item that stacks on ASR); confirm Tier-A vision model choice.

### Phase 3 — Multi-model router + RAG + proactive
- **Ships:** full router (`{needsScreen, needsWeb, complexity, answerable}`, parallel dispatch); Tier-B/C "Smart" escalation; **RAG** (web/docs retrieval + `[n]` citations + pre-render validation); reasoning-only verification pass; **opt-in proactive** off `onFinal` (debounced on silence / N finals, dedup via fingerprint Set + `previousAnalysisResult` feed-back, renders into a side rail, never interrupts the answer stream or captions); prefix-cache prewarm + rolling memo. **Native Tauri capture** (`scap`/`xcap` via the `lib.rs:13-14` bridge) to drop the picker.
- **Touches:** router route, retrieval route + vector index, proactive trigger in `record/page.tsx` (`onFinal`), `src-tauri` command + `capabilities/default.json`, provider-factory LLM layer modeled on `DEFAULT_MAKERS`.
- **Latency:** router ≤200ms (or 0 on heuristic hit); high-accuracy turns pay extra only where flagged. **Accuracy:** citations + verification + RAG. **Cost:** proactive is the risk — Tier-R-gated + debounced + opt-in.
- **Blocked on founder:** ⚠️ **RAG data source + embedding/vector-store budget**; **Tier-B/C model access + $/M sign-off**; **native-capture entitlements** (macOS Screen Recording; code-signing for notarization); decision on whether proactive ships to all users or gated tier.

---

## 10. What NOT to do

- **Don't copy GPL-3/AGPL source into LiveTranscript.** Glass, cheating-daddy, pluely = GPL-3; interview-coder variants = AGPL-3 (viral). Re-implement patterns; lift code only from cue (MIT), MeetingCopilot / free-cluely (Apache-2.0), meetily (MIT).
- **Don't stream frames per-frame or on a naive timer.** No MAD diff gate = 900+ vision calls/hour and a cost blowout. The diff gate is the whole game.
- **Don't put vision on the text critical path.** Cache a `screenDescription`; refresh in the background. Blocking every answer on a fresh vision call adds 0.5–1.5s to *every* turn.
- **Don't attach a screenshot to every question.** Vision is the biggest latency + token tax; event/intent-gate it.
- **Don't use `json_object` mode for the streamed chat answer** — partial JSON doesn't render; you lose the streaming latency win. Keep JSON mode only for the structured summarize track.
- **Don't prepend timestamps/nonces/volatile IDs** to the prompt — busts the entire prefix cache.
- **Don't race two full answer models** for the same query — token cost rarely justifies the marginal latency win. Race model-vs-heuristic only.
- **Don't ship cue's prompts unmodified** — they're ungrounded and will confabulate. Add quote-transcript + refuse-when-absent.
- **Don't do per-turn socket connects for STT** — reuse the persistent session; add Glass's keep-alive/renew/overlap so long sessions don't drop packets.
- **Don't skip the self-rendered capture indicator on native Tauri** — the OS shows none; silent screen capture with no indicator is a privacy violation.
- **Don't persist raw screenshots server-side, and don't skip on-device redaction.** Frames carry passwords/PII; process in-memory, return derived text, drop the image.
- **Don't build speculative infra now:** no RAG index, no verification pass, no native capture, no vision-provider abstraction in Phase 1. Add each when the cheaper path measurably falls short (RAG when transcript grounding proves insufficient; verification when a reasoning turn hallucinates; native capture when the share banner becomes a UX problem).

---

**Deferred deliberately (add when triggered):** multi-model racing (cost > marginal latency), self-hosted STT (Deepgram's ~300ms floor is already good), a custom cache/diffing library (hand-rolled MAD covers it). — skipped: over-abstraction; add when the simple path measurably falls short.