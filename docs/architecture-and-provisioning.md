# LiveTranscript.ai — Definitive Architecture & Build Plan

*Principal-engineer / CTO brief. Read this to decide what to fund.*

---

## 1. Verdict

**Your architecture is already ~80% right — do not rebuild, double down.** You are natively in the correct camp (local system-audio + screen capture via the Tauri shell, direct-client-to-ASR WebSocket, two-track fast-captions + async-enrichment). Those are the exact patterns the latency/accuracy leaders use, and they are dictated by hard constraints (Vercel can't host a persistent WebSocket server), so they're not just fine — they're forced-correct. **The single biggest strategic decision is already made and you should now commit to it in writing: stay in the LOCAL-CAPTURE live-copilot lane (Cluely/Granola turf) and explicitly defer the bot-joins-the-meeting fleet.** Bot-capture is a *different product* (team-meeting CRM intelligence) owned by Otter/Fireflies; a small team fighting there loses. The second decision — and this is the one that actually wins the market — is **multi-vendor models routed by purpose, not single-vendor loyalty**: Claude is now the measurably best coder and best dense-code-vision model in 2026, and Cluely (your explicit target) is beatable on the *two things it publicly fails at* — latency (its own users measured 5–90s copilot lag) and grounded accuracy. Your real gaps are narrow and cheap: (1) true OS-level audio loopback in the Tauri app, (2) an undetectable capture-excluded overlay, (3) an eval/observability loop, and (4) the compliance minimum before any public recording push. Fund those four, add one API key (Anthropic), and you out-execute Cluely.

---

## 2. How the winners are built

| Product | Capture strategy | Models | Best at | Weakness |
|---|---|---|---|---|
| **Cluely** (target) | Local: system audio + mic + screen OCR, undetectable overlay | Undisclosed cloud LLMs (wrapper) | Distribution + invisible overlay UX | **5–90s response lag, generic answers**; 83k-user breach; raw launch |
| **Granola** ($1.5B) | Local, no bot, "invisible notepad" | Cloud LLM + MCP into Claude/ChatGPT | Note *quality*, augment-the-human ethos | Not a live copilot; not for interviews |
| **Glass (Pickle)** | Local (Electron), open-source | Bring-your-own | Proves the overlay idea is commoditized | No moat — it's the reference clone |
| **Otter.ai** | Bot joins call (OtterPilot) | Own ASR + LLM | Real-time transcription at scale, incumbent brand | Accents/cross-talk WER, bot friction |
| **Fireflies** | Bot joins call | Own stack | Conversation intelligence + integrations/search | Bot-in-meeting, freemium limits |
| **Fathom** | Bot joins call (visible tile) | Own stack | Genuinely generous free tier (growth wedge) | Visible bot, accuracy complaints |
| **Interview Coder** | Local, 20+ stealth features | Undisclosed (wrapper) | Coding-interview stealth | Coding-only; $299/mo; credit-limited |
| **LockedIn / Final Round** | Local overlay | Undisclosed (wrapper) | Breadth (mock interviews, resume, auto-apply) | Reliability (freezes mid-interview), 3.6/5 |

**The 5 things we must do to be best-in-market:**

1. **Own audio capture natively** — real OS loopback (macOS ScreenCaptureKit/Core Audio taps, Windows WASAPI loopback) + mic, mic and loopback on **separate channels** for near-free 2-way diarization. Browser `getDisplayMedia` alone will always lose here. *This is the moat.*
2. **Keep the low-latency spine** — direct client→ASR WebSocket (server mints tokens only) + two-track split. Instrument and publicly beat Cluely's 5–90s lag with **sub-2s grounded first tokens**.
3. **Ship the undetectable, capture-excluded, click-through overlay** — `SetWindowDisplayAffinity` on Windows / ScreenCaptureKit content-filter on macOS. This one feature *defines* the interview-copilot tier; it's table stakes.
4. **Win on trust + domain accuracy** — first-class per-session keyterm prompting (JD/company/stack), grounded refuse-when-absent answers, and execution-verified (Pyodide) coding. No competitor offers verified answers.
5. **Monetize + position** — Fathom-style generous free tier, Stripe live, and a **consent-first / local-first** privacy stance that turns local capture into a compliance *advantage* — the opposite of Cluely's abandoned "cheat" framing.

---

## 3. The recommended architecture

Target system, in words. **[KEEP]** = already best-in-class for your constraints; **[NEW]** = fund this.

```
                    ┌─────────────────── TAURI DESKTOP APP (the moat) ───────────────────┐
                    │  [NEW] OS audio loopback (ScreenCaptureKit / WASAPI) + mic          │
                    │        → SEPARATE channels: you=mic, them=loopback (free diarization)│
                    │  [KEEP] getDisplayMedia screen frames → MAD perceptual diff          │
                    │  [NEW] undetectable click-through overlay (capture-excluded)         │
                    └───────────┬──────────────────────────────────┬──────────────────────┘
                                │ audio (direct)                    │ frames + questions
                                ▼                                    ▼
   [KEEP] ASR: browser→provider WSS (server mints 300s tokens, app never holds socket)
          • AssemblyAI Universal-Streaming  ← PRIMARY for English (307ms, $0.0025/min)
          • Deepgram Nova-3                  ← multilingual/EU + fallback ($0.0048/min)
          • connectWithFallback → upgrade to a COST/QUALITY router
                                │ interim captions (instant)         │
                                ▼                                    ▼
   [KEEP] Two-track: fast interim caption  ──────►  [KEEP] async correction/summarize (waitUntil)
                                                     │
   ROUTER = user's mode pick + cheap heuristic  ◄────┘  (NO frontier-model classifier hop)
                                │
                                ▼
   [NEW] Vercel AI Gateway (or OpenRouter) — one hop, provider fallback, spend/latency tracking,
         hot-swap models via COPILOT_MODEL_FAST/SMART env, no code change
                                │
        ┌───────────────────────┼────────────────────────────────┐
        ▼ fast tier             ▼ smart tier (coding/sysdesign)    ▼ vision (dense code)
   [NEW] gpt-5.4-nano      [NEW] Claude Sonnet 5 default,     [NEW] Claude Opus 4.8
   or Gemini 2.5 Flash-Lite      Opus 4.8 for hard turns            (OCR + reasoning in ONE call)
   (was gpt-4o-mini)             (was gpt-4o)
                                │
                                ▼ HTTP ReadableStream (grounded, refuse-when-absent, Pyodide-verified)
                                │
   RAG: [KEEP] on-device cosine story bank (text-embedding-3-small) → [NEW-LATER] pgvector on Neon
        (enable ONLY at team/shared knowledge, doc upload, or >~10k–50k vectors)

   Realtime rooms: [KEEP] Ably (debounce to <50 msg/s/channel, presence sets <200)
   Durable jobs:   [KEEP] waitUntil for correct/summarize → [NEW-LATER] Inngest for enrichment pipeline
   Evals/obs:      [NEW] Helicone (TTFT/cost/user) + Braintrust (offline regression gates on 4 modes)
   Bot path:       [DEFER] Recall.ai — separate SKU, never build headless-browser bots
```

**Decisive calls:** No WebTransport. No LLM-classifier router hop. No Pinecone/dedicated vector DB. No self-hosted WebRTC/TURN/LiveKit. No Realtime/Live speech-to-speech APIs (they'd collapse your two-track design and forfeit independent ASR/LLM provider swap). No bot fleet in v1.

---

## 4. Best model per purpose

| Purpose | Best pick (vendor + model) | Fallback | New key? | Rough cost |
|---|---|---|---|---|
| **Streaming ASR (English)** | **AssemblyAI Universal-Streaming** — 307ms, cheaper | Deepgram Nova-3 | No | $0.0025/min ($0.15/hr) |
| **Streaming ASR (multilingual/EU)** | **Deepgram Nova-3** (EU region) | AssemblyAI | No | $0.0048/min ($0.29/hr) |
| **Smart tier: coding + system design** | **Claude Sonnet 5** default (near-Opus quality) | Opus 4.8 for hard turns | **YES — Anthropic** | $3/$15 (intro $2/$10 to 2026-08-31) per 1M |
| **Hard coding / max reasoning** | **Claude Opus 4.8** (index leader coding + 1M ctx) | GPT-5.6 Sol | (same key) | $5/$25 per 1M |
| **Screen vision (dense code OCR+reason)** | **Claude Opus 4.8** (2576px, pixel-accurate, one call) | Gemini Flash-Lite OCR pre-pass | (same key) | $5/$25 per 1M |
| **Fast tier: router / behavioral** | **gpt-5.4-nano** (no new plumbing) | Gemini 2.5 Flash-Lite (cheapest) | No (Google optional) | $0.20/$1.25 (Gemini $0.10/$0.40) |
| **Embeddings (RAG)** | **OpenAI text-embedding-3-small** — no change | text-embedding-3-large only if proven | No | $0.02/1M |
| **Speech-to-speech** | **Do not adopt** — breaks two-track | — | No | n/a |

**Where Claude/Gemini genuinely beat what you run now:** Your `modes.ts` hard-defaults `smart=gpt-4o`, `fast=gpt-4o-mini` — both a generation behind. Claude Opus 4.8 leads the Artificial Analysis Intelligence Index on coding + agentic (56 vs GPT-5.2's 42) and has 1M context (vs GPT ~400k) for large-codebase system-design prompts, plus the best dense-code vision. **Routing the smart + vision tiers to Claude is the single highest-leverage change to beat Cluely on interview-copilot quality.** Gemini 2.5 Flash-Lite is the cheapest capable fast tier if you want to shave the router line. Net new vendor cost: **one — Anthropic.** Everything else reuses existing keys.

---

## 5. Build roadmap (ordered by leverage)

**Phase 0 — Unblock & de-risk (days). Ships: safe, sellable foundation.**
- Rotate every chat-exposed key (create→update Vercel env→verify→revoke — never revoke first). Add CI secret-scanning (gitleaks/trufflehog).
- Complete Clerk prod DNS cutover / live keys (task #36). *Unblocks: production sign-in + ASR token minting.*
- **Founder dependency:** key rotation confirmation, Clerk DNS, scoping decision (local-capture only for v1).

**Phase 1 — The model win (1 week). Ships: best-in-market answer quality.**
- Add `ANTHROPIC_API_KEY` + `@anthropic-ai/sdk` + provider branch in `app/api/copilot/answer/route.ts` (Anthropic `messages.stream` shape differs from OpenAI delta). Route smart + vision tiers to Claude Sonnet 5 / Opus 4.8. Swap fast tier to gpt-5.4-nano.
- Prompt-cache the stable prefix for Anthropic (same ordering you already use). *Unblocks: beating Cluely on accuracy — the whole pitch.*
- **Founder dependency:** Anthropic key + per-tier model decision (Sonnet default vs Opus for hard/vision).

**Phase 2 — The capture moat (2–4 weeks). Ships: the thing a web app can't copy.**
- Native OS audio loopback in Tauri (Rust), mic + loopback on separate channels. Undetectable capture-excluded click-through overlay. Signed + notarized builds.
- Wire MAD "unchanged frame → null" to reuse last extracted screen context (skip the image on follow-ups). *Unblocks: the interview-copilot tier + full-system audio reliability.*
- **Founder dependency:** Apple Developer ($99/yr) + Windows code-signing cert (~$100–400/yr).

**Phase 3 — The feedback loop (days, parallelizable). Ships: data-driven quality/latency.**
- Vercel AI Gateway (or OpenRouter) in front of all model calls. Helicone (TTFT/cost/user). Braintrust regression gates over the 4 modes. *Unblocks: choosing model tiers with data, not vibes; publishing your latency numbers.*
- **Founder dependency:** enable Gateway; Helicone + Braintrust accounts (free tiers).

**Phase 4 — Monetize + comply (1–2 weeks, gates public launch). Ships: revenue + legal cover.**
- Turn on Stripe (generous free tier + hard minute cap). In-product pre-recording consent flow (all-party default), Privacy Policy/Terms/DPA, sub-processor list, retention policy (store transcripts not raw audio), delete/export path. Sign OpenAI DPA + request ZDR. Cost/ASR-concurrency instrumentation + free-tier cap enforcement.
- **Founder dependency:** Stripe business setup, legal review, free-tier cap + pricing decision, DPA signatures.

**Phase 5 — Scale hardening (as-needed). Ships: survives a launch spike.**
- Extend `connectWithFallback` into cost/quality router (AssemblyAI free, Deepgram paid) + idle-socket close + client VAD. Pre-negotiate Enterprise ASR concurrency (first wall is ~150–225 streams, hit *before* user count 10k). Add Sentry + cost-per-active-user dashboard.

**Deferred (separate product, not v1):** Recall.ai team-meeting SKU; Inngest enrichment pipeline; pgvector on Neon.

---

## 6. ★ WHAT I NEED FROM YOU ★

Prioritized checklist. **[BLOCKING]** = work stops without it. **[OPTIONAL]** = later leverage.

### API keys
- [ ] **[BLOCKING] Anthropic API key** — unblocks Claude Sonnet 5 / Opus 4.8 on the smart + vision tiers = the answer-quality win that beats Cluely. Cost: Sonnet 5 $3/$15 (intro $2/$10 to 2026-08-31), Opus 4.8 $5/$25 per 1M tok; ~cents-to-low-$ per active interview session.
- [ ] **[OPTIONAL] Google Generative AI (or Vertex) key** — only if you want the absolute-cheapest fast tier (Gemini 2.5 Flash-Lite $0.10/$0.40) or a dedicated cheap OCR pre-pass. gpt-5.4-nano on your existing OpenAI key already covers the fast tier.
- [ ] *(No new key needed for Deepgram Flux, AssemblyAI, or embeddings — existing keys cover them.)*

### Accounts
- [ ] **[OPTIONAL] Vercel AI Gateway enabled** (or OpenRouter key) — one endpoint for provider fallback + spend tracking + hot-swap models via env, no code change.
- [ ] **[OPTIONAL] Helicone + Braintrust** — the missing latency/quality feedback loop; both free at your scale. Highest-leverage low-cost add.
- [ ] **[OPTIONAL] Sentry** (or Vercel error tracking) — runtime errors the PostHog product analytics don't cover ($0–26/mo).
- [ ] **[DEFERRED] Recall.ai** — only if/when a team-meeting bot SKU is greenlit; $0.50/hr + $0.15/hr. Do not put on the v1 critical path.
- [ ] **[DEFERRED] Inngest** (free 50k/mo) — when you build the enrichment pipeline. *(Vercel Workflows only for >800s jobs.)*

### Budget sign-offs (rough monthly, set a ceiling + alert)
- [ ] **[BLOCKING] ASR spend ceiling** — dominant COGS (60–80%). At ~5 hrs/user/mo: 1k users ≈ **$750/mo** (AssemblyAI) or **$1,440/mo** (Deepgram). Routing free tier to AssemblyAI roughly halves it.
- [ ] **[BLOCKING] LLM spend ceiling** — second line. Reserve Claude/gpt-4o-class strictly for coding/system-design/vision; keep fast tier cheap. Every mode promoted to "smart" is ~17x per answer.
- [ ] **[OPTIONAL] SOC 2 program** ($25k–50k first year via Vanta/Drata + auditor + pen test) — gate to enterprise deals. Start the trial *now* to accrue the observation window; don't wait for a deal to demand it.

### Product / legal decisions
- [ ] **[BLOCKING] Confirm v1 scope = local-capture live-copilot only; defer bot-joins.** $0 — a scoping decision that keeps a small team off Otter/Fireflies' turf.
- [ ] **[BLOCKING] Free-tier minute cap + paid pricing** (e.g. 300 min/mo free). Without a cap, ASR is unbounded per free user.
- [ ] **[BLOCKING] Recording-consent + privacy stance.** Default all-party consent (EU + CA/IL/FL/WA/etc. in scope). Position consent-first/local-first to avoid Cluely's "cheating tool" reputational trap. Do **not** ship voiceprint speaker-ID without explicit BIPA consent (Illinois private right of action). Cost: legal review ~$2k–8k for Privacy Policy/Terms/DPA.
- [ ] **[BLOCKING] Per-tier model + per-language ASR decision** — Sonnet 5 default vs Opus for hard/vision; AssemblyAI-primary for English (faster/cheaper, but session-billed + English-only) vs Nova-3 for multilingual/EU.

### Human-only items (only you can provide)
- [ ] **[BLOCKING] Stripe business account + price setup** (currently "coming soon") — no revenue path until checkout is live.
- [ ] **[BLOCKING] Clerk production DNS cutover / live keys** (task #36) — auth is on test keys.
- [ ] **[BLOCKING] Apple Developer ($99/yr) + Windows code-signing cert (~$100–400/yr)** — signed/notarized desktop build is required for reliable loopback capture + the capture-excluded overlay.
- [ ] **[BLOCKING] Rotate all chat-exposed keys** (OpenAI, Deepgram, AssemblyAI, Ably, DB creds, Clerk) — treat as breach; create→update→verify→revoke. ~1 hour, $0.
- [ ] **[BLOCKING] Sign OpenAI DPA + request Zero-Data-Retention**, and DPAs with every sub-processor (Deepgram, AssemblyAI, Ably, Neon, Clerk, Vercel, PostHog). Few hours, $0.

---

## 7. What NOT to do

- **Don't build a Recall.ai-style bot fleet in v1.** Autoscaling headless Chromium + a media pipeline that breaks every time Zoom/Teams/Meet ship a web-client update is a full-time infra company and a maintenance treadmill. If ever needed, *buy* Recall.ai as a separate SKU.
- **Don't add an LLM-classifier router hop.** A frontier-model call on the hot path adds a full round-trip of latency. Keep the user's mode pick + cheap heuristic/embedding classifier.
- **Don't adopt WebTransport.** It buys nothing over WebSocket for your workload and costs you a Safari fallback path.
- **Don't buy a dedicated vector DB (Pinecone/Weaviate).** pgvector on the Neon you already run handles 1M vectors past your foreseeable scale. Enable it only at team/shared knowledge or doc upload.
- **Don't adopt Realtime/Live speech-to-speech APIs.** They collapse your clean two-track design into one opaque, more-expensive audio model and forfeit independent best-WER-ASR / best-coder-LLM provider swap. Only revisit if you add a spoken AI interviewer.
- **Don't self-host WebSockets/WebRTC/TURN to save the Ably bill.** False economy — you'd rebuild presence, fan-out, reconnect, and global edge, and get paged for it. Keep Ably; just debounce publishes and keep presence sets <200.
- **Don't standardize on one model lab, and don't switch smart-tier to gpt-4o's successor by default.** Route by purpose. Claude wins coding/vision; OpenAI/Gemini win cheap-fast; ASR stays separately swappable.
- **Don't adopt LangSmith, LangGraph agentic orchestration, or OpenTelemetry now.** You don't use LangChain, full agentic multi-tool orchestration is the wrong altitude for a latency-critical copilot, and OTel is premature until you need to unify traces at scale.
- **Don't market recording before the compliance minimum ships.** Consent flow, Privacy Policy/Terms/DPA, retention, delete path — table stakes, not nice-to-haves. This is the one area that can cause existential (not just technical) harm.

---

*Bottom line: you already made the hard low-latency/accuracy calls correctly. The money should go to four narrow things — the Anthropic model swap, native capture + overlay, the eval loop, and compliance — not a rewrite. That's what lets you out-execute a $20M-funded competitor whose own launch shipped at 5–90s latency.*