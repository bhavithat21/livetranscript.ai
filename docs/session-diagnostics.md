# Session diagnostics

Available from the Diagnostics button on Interview, Copilot and Record pages. The remote web UI is also loaded by the existing desktop shell, so this instrumentation does not require a new native binary. It does not collect OS crash dumps or grant/reconfigure permissions.

## Read the pipeline

The full instrumentation covers Live Interview's recorder and Repository Coach:

- audio start -> ready -> first_frame -> heartbeat -> stop/release
- transcription start -> ready -> first_partial / first_final -> heartbeat -> stop
- screen source selection -> ready -> first_frame -> 30-second gate/count summaries
- screen_model start -> success / validation category / provider HTTP status
- talk / guide / review start -> first_token (streaming talk) -> success / error / cancellation

A phase ready is NOT proof that data flowed. A capture stream with no new frames for 30 seconds gets a `stall` diagnostic, without stopping or restarting it. Silence is not treated as transcription failure. `speechDetected` is only an RMS-threshold heuristic, not speech recognition. Partials/finals count provider callbacks, not unique utterances or words. Existing record/copilot surfaces receive app-level diagnostics but are not claimed to have the same detailed live-recorder coverage.

## Correlation and privacy

Each webview/page lifetime has a random diagnostic session ID, distinct from the saved interview or coach session. Each instrumented request has an operation ID. Screen and coach HTTP requests pass these IDs in x-lt-session-id / x-lt-operation-id headers. Both client and server emit allowlisted metadata under `[lt-diagnostics]`. Client events are marked `origin=client` and have a server receipt timestamp; they are untrusted observations, not authoritative audits. No raw audio, screenshot, transcript, source, path, URL, question, answer, prompt, stack, raw error string, API key or user ID is accepted by this new diagnostics endpoint.

Vercel runtime logs: filter request path `/api/diagnostics`, `/api/copilot/repo-screen` or `/api/copilot/coach`; search the diagnostic session UUID. Compare the same operationId on both sides. High counts of screen invalid_language/invalid_lines etc indicate extraction/validator incompatibility. Repeated model HTTP404/503 indicates unavailable models/configuration. High first-token and total duration indicates provider/context/transport latency. Distinguish explicit/stale-work cancellation from deadline timeout before counting reliability failures. User feedback categories identify perceived latency, context and transcript issues, not verified defects.

Local history is capped at 600 metadata events and 24 hours. Cloud batching is capped at 25 events / 32KB per request; pending events at 100, with dropped-count reporting. Network reporting is best-effort, uses a five-second request timeout and backs off to 60 seconds. It never blocks model or capture tasks. Cloud receipt is acknowledged; the UI never calls a queued batch delivered. Restored local history is export-only, never silently uploaded after a later login. Backend retention is the hosting plan's retention, not an application guarantee. Endpoint auth, same-origin checks, size checks and a per-instance rate limiter apply; the limiter is not distributed.

Disable diagnostics to abort pending upload, clear the queue and local history. Already received server logs remain subject to backend retention. An in-flight upload can already have arrived before cancellation. Clear local history rotates the diagnostic session ID. Export diagnostics is metadata-only and separate from the source/transcript-bearing Repository Coach replay export.

## Verification

1. Open the current web UI, sign in, open Diagnostics and select Test cloud logging. Confirm the receipt and find the `upload_test` event in runtime logs.
2. Run a permitted mock session. Verify native/browser capture ready AND first frames, finalized transcription, extracted screen evidence and completed guidance.
3. Deny/cancel a screen or audio picker, disconnect the network, and stop a pending request. Verify the right stage/category without unmounting the diagnostic panel.
4. Disable logging and verify no new diagnostic requests occur. Export a bundle and confirm it contains no capture content or credentials.

Unit/CI validation does not replace those real-device/live-provider checks. Missing final events alone cannot prove a native crash; process termination or a fully frozen webview may prevent last events from being sent. The persisted local ring can help on reopening, but native crash reports still need separate collection.
