# Continuous coach: production failures, implementation, and release gate

Status: implemented locally on `codex/coach-answer-experience`, based on production `43a7bf3`. Not deployed. This is consented candidate-facing practice assistance with screen/audio evidence only.

## What was wrong

The clean YouTube production test captured 6:39 of a 36:13 interview, with tab audio, microphone off, and an explicitly assigned interviewer voice. It failed continuity: moving video kept code capture settling, an agreement tag displaced the technical request, later constraints were not retained, guidance failed without a useful reason, and the final transcript review lacked copilot outputs. The candidate progressed while the displayed AI answer stayed behind. This excerpt cannot establish overall candidate-versus-AI superiority.

Observed pre-change generation timings were 1.375/1.882 seconds to first text and 2.666/4.609 seconds to completion. They exclude transcription and question detection. The previous 0-captures/121-samples motion reproduction is the capture regression target; it is not a provider benchmark.

## Fixes and evidence

| Failure | Implementation | Verification |
|---|---|---|
| Motion starves readable code | Four-second maximum settling wait; preserve single flight, changed-only sampling and cadence | Moving three-tile video plus persistent code edits now triggers bounded captures over the same 30-second simulation; busy and unchanged cases also tested |
| Agreement tags become questions | Suppress statement-ending right/okay/correct; extract explicit requests after conversational prefaces; retain fragment/restart handling | Production wording and genuine questions in regression tests |
| Stable ASR packet mistaken for completed speech | Preserve provider end-of-turn metadata through transcript storage; a stable, unfinished Deepgram chunk uses the detector's longer stabilization fallback | Detection regression plus existing ASR/store tests |
| Constraint races the answer | Commit new finalized interviewer constraints before question dispatch; retain explicit constraints in versioned task state | Atomic-dispatch and stale-cancellation regression |
| Code analysis can be postponed repeatedly | Coalesce within the existing guide timer instead of resetting it for every observation | Existing real-time controller simulation suite |
| Dense or slow spoken answer | Direct 2–3-sentence prompt, explicit Sonnet thinking settings, streamed speech, bounded context and output | Provider-adapter settings tests; naturalness and real latency remain unverified |
| Unsupported JSON or invented edit | Stable provider JSON schemas; exact preimages, source references, permissions and command validators still run | API contracts reject fabricated code and implementation-on-hold patches |
| Generic guidance failure | Safe error categories: provider, timeout, schema, evidence, output limit, configuration and rate | Wire-format and redaction regression; logs contain only lane/model/category/duration |
| Basename requested as another unread file | Skip a unique bare navigation alias when its qualified path already has observed code; keep ambiguity and never merge file contents by name alone | Unique and ambiguous basename cases |
| Missing round comparison | Round history, separate opt-in local comparison records, bounded paired-review input, distinct proposals/edits/tests | UI history and bounded-record tests; human/provider review still required |
| Truncated recording blamed on candidate | Review instructions explicitly distinguish coverage gaps from performance | Prompt contract; generated review needs live acceptance |
| Distracting preview | Collapsed live preview; question and answer first, then copyable code change and verification | Component tests and Chrome fixture QA |

## Research and model choices

1. **Capture.** Browser video-frame callbacks provide frame-oriented metadata, but are not a solution to our starvation rule. We retained the existing inexpensive 4 Hz local sampler and corrected its gate, avoiding a 30 fps inference queue. Maximum wait is a local admission bound, not a promise that extraction completes in four seconds. [MDN video-frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
2. **Speech.** Deepgram distinguishes `is_final` (stable segment) from `speech_final` (detected endpoint). We preserve that distinction without dropping providers that lack endpoint metadata; those retain bounded stabilization. No speculative interim text is promoted to interviewer intent. [Deepgram endpointing](https://developers.deepgram.com/docs/understand-endpointing-interim-results).
3. **Immediate answer.** Existing reviewed/environment model selection remains authoritative. For the default Sonnet 5, talk explicitly disables thinking and allows 640 output tokens; code analysis uses adaptive thinking at medium effort with 6,000 total tokens. Sonnet 5 enables adaptive thinking by default and thinking consumes the output budget, so the previous 512-token talk cap was unsafe for that default. This is a configuration correction, not a measured quality win. [Sonnet 5 guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5).
4. **Fast-model comparison.** Haiku 4.5 is the explicit low-latency benchmark candidate, not an automatically promoted replacement. Anthropic recommends measuring model, prompt/output length and streaming together. We keep high-value code reasoning separate from concise speech. [Latency guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency), [model catalogue](https://platform.claude.com/docs/en/models/overview).
5. **Caching.** Stable system prefixes use ephemeral caching; changing screen evidence stays outside the breakpoint. Short prompts can miss the model's minimum cache length, so this change does not guarantee hits. No padding or cache-warming paid calls were added. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
6. **Reliable code guidance.** Provider constrained JSON reduces formatting failures. A stable schema avoids compiling a different grammar each question; the first use may still cost extra latency. Schema conformance does not prove a patch is grounded or correct, so all existing semantic checks remain. [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
7. **Technical answers.** The prompt now distinguishes RPC deadlines, keepalives, idle timeouts and background work. A keepalive does not extend an application deadline; spawned work needs appropriate cancellation semantics. The required expensive operation cannot be silently removed to fix a timeout. [gRPC deadlines](https://grpc.io/docs/guides/deadlines/), [keepalive](https://grpc.io/docs/guides/keepalive/), [cancellation](https://grpc.io/docs/guides/cancellation/).

## Validation performed

- PASS: 904 tests across 122 files in the final full suite, plus two subsequent opt-in/opt-out comparison lifecycle checks. Those verify that End stops screen/model work before audio finishes draining, and that code/AI history is saved only with the separate opt-in.
- PASS: 83 repository-coach contract checks.
- PASS: TypeScript, ESLint, strict UI audit (zero findings), and production build using Webpack. The existing optional `keyv/got` dynamic-dependency warning remains. Turbopack cannot use this worktree's external dependency symlink.
- PASS: Chrome isolated fixture at desktop and 390px: question correction, historical answers, grounded before/after display, pause/resume, no horizontal overflow, no captured warning/error logs. Fixture text/timing is explicitly synthetic and proves no provider performance.
- BLOCKED: real provider comparison; the opt-in benchmark exits before calls because this checkout has no `ANTHROPIC_API_KEY`. No new credentials were entered or fetched and no provider quality scores were invented.
- NOT RUN: deployed-version regression, physical microphone/screen-permission rerun, whole 36:13 round, or measured speech-end-to-answer latency on the revised implementation. Production remains unchanged.

Screenshots: [desktop](assets/coach-desktop.png), [390px mobile](assets/coach-mobile.png), [compact preview](assets/coach-preview.png). All use synthetic fixture answers and timings. Earlier pre-change evidence is in `round-evaluation/findings.md` in the parent workspace.

## Reproducible provider gate

With the existing approved provider credential configured in the test environment, run `COACH_BENCHMARK=1 pnpm eval:coach`. This explicitly incurs real provider calls. It generates 30 records across six authored scenarios and three repetitions, alternating order for immediate-answer variants. It compares prior generation settings, current settings, and pinned Haiku 4.5 on identical current prompts; deeper code cases validate the current path. It is not a full old/new deployment comparison or the YouTube transcript.

Results record returned model identity, input hash, exact generation settings, first-text/completion times, structural checks, output and rubric. Rubrics are withheld from the generator. Review correctness, constraints, source grounding, naturalness and useful next step blind to model labels before selecting a winner; structural checks cannot score these. No automatic routing changes or deployment occur.

Then replay the full video in a permitted preview with explicit interviewer assignment and comparison saving enabled. Require continuous screen progress, no stale question after a coherent replacement, correct constraint preservation, grounded proposals and distinct observed verification. Compare the candidate and AI only at matched questions with the evidence each had at that moment. Record speech endpoint, final-transcript arrival, question detection, request start, first useful text, completion and render time separately. No subsecond or “better than the interviewee” claim is justified before that run.
