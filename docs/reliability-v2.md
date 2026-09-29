# Reliability v2 — 0.1.14

## What changed

- Groq's retired Llama 3.3 is no longer the default fast/draft model or an automatic fallback destination. The default is `openai/gpt-oss-120b`. `COPILOT_DRAFT_MODEL` (or the fast tier) selects the draft; `off` disables it. Explicit model configuration is never silently replaced. The readiness check tests actual access, not just the presence of an API key.
- A stalled quick draft is cancelled as soon as the deep answer becomes ready; it cannot block that answer behind a separate provider timeout. Text-only drafts do not receive a screenshot.
- Live Interview wraps ASR with bounded reconnects: at most three recovery rounds per interruption, six per recorder run, and a shared 20-second recovery deadline. Each round uses the existing ordered provider fallback under an 8-second connection deadline. Only the failed network stream is replaced; there is no automated OS permission prompt or capture restart.
- Unsent PCM is kept only in memory, capped at two seconds / 512 KB, and drained at no more than 1.25x realtime. Already-sent audio is not replayed. Provider-accepted but unfinalized words may still be lost. Gaps are explicitly reported. Provider timestamps are offset through a connection timeline; utterance and speaker identifiers do not alias across automatic reconnects.
- Call audio and microphone failures are isolated. Failed channels have separate Retry buttons, preserving existing transcript rows. Permission flows remain serialized to avoid simultaneous OS pickers. A new ASR connection clears the selected interviewer voice instead of assuming diarization IDs identify the same person.
- Native macOS audio now forwards allowlisted helper lifecycle events over its existing channel. Unexpected helper EOF reaches the UI rather than leaving a recording illusion. Helper errors record numeric codes and fixed domains, not localized messages or captured content. Local helper logs move to `~/Library/Logs/LiveTranscript/native-audio.log`, rotated at startup above 256 KB with one prior file, permissions 0600. None of these events establishes a retrospective cause for an older crash.

## Verification and release gates

Diagnostics includes an authenticated model/token access check. It uses synthetic inputs and can incur small provider charges. A successful token mint does not prove speech recognition. The device checklist observes actual PCM, finalized speech, vision success, completed guidance, and finalized speech after reconnection. Its full 45-minute quality review and Stop/permission checks remain explicit user attestations, not automated proof. It does not run OS actions without user input.

`pnpm run build` runs paid live acceptance on Vercel production. Local/preview builds explicitly report `not-run` unless `LT_RUN_LIVE_ACCEPTANCE=1` is supplied. Paid acceptance is fail-closed: missing keys, unsupported model parameters, a source-mismatched vision fixture, or failed real ASR speech/reconnect probes blocks that build. The report at `/release-readiness.json` contains metadata only and always states `deviceVerified: false`.

The synthetic speech fixture is generated with eSpeak: "Can you explain this code?", mono 16kHz PCM, with one second of silence, gzip/base64 encoded. It contains no recorded person or user speech. Acceptance uses the real Deepgram and AssemblyAI adapters and the same recovery wrapper, with only the relative token route adapted for the Node test runtime. This is not a test of macOS screen permissions, Teams routing, or an entire real interview.

Run an authorized 45-minute mock on the actual installed Mac app before relying on it. Test each audio input, both together, screenshot changes, ASR reconnect, denied permissions, and Stop during reconnection. Export metadata diagnostics for any failure. The additional native lifecycle events require desktop 0.1.14; hosted JS reconnect and model checks can work with older desktop shells.

## Rollback

An unsuccessful new production build leaves the existing deployment serving. Revert this release's code (or restore the prior known-good Vercel deployment) if regression appears. Desktop changes remain an explicit preview until device acceptance; do not promote the stable updater solely because compilation passed.
