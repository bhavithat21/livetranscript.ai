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

---

# ADDENDUM — Domain Excellence: Coding, System Design, Behavioral

**Status:** Design, pre-build · **Owner:** Principal Eng · **Reviewer:** Founder
**Scope:** turn the generic §1–§10 copilot into a *best-in-market* interview/work copilot that beats Cluely on the three modes that actually decide interviews. **Nothing here is a new architecture** — every mode is a preset over the router/vision/grounding primitives already designed above.

## A1. The thesis

One answer engine can't be best at all three modes because the three modes want *opposite* things: coding is vision-heavy and latency-tolerant (correctness > 0.9s), system design is transcript-heavy and stateful over 45 min, behavioral is transcript-only and latency-critical (<1s or it's visible). Cluely and the whole OSS/commercial field run **one engine for everything** and are therefore mediocre-everywhere and wrong-often. Our edge is **mode-specialization riding the router we already built**: a `mode` label added to Tier-R turns each mode into a **router profile** that presets `{needsScreen, needsWeb, complexity}` + capability tier + grounding source + output format. Coding inverts the transcript-first default (`needsScreen=true, complexity=reasoning`, synchronous high-detail vision); system design is the reasoning-default mode (`complexity=reasoning`, rolling-memo state, async diagram vision); behavioral is the speed mode (`needsScreen=false`, Tier-A only, retrieval-bound, speculative-on-interim). Same plumbing, three presets — that's the whole trick, and it's cheap to build because §3's router already emits the flags each profile just needs to hard-set.

## A2. Competitive landscape

| Tool | Coding | System Design | Behavioral | Core weakness we exploit |
|---|---|---|---|---|
| **Cluely** (a16z, ~$20M) | "mostly wrong" (Reddit) — prints, never runs | none (stateless transcript-tail) | generic + **fabricates resume experience** (Business Insider caught it) | advertises ~300ms, measured 5–10s; one engine; undetect paywalled $149.99/mo |
| **Interview Coder** (~$60/mo) | strong, screenshot→solution+complexity, never runs | none | none | coding-only screenshotter, no audio, no grounding |
| **Final Round AI** (10M+ users, the real threat) | decent | none (routes by type, same model) | resume-upload personalization (shallow) | jack-of-all-trades depth; "within seconds" not sub-1s; no story bank; no design canvas |
| **LockedIn AI** (869k, $54.99/mo) | coding-optimized | none | generic | credit anxiety, undifferentiated latency |
| **Sensei AI** ($89/mo) | weak | none | resume/JD context | "fails in live calls" (Reddit), browser-only stealth/latency ceiling |
| **cheating-daddy / Glass / cue** (OSS) | ungrounded | none | ungrounded | single live socket → structurally can't route/ground/specialize; confabulate freely |

**The 5–7 edges we win on (all defensible, hard to retrofit):**
1. **Grounded-or-refuse everywhere** — the already-designed Tier-R `answerable` flag + refuse-when-absent (§6.1–2). Directly kills the field's #1 failure: confident fabrication.
2. **True per-mode specialization** — `mode:{coding|systemDesign|behavioral|generic}` on Tier-R selects prompt + tier + input priority + **output format**. Highest leverage-to-effort win; nobody else does it.
3. **Per-user grounding layer (the moat)** — resume + projects + STAR story bank embedded pre-interview, retrieved into every turn. Beats Final Round's shallow resume-upload; compounds per user.
4. **System-design canvas + capacity-KB grounding** — the empty category; a stateful framework scaffold no competitor ships.
5. **Honest mode-aware latency SLAs** — behavioral pinned <1s, coding/design 2–4s. Real numbers vs Cluely's fictional 300ms are a marketing weapon.
6. **Speakable, not readable output** — glanceable STAR cues / narratable approach-first code / a design checklist you drive. Attacks the "scripted delivery" detection vector everyone ignores.
7. **Screen-vision first-class for coding/design, gated OFF behavioral** — the `needsScreen × mode` matrix stops coding from being "mostly wrong" without taxing behavioral latency.

## A3. Mode profiles

### A3.1 Coding — vision-heavy, execution-verified

**A-grade answer:** correct AND optimal at the complexity the on-screen constraints demand, in the exact language + method signature shown, verified by running the problem's own sample cases. Reads statement/constraints/examples/stub with zero OCR drift; picks the algorithm the constraint budget allows (`n≤1e5 ⇒ O(n log n)`, `n≤20 ⇒ bitmask`, `n≤500 ⇒ O(n³)` is fine) and says why; matches `class Solution.method` (never a rogue `main()`); proves it by executing samples and self-repairing; hands over approach + Time/Space + edge cases the candidate narrates as their own; keeps follow-ups ("optimize it", "huge input") coherent with the *same* problem.

**Router profile (inverts the §1 transcript-first default):** `mode=coding` hard-sets `needsScreen=true`, `complexity=reasoning`, `needsWeb=false`. Tier-R does **not** gate the initial solve — it only classifies follow-up intent (new-problem vs optimize vs explain vs dry-run vs scroll).

**Inputs (captured DIFFERENTLY from §5's ambient path):** SCREEN is primary and dominant — full/near-full-res crop of the problem panel + editor at **JPEG q0.9**, NOT §5's 768px/q0.6/low-detail. Dense text is the whole point: `10^5` vs `10^9`, `<=` vs `<`, `l` vs `1` flip the correct algorithm, so §3's flat-85-token `detail:low` read is disqualifying here. Audio is secondary but essential (verbal constraints the screen never shows — "assume sorted", "no built-in sort" — and follow-up intent). User docs: not needed.

**Model tier + pass strategy — 2 model + 1 execution + conditional repair, escalate never race:**
1. **VISION EXTRACT** → structured schema `{statement, constraints, examples[], signature, language, existingCode}`. Tier-A/B vision at **HIGH detail**; escalate Tier-C only on dense code/diagrams/handwriting or low OCR confidence.
2. **SOLVE** — Tier-B strong coder default; escalate Tier-C for DP/graph/hard or after a failed repair.
3. **VERIFY = EXECUTION-first** — run the extracted samples in an isolated sandbox (deterministic, cheaper, far more accurate than an LLM judge). On failure, repair loop (feed failing case + error back, max ~2 iters). LLM self-critique (Tier-B/C) only when there are no runnable examples.
   - **Sandbox:** start client-side WASM (**Pyodide** for Python, JS-in-worker) — covers most interview languages, zero server cost, discreet, low-latency. Add a server/Vercel isolated sandbox for compiled langs (Java/C++/Go) only when needed. **Security is a hard trust boundary:** ephemeral, no network, no filesystem, CPU/mem/time caps; never `eval` in-process or on the app server.

**Grounding + accuracy:** ground strictly in the extracted on-screen schema, **not the model's memory of a same-named problem** (the anti-pattern is confidently solving canonical "Two Sum" when the screen shows a twist). Empirical grounding is the core — a failing sample triggers repair and is NEVER shown as verified. **Constraint→complexity is a HARD gate:** correct-but-TLE code for the stated `n` is a fail, not a pass. Fuse verbal constraints from the transcript. Surface low-OCR-confidence lines; flag "constraints may be below the fold" on a scrolled problem rather than guessing. No runnable examples ⇒ LLM self-trace, clearly labelled *unverified*.

**Latency (tolerant, must feel fast):** biggest win is **proactive pre-extraction** — the moment coding mode is on and a code-screen is detected (cheap OCR heuristic), extract the schema into the rolling memo *before* the user asks, so solve fires instantly at hotkey time. Stream approach-first (intuition ~1.5–2.5s), code streams, then Time/Space; the **verify badge fills in async** — never block render on the sandbox. Full verified solution ~4–8s. Parallelize solve-then-stream with sandbox-verify. Follow-ups skip re-OCR: schema lives in the memo and the MAD gate distinguishes scroll-of-same-problem from a new one.

**UX/output (streaming + narratable):** (1) one-line intuition/approach (streams first); (2) language- + signature-matched code block w/ copy; (3) `Time O(…) · Space O(…)` + one-clause why; (4) terse edge-cases bullets (empty/single/dupes/overflow/negatives); (5) async verify badge (`✓ 3/3 samples` / `⚠ failed #2 — repairing`); (6) a "say-this" narration track. Follow-up chips: Optimize · Explain complexity · Dry-run · Huge-input variant. Dim, small, hotkey-driven, no focus-steal.

**Beats Cluely by:** we EXECUTE the problem's own samples and self-repair — empirical correctness vs their print-and-pray. Plus constraint-driven complexity targeting, high-fidelity OCR of dense operators, exact signature/language match, solving the on-screen *variant* not the famous look-alike, and instant-feeling proactive pre-extraction.

### A3.2 System Design — stateful, diagram-aware, the empty category

**A-grade answer:** track the WHOLE evolving 45-min conversation, not one question. Hold accurate state of requirements as they drift (functional + non-functional: scale/latency/consistency), decisions made and WHY; know where the discussion sits in the canonical arc (requirements → estimation → API → data model → high-level → scale/bottlenecks → tradeoffs) and surface the next unaddressed step; read the Excalidraw/whiteboard diagram and reconcile it against what was SAID ("you said shard by user_id but the canvas shows one DB"); give reasoning-tier tradeoffs that cite WHY (an NFR or napkin-math, not tech-name-dropping — "add a cache because reads need <200ms p99"); proactively flag open threads and missing components. Correctness of state and reasoning beats speed.

**Router profile (THE reasoning mode):** `mode=systemDesign` sets `complexity=reasoning` almost always, `needsScreen=true` (diagram matters more here than any mode — the diagram *is* the artifact; §5's already-open `getDisplayMedia` video track, thrown away today, is kept), `needsWeb=false` (grounding is the memo + a curated KB, not the web). Tier-R gates each turn. **Default answer = Tier-B**; escalate **Tier-C** for diagram reads, deep tradeoffs, and capacity math. This is the one mode where §6.4's reserved verification pass actually fires — a cheap LLM-judge checks tradeoff/math claims for unsupported assertions.

**Inputs (ranked):** (1) AUDIO transcript — the spine; the whole conversation matters. (2) SCREEN frames of the diagram — diagram vision = **Tier-C** (Excalidraw boxes/arrows/labels need OCR + spatial reasoning; this is §3's reserved "look closely" case), async-cached into a `diagramState`, refreshed only when the MAD gate detects the canvas changed. (3) A small curated **capacity/latency reference sheet** (QPS/storage constants, single-Redis ~100k ops/s, SSD read ~1ms, the latency ladder) so estimation cites real numbers with `[n]` ids (§6.3 pre-render-validated). User docs: low value. The `systems` keyterm pack (consistent hashing, sharding, backpressure, P99…) is already in `DEFAULT_PACK_IDS`, so ASR of design jargon is already helped.

**Multi-pass (latency headroom exists):** (a) async **rolling-memo update off `onFinal`** (cheap Tier-A/B diff-merge, OFF the answer critical path — same fire-and-forget pattern as `correctLine`); (b) Tier-R gate; (c) Tier-B/C structured answer; (d) verification pass. The memo is a structured living object — `{reqs, estimates, api, dataModel, components[onDiagram], decisions[+tradeoff], openThreads, interviewerSignals}` — updated by incremental **correcting** diff-merge on finals and **periodically rebuilt from scratch (~every 10 min or on topic shift)** to stop compounding drift. It lives client-side like `segments[]` ⇒ ~0ms context assembly.

**Grounding:** ground in the memo + recent transcript deltas, NOT the web. §6.1's "refuse when absent" reframes here as **"flag what is still undecided"** rather than confabulate (design has no single right answer). Cross-modal grounding is the differentiator: reconcile spoken decisions against the drawn diagram, tie every suggestion to a stated requirement/NFR. The reference sheet is the one place light RAG earns its keep — estimation cites real numbers, never hallucinated math (the classic system-design failure).

**Latency (least sensitive — the candidate monologues):** first token ~1.5–2.5s, full structured answer ~3–5s acceptable. Make slow-but-smart FEEL fast: stream section headers first (framework skeleton paints <1s); the memo means we **never re-read the growing raw transcript**, so prefill stays cheap and TTFT stays ~1.5s even at minute 45; prefix-cache `[system + memo]` (memo append-stable, current question LAST — §7.4); **proactive "next component / open thread" nudges precomputed on the async memo track** so they're already in the panel at ask time (0 latency); §7.5 1-token prewarm on session start.

**UX/output:** framework-mapped collapsible sections (Requirements | Estimates | API | Data Model | High-Level | Deep Dives | Tradeoffs) with a **stage-progress rail** (covered-vs-open). A persistent non-interrupting **Open threads / Next** side rail. Diagram-reconciliation callout chips ("canvas vs spoken mismatch"). Tradeoffs render as a compact **Option A/B table** (consistency / latency / cost / complexity), not prose, + a suggested **diagram delta** ("add: CDN on the read path"). Estimation SHOWS the math (`QPS = DAU × actions × peak / 86400`), not just the number.

**Beats Cluely by:** the rolling memo = accurate whole-conversation state at flat per-request cost (at minute 40 it still knows the requirement from minute 3); framework-stage tracker + "what you haven't covered" coaching shapes the arc; spoken-vs-drawn reconciliation an audio-only overlay literally cannot do; reasoning default + verification + napkin-math grounding = cited tradeoffs not guesses; all heavy reasoning runs on the async memo track so the smartest tier costs no perceived latency.

### A3.3 Behavioral — retrieval-bound, speed mode, the personalization unlock

**A-grade answer:** a true, specific, defensible STAR answer from the USER'S real history, on screen as glanceable bullets before they finish being asked. Pull the right prepared story for the competency (conflict/failure/leadership/ambiguity/deadline/disagreement/influence-without-authority); reshape into crisp S-T-A-R bullets fitted to the exact question; surface the real numbers/names to say aloud; **NEVER fabricate** an achievement, metric, company, or outcome. The reasoning was already done when the user wrote the story — this mode is **retrieve + reframe + refuse-to-invent**, not deep reasoning. Non-negotiable: below the similarity threshold, say "no prepared story for X — nearest is Y" and fall back to resume bullets. An answer the user can't defend under follow-up is worse than no answer.

**Router profile (speed mode):** `mode=behavioral` hard-sets `needsScreen=false` (the whole §5 vision path stays OFF — that alone removes the biggest latency tax), `complexity=simple` (never a reasoning turn ⇒ **never pays the §6.4 verification tax**), `needsWeb=false`. Detection is **heuristic-first**: regex on the utterance for behavioral shape ("tell me about a time", "describe a situation", "give me an example", "how did you handle", "walk me through when…") + a competency keyword map — 0 cost, 0 latency on the common case. Tier-R model only on ambiguous phrasing. ANSWER = **Tier-A only, single-pass, streamed markdown** (no `json_object`). No escalation, no vision, no verification — escalation only behind an explicit "reframe/polish" tap (Tier-B), never hot-path.

**Inputs (ranked):** (1) USER CORPUS is everything — resume + a prepared STAR-stories doc (+ optional brag doc / LinkedIn / project write-ups), uploaded once and embedded at ingest (see §A4). (2) audio transcript of the question — already in `segments[]`; the **interim utterance is the latency lever**. (3) screen: off. Corpus > audio >> screen(off).

**Grounding (ONLY the user's corpus — the polar opposite of Cluely's question-only generation):** system prompt: *"Compose a STAR answer using ONLY the retrieved story below. Do not invent companies, roles, metrics, dates, or outcomes not present in the source. If the retrieved story doesn't fit, say so."* Match competency → best story (tag-match, then cosine top-1, keep top-2 as swap fallback). Every retrieved chunk + transcript slice is untrusted → existing `sanitizeKeyterms` scrub (a live interviewer can say "ignore previous instructions"). Refuse-when-absent renders "No prepared story for '<competency>' — closest is '<title>', or improvise from these resume bullets". `temperature` 0–0.3.

**Latency — hard target: bullets visible AS the interviewer finishes asking (~sub-1s after question-end, often earlier):**
1. **Speculative draft on the interim** — reuse §3/§7's speculative pattern and the existing `onFinal`/interim closure in `record/page.tsx`: the moment the interim reads "tell me about a time you had a con…", classify (heuristic, 0ms), retrieve, start streaming the draft; if the final diverges, `AbortController` kills it (same per-turn abort already used). Buys the whole question-tail (~1–2s of the interviewer still talking) for free.
2. **Retrieval is effectively free** — corpus pre-embedded at upload, so at question time it's tag-match first (0 network), then only if no tag hit ONE query embed (~150–300ms) + brute-force cosine over <50 vectors (<1ms). No index build, no DB round trip.
3. Tier-A streamed TTFT ~0.7–0.9s, overlapping the embed. §7.5 prewarm removes cold-prefill on the first question. Net: first STAR bullet lands ~0.3–0.9s after question-end.

**UX/output:** a glanceable STAR scaffold, **never a paragraph, never a verbatim script** (reading verbatim sounds robotic → detectable). Headline = matched story title + competency ("Conflict → 'The API migration standoff'"), then four labeled one-line bullets **S / T / A / R**, first-person, with the concrete **number/name BOLDED** (the load-bearing bit under cross-examination). ~5 bullets, large high-contrast type, scannable in a peripheral glance while speaking. A "different story" chip swaps to the top-2 match. Streams token-by-token via `res.body.getReader()` so S is usable while A/R arrive. Optional one-tap "reframe" (Tier-B).

**Beats Cluely by:** Cluely invents a plausible "time I had conflict" that isn't true, doesn't match the resume the interviewer is holding, can't survive follow-up, and is the same canned story every user gets. We retrieve the user's OWN prepared story — true, specific, resume-consistent, defensible — and it's *faster* because retrieval is near-zero and we draft speculatively on the interim. Personalization + refuse-to-fabricate + speculative-on-interim is the edge.

## A4. Personalization layer (the behavioral unlock)

This is the biggest differentiator vs generic Cluely and the one thing incumbents can't cheaply retrofit (they've productized the confident guess). It is deliberately **tiny and boring** — no vector DB.

- **Upload (pre-interview prep flow, not live):** user uploads resume + a STAR-stories doc (+ optional brag doc / LinkedIn export / project write-ups). Ingest chunks the resume into role/achievement chunks and the STAR doc into **one-chunk-per-story (~200–400 tok each)**.
- **Embed (once, at upload):** batch-embed all chunks with a small embedding model (e.g. `text-embedding-3-small`, 1536d) in a **single call**. Store `{id, text, embedding, competencyTags, storyTitle}`.
- **Storage — no vector DB:** corpus is tiny (<~50 chunks / <100KB), so it lives in **IndexedDB client-side** (or one user-scoped server row). `ponytail:` NO pgvector/Pinecone/index for 50 vectors — **brute-force cosine in JS is microseconds**; upgrade path is a real vector store only if a user's corpus ever exceeds a few hundred chunks, which an interview prep corpus won't.
- **Retrieval latency:** tag-match first (0 network) → on miss, one query embed (~150–300ms) + brute-force cosine over <50 vectors (<1ms). Meets the <1s bar with margin. Re-embed on upload/edit so a changed resume never serves stale vectors.
- **Privacy:** resume + stories are sensitive PII — store user-scoped, encrypt at rest, **never log payloads** (reuse §5's `logError`-context-not-payload rule), keep the corpus client-side (IndexedDB) where feasible so it never leaves the device except as a transient retrieval slice in the prompt.
- **Cross-mode payoff:** coding/design can also cite the user's *real* stack/experience from this same corpus ("you did this at scale on the Kafka pipeline in your resume").

## A5. The accuracy bar (avoid plausible-but-wrong — the field's #1 failure)

The category-wide gap is that everyone confabulates because nobody grounds+refuses. Per mode:

- **Coding:** code that **compiles and passes the problem's own sample cases** in the sandbox — empirical, not judged. Constraint→complexity is a hard gate (TLE = fail). Solve the on-screen variant, not the look-alike. No runnable examples ⇒ label *unverified*. This is the exact fix for Cluely's "mostly wrong" coding reputation.
- **System Design:** tradeoffs grounded in a stated NFR or napkin-math, not tech-name-dropping; capacity estimates grounded in the reference sheet (`[n]` cited, pre-render-validated) so throughput numbers are real; the verification pass checks math + unsupported assertions; spoken-vs-drawn reconciliation catches self-contradiction. "Flag what's undecided" instead of inventing a false single answer.
- **Behavioral:** grounded STRICTLY in the user's corpus; hard refuse-when-absent tuned **conservatively** (a too-eager "find a story" recreates Cluely's fabrication — the honest "no strong match, improvise from these bullets" is the whole point). This is the exact fix for the Business-Insider-documented resume fabrication.

Shared plumbing already designed: `[n]` citations with pre-render validation, `sanitizeKeyterms` scrub of every untrusted slice, `temperature` 0–0.3, reasoning-only verification pass.

## A6. The latency bar (honest per-mode SLAs — the opposite of Cluely's fictional 300ms)

| Mode | First visible token | Full answer | The move that gets there |
|---|---|---|---|
| **Behavioral** | **<1s** (~0.3–0.9s after question-end) | streamed | **speculative draft on the interim** + pre-embedded retrieval + Tier-A + no vision + prewarm. Hardest + clearest daylight vs the 5–10s field — the SLA to obsess over. |
| **Coding** | approach ~1.5–2.5s | verified ~4–8s | proactive pre-extraction (schema cached before ask) + stream approach-first + **async verify badge** (never block on sandbox) + parallel solve/verify |
| **System Design** | ~1.5–2.5s | ~3–5s | rolling memo (never re-read raw transcript) + stream section headers first + precomputed nudges (0 latency) + prefix-cache `[system+memo]` |

Shared levers already in §7: token-streaming, fast-model-default + on-demand escalation, vision off the text critical path (async-cached), prefix caching, MAD diff gate. Add ~50–150ms client RTT. **The behavioral <1s under real audio jitter (accents, crosstalk, incomplete sentences) is the genuine engineering challenge** — the same conditions that blew Cluely from 300ms to 5–10s. It's the headline claim, so it must be real; budget engineering time for it.

## A7. Phasing onto the base plan

Ship in **difficulty order** — the cheap edges alone put us ahead of Cluely for near-zero build cost.

- **Layers onto Phase 1 (transcript chat):** add the `mode:{coding|systemDesign|behavioral|generic}` label to Tier-R (heuristic-first, edge #2) + mode-specific **output formats** (edge #6) + **behavioral mode end-to-end** (Tier-A, transcript-only, speculative-on-interim, refuse-when-absent) *if* the personalization corpus is ready. Behavioral needs no vision, so it can ship on the Phase-1 streaming route. **CHEAP: prompt/format + router-label work.**
- **Layers onto Phase 2 (screen vision):** **coding mode** (edge #7 + high-detail vision extract + sandbox verify) and the `needsScreen × mode` matrix. Coding's high-detail q0.9 capture is a *variant* of Phase 2's `useScreenStream`, not new capture. Sandbox (Pyodide client-side) is the one genuinely new component. **MEDIUM.**
- **Layers onto Phase 3 (router + RAG + proactive):** **system-design canvas** (rolling memo already in Phase 3, extended to the structured design object + capacity KB via the RAG lane + diagram Tier-C vision + verification pass), and the **per-user personalization store** (uses Phase 3's embedding/vector budget, but stays IndexedDB + brute-force cosine — no pgvector). **HARD ceiling: defer the canvas but plan it; don't gate launch on it.**

**Blocked on founder** (extends §9's list):
- **User-doc upload + embedding/vector store** — the personalization corpus (resume/STAR bank). Needs the prep-flow UX sign-off + embedding-model budget (tiny: <50 chunks/user, one batch call at upload). This is the moat — prioritize it.
- **Model budgets** — Tier-B/C for coding solve + design reasoning ($3/$15 balanced, $5/$25 flagship, but router-gated to a small fraction of turns); embedding-model spend (negligible).
- **Coding sandbox decision** — client-side Pyodide/JS-worker covers most; server isolated sandbox for compiled langs only if interview demand shows it.
- **Capacity/latency reference sheet** — curate the ~1-page KB of real numbers for system-design estimation grounding.

## A8. Positioning note

There is a real tension between **interview-assist** and **legitimate live-notes/meeting copilot**, and the honest move is to hold both rather than pretend it away. Frame and default the product as a **live meeting/prep copilot grounded in truth**: the durable moat is per-user grounding + mode specialization + accuracy — data/UX moats an OS feature (Apple Intelligence / Windows Copilot / Gemini-in-Meet, all absorbing the overlay commodity in ~12–18 months) won't replicate — **not** stealth, which is a commoditizing dead-end and the source of Cluely's liability profile (surprise billing, ARR-lie press, detection arms race). So: name the modes for their *legitimate* use (interview *prep* + real-time notes, design-review copilot, coding pair-notes), default to grounded-and-truthful (behavioral literally *refuses to fabricate*, which is both the ethical and the competitive position), and let discretion be a user setting, not the pitch. Screen-share invisibility is one layer; gaze/audio/proctoring detection is unaddressed by every tool and out of scope to "solve." Positioning around genuine prep + truthful grounding is both more defensible and more durable than the "cheat undetectably" liability we'd inherit by aping Cluely's marketing.