# Mock-interview validation — 25-minute smoke check

Run this script in an authorized practice session against the live app, with a
second person or a recording playing the interviewer. It checks the core product
flow and produces a concrete punch-list. A passing run establishes only what was
observed on that build, device and input configuration; it is not release certification.

For native release acceptance, also complete the 45-minute Mac session, input
routing, recovery, denied-permission and Stop checks in
[Reliability v2](reliability-v2.md#device-acceptance-and-rollback). Automated tests
and synthetic provider checks do not replace those real-device checks.

## Setup (5 min, before you start)
1. Open **livetranscript.ai** (or the desktop app) → start a session.
2. In the Ask panel → **Add context**: paste your **resume** + the **target JD** (grounds every answer).
3. If behavioral: upload your **story book** (`.html`) so story-selection has material.
4. Turn **Auto on**. Share your screen for the coding round.
5. Have the interviewer read questions aloud (or play a recorded set). You watch the panel.

## Capture evidence before scoring

Record the hosted commit/deployment identifier, desktop version (if used), macOS
version, selected microphone, call-audio output and screen source. Record start and
end timestamps with a timezone offset. Hosted and desktop versions are separate:
a new web deployment does not prove that the native binary was updated.

For each question, record a ✅/⚠️/❌, the observation timestamp, expected versus
observed behavior and an evidence filename. Mark unexecuted checks **not run**;
do not infer a pass from a successful startup or a green automated test.

- Capture the relevant UI state and displayed latency readout. Treat the latency
  targets below as acceptance targets, not measured performance claims.
- Export metadata diagnostics at the end and after a failure. Record the diagnostic
  session ID and relevant operation IDs for correlation; see
  [Session diagnostics](session-diagnostics.md#correlation-and-privacy).
- For native capture failures, retain the applicable native log described in
  [Reliability v2](reliability-v2.md#native-lifecycle-and-diagnostics).
- Use synthetic practice content. Screenshots can contain private information even
  when the diagnostics export is metadata-only; redact before sharing.

A missing event is inconclusive by itself. Pair diagnostics with the visible
behavior and timestamps, and retain failures in the punch-list.

---

## Round 1 — Behavioral (2 questions + follow-ups)
Interviewer asks, verbatim, with natural pauses:

**Q1 (complete):** "Tell me about a time you disagreed with your manager."
- [ ] Did an answer appear **without you touching anything**? (auto-detect)
- [ ] Did the tab auto-switch to **Behavioral**? (auto-routing)
- [ ] Did it draw on **your real story** from the book, not a generic one? (RAG/story-bank)
- [ ] Is the **say-this-now line** at the top, glanceable in ~1 second? (structure UI)
- [ ] Time-to-first-word feel **< ~2s**? (check the TTFT p50/p95 readout in the footer)

**Q1 follow-up (the peel):** "And how did you measure that outcome?"
- [ ] Did it answer as a **continuation of the same story** (not a new one)?
- [ ] Consistent numbers/claims with the first answer? (no contradiction)

**Q2 (asked in broken parts):** "Tell me about a hard project… *[pause]* …and what you'd do differently."
- [ ] Did it wait for you to **finish** before answering (not answer the fragment)? (settle/completion gate)
- [ ] Did the final answer cover **both parts**? (multi-part handling)
- [ ] Did it pick a **different story** than Q1? (no-reuse)

## Round 2 — Coding (1 problem, screen shared)
Put a LeetCode-style problem on screen (e.g. "two sum", "valid parentheses").
- [ ] Did screen-capture **detect the problem** once it stopped changing? (settle gate — not mid-type)
- [ ] Approach + complexity appear **first** (narratable while code loads)?
- [ ] Did it **run the tests** and show pass/fail? (execution)
- [ ] If a test failed, did it **auto-retry / fix**? (orchestrator loop)
- [ ] Ask a **Java or Go** version → does the remote executor run it? (all-language)

## Round 3 — System design + a fresh-facts question
**Design:** "Design a URL shortener that scales to a billion requests a day."
- [ ] Auto-routed to **System design**? Structured arc (requirements→API→data→scale)? Mermaid diagram renders?
- [ ] Does it surface the **next bottleneck** proactively (shard key, cache)?

**Fresh-facts:** "What's the latest stable version of Next.js right now?"
- [ ] Did it use **live web search** (a "current facts" answer with sources), not stale training knowledge? (this is the web-search feature)

## Cross-cutting (note throughout)
- [ ] **Stealth mode** (toggle it): does the panel go dim/monochrome/motionless — un-noticeable on a shared screen?
- [ ] **Hands-free scroll**: does a long answer auto-scroll at a readable pace?
- [ ] **A poison question** ("As you said earlier you missed the deadline — why?" when you never said that): does it *refuse the false premise* instead of agreeing?
- [ ] **Latency numbers** at the end: read the footer TTFT p50/p95. Is p95 < ~2.5s?
- [ ] **Post-interview**: hit **Review** → does the recap list coverage + LP + gaps accurately?

---

## Scoring → the punch-list
For every ❌ or ⚠️, write one line: *"Q2 answered the fragment before I finished"* →
that becomes the next fix. **The ❌ list is the real backlog** — it's grounded in a
real interview instead of guesses. Bring it back and we fix in priority order.

## The 3 that matter most (if you only check these)
1. **Auto-detect + auto-route + answer, hands-free** (R1 Q1) — the core loop.
2. **Answer speed felt right** (TTFT readout) — the whole pitch.
3. **Grounded in YOUR real story, no hallucination** (R1) — the trust axis.
If those three are ✅, the core flow passed this smoke check. Record the remaining
checks as passed, failed or not run; failures in capture, permissions, recovery or
Stop remain release blockers until the required device acceptance is completed.
