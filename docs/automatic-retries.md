# Bounded automatic retries

Scope: Live Interview / Repository Coach screen analysis and talk/guide/review requests. The older standalone answer/repository-specialist transports, ASR reconnection and native capture lifecycle are not changed by this patch.

The client transport owns retries. Each logical read request gets at most three HTTP attempts (initial attempt plus two retries), exponential backoff with jitter around 500ms then 1000ms, and its original total deadline: screen 18s, talk 9s, guide/review 30s. Retries consume the controller's existing per-minute and per-session request budgets. No writes, permission prompts, OS capture restarts or external actions are replayed. No provider is silently switched.

Retryable: recognized transport failures and HTTP408/429/500/502/503/504/529, unless the server explicitly marks a permanent failure. Retry-After seconds and dates are respected. A Retry-After beyond the remaining deadline stops instead of being shortened. Stops, pauses, source changes, stale-context cancellation and unmount abort waits and pending requests.

Permanent: authentication/authorization, unavailable model/configuration, rejected input, refusal, output truncation and completed invalid evidence. The screen extractor's existing single semantic correction remains; a returned validation failure has x-lt-retryable=false, preventing a new HTTP retry loop over it. Model invocations and billable work are not exactly-once: a network loss can hide a completed provider call, and the extractor may perform its existing semantic correction inside an HTTP attempt. Three HTTP attempts are not a claim of three maximum model invocations or zero additional charges.

Coach streams retry only before any delta/done was delivered. Partial answers never get a second generation appended automatically. They remain incomplete and need explicit user retry. Empty prematurely closed streams can retry; malformed JSON and unsupported events cannot. A successful done ends stream consumption immediately.

A metadata-only retry notice is visible even when diagnostic recording is disabled. When diagnostics are enabled, retry events include planned attempt/delay/status and terminal outcomes share the original operation ID. Server start events include the x-lt-attempt number, which is client-supplied and not an authoritative audit field.

When attempts or time/budget run out, existing manual retry controls remain available. This release does not claim to fix macOS permissions, native crashes, provider access, transcription gaps or content quality. Live-device/provider verification is separate from the deterministic failure-injection tests.
