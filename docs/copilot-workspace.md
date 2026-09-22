# Standalone AI workspace

Open `/copilot` from **AI Copilot** in the app navigation. It does not create or
join a meeting. Type a question, choose a domain, and send it. A microphone,
shared screen and transcript are optional sources of context.

## Where to navigate

| Task | Location | What happens |
|---|---|---|
| Tune the production assistant | Interviews → Mock Lab | Test held-out expectations, review measured timing, mark a correct result and apply the tested profile |
| Rehearse as a candidate | Practice | Answer by typing or speaking, review evidence-based feedback and export a debrief |
| Ask a question immediately | AI Copilot → question composer | Streams a mode-specific answer; no recording prerequisite |
| Understand an unfamiliar repository | AI Copilot → Repository | Import a folder or capture visible source; use the question ledger, evidence and specialist analysis |
| Explain code and test edge cases | AI Copilot → Coding | Code, complexity and tests share the existing coding pipeline |
| Prepare a grounded personal answer | AI Copilot → Behavioral → Context | Add actual resume, job description and story facts; request STAR-style structure |
| Read fewer words | Answer format → Keywords | Requests 3–4 cues while preserving essential evidence and any requested complete code |
| Get deeper reasoning | Answer format → Detailed | Requests mechanisms, data flow, alternatives, evidence and verification |
| Anticipate the discussion | Include likely follow-up questions | Appends three **possible** follow-ups; these are generated hypotheses |
| Hear an interviewer or practice aloud | Audio source → Start listening | Opt-in ASR sends captured text as context; Stop retains it in this tab |
| Check what audio the AI has | Context beside audio controls | Shows the captured transcript and an explicit clear action |
| Work with a helper | Remote | Separate invitation, host approval and control permission |
| Change branding | Settings → Appearance | App header/window title and supported icon surfaces; installed bundle names require a build |

Answer format, tone and follow-up preferences apply to the next request. Existing
answers are not silently rewritten. Server validation accepts only the documented
choices. Repository specialists retain their full evidence; preferences affect
the final synthesis. Unsupported assertions must remain marked unknown.

Capture starts only after a click. Cancel works while a permission dialog or
provider connection is pending. Late streams and providers are retired rather
than attached to a stopped session. Navigation releases audio; closing or clearing
an answer feed cancels its active work and retries. The automatic screen-solving
path requires Auto to be enabled. Repository watching has its own explicit control.

## Privacy and capture limits

The desktop shell requests platform content protection and supports click-through
and window hiding. Focus mode changes appearance and motion only. App renaming
changes presentation, not process visibility. A connected second device is not
an air-gapped device.

Microsoft explicitly documents that display affinity protects against a specific
set of capture APIs and does not guarantee protection in every capture scenario.
The browser itself provides no equivalent guarantee for this page. Test the exact
OS, capture app and sharing mode you intend to use; never describe this as
universally undetectable. See [Microsoft's display-affinity contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
and [Tauri's window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#setcontentprotected).

Product analytics excludes the standalone workspace and its API URLs. Session
replay is disabled application-wide. Selected audio, screenshots, questions and
documents still go to the configured transcription/AI providers as needed.
Audio transcript and chat are transient tab state; resume/JD and mode documents
use the existing device preferences/storage. This is not a claim of secure RAM
erasure, zero provider retention or a timed forensic wipe.

## Feature roadmap mapped to the request

“Implemented” describes source capability, not a claim that live models or every
OS/device combination passed physical testing.

| Requested capability | Current state | Concrete next improvement |
|---|---|---|
| Standalone copilot, typed questions, domain navigation | Implemented in this release | Task-specific end-to-end evaluation with signed-in providers |
| Native system audio and optional microphone | Implemented; browser fallback depends on available audio sharing | Permission, sleep/wake and device-switch matrix on Mac/Windows |
| Resume/JD, mode documents and behavioral stories | Implemented | Native PDF/DOCX extraction with visible source previews |
| Keyword/concise/deep answers, tone, possible follow-ups | Implemented in this release | Rubric-score every format on the same question set |
| Screenshot repository reconstruction | Implemented as partial evidence with gaps/conflicts | IDE adapter for exact files, revisions and unsaved buffers |
| Requirements, navigation, debugging and review specialists | Implemented | Revision-scoped graph and validated patch previews with undo |
| Purpose-specific model evaluation and Jev classifier comparison | Harness implemented; live results required before choosing winners | Repeated quality/latency/cost trials and a reviewed routing policy |
| Remote laptop viewing/control and name/icon | Implemented; native preview requires device smoke test | Better video transport and TURN-backed cross-network validation |
| Streaming answers and latency telemetry | Implemented | First useful answer, p50/p95, cancellation and failure-rate dashboard |
| Question ledger and transcript-backed answer feed | Implemented | Cross-domain queue with explicit unaddressed sub-questions |
| Live, Mock Lab and Feedback | Implemented at `/interview`: dual-channel capture, production-pipeline tuning with held-out expectations, reviewed profile promotion/rollback and account-local session reports | Authenticated provider and device end-to-end evaluation |
| Voice mock interviewer and delivery coaching | Implemented at `/practice`: typed/microphone rehearsal, optional spoken questions, evidence-checked feedback, measured pace/phrase counts, report export | Live provider and physical microphone testing; no validated delivery score |
| Company intelligence | General freshness-aware routing exists; no dedicated company briefing workflow | User-chosen public sources, dates, citations and explicit refresh |
| Phrase exclusions, model hotkeys, haptics | Not implemented as complete controls | Add only with measurable user benefit and reliable platform support |
| Anti-proctoring spoofing, universal invisibility, sub-10ms wipe | No verified implementation or guarantee | Do not present these as product capabilities |

Vendor pages help identify workflow ideas, but their latency and invisibility
claims do not establish our own performance. LockedIn Duo also limits helper
actions to Duo itself; full laptop control is a different capability. See the
[Duo product description](https://www.lockedinai.com/lockedin-duo). Existing code
and benchmark comparisons are documented in `docs/aura-comparison.md` and
`docs/model-evaluation.md`.

## Stack and performance

The UI remains TypeScript, React and Next.js. Tauri/Rust owns native controls, with
a Swift sidecar for macOS audio. Python runs parts of release/evaluation tooling.
Changing the UI language does not remove provider round-trip, transcription or
generation time. Jev is a classifier for structured routing decisions, not the
model that writes explanations; evaluate it as one stage of the pipeline. See
[LangChain's Jev integration description](https://www.langchain.com/blog/building-a-harness-with-jev).

## Test the product

1. Sign in and open AI Copilot without starting a meeting. Submit a typed question;
   confirm a streamed answer and no microphone/screen permission prompt.
2. Ask the same grounded question using Keywords and Detailed. Check factual
   consistency, complete code when requested, and exactly three possible
   follow-ups only when selected. Refresh and verify selected preferences persist.
3. Start microphone capture, cancel during permission setup, then grant the late
   prompt. Capture must remain stopped. Repeat with system audio and provider
   connection delay. Navigate away and verify OS capture indicators stop.
4. Add a small repository and overlapping code screenshots. Ask for a call path,
   failing case and fix. Every cited path/line must match visible/imported evidence;
   uncaptured code must be marked unknown.
5. Clear or leave while an answer is streaming/retrying, then start a new question.
   Old tokens must not appear in the new answer. Test a provider failure and retry.
6. Test light/dark, keyboard-only navigation, narrow viewport and long answers.
   The composer, stop action and recoverable error must remain reachable.
7. Use two physical devices for remote approval, revoke, reconnect, held-key
   release, permissions and emergency stop. Record exact OS versions and displays.

Automated gates: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`,
the release-checker regressions, and the scoped premium UI audit. The deployed
release checker confirms the expected commit, feature identifiers and signed-out
protection on `/record`, `/copilot`, `/remote`, `/interview` and `/practice`. It does not substitute for live
ASR/LLM tests or physical-device capture/control testing.
