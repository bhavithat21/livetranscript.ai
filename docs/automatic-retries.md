# Bounded automatic retries

Scope: Live Interview / Repository Coach screen analysis and talk/guide/review requests. The older standalone answer/repository-specialist transports, ASR reconnection and native capture lifecycle are not changed by this patch.

The client transport owns retries. Each logical read request gets at most three HTTP attempts (initial attempt plus two retries), exponential backoff with jitter around 500ms then 1000ms, and its original total deadline: screen 18s, talk 9s, guide/review 30s. Retries consume the controller's existing per-minute and per-session request budgets. No writes, permission prompts, OS capture restarts or external actions are replayed. No provider is silently switched.

Retryable: recognized transport failures and HTTP408/429/500/502/503/504/529, unless the server explicitly marks a permanent failure. Retry-After seconds and dates are respected. A Retry-After beyond the remaining deadline stops instead of being shortened. Stops, pauses, source changes, stale-context cancellation and unmount abort waits and pending requests.

Permanent: authentication/authorization, unavailable model/configuration, rejected input, refusal, output truncation and completed invalid evidence. The screen extractor's existing single semantic correction remains; a returned validation failure has x-lt-retryable=false, preventing a new HTTP retry loop over it. Model invocations and billable work are not exactly-once: a network loss can hide a completed provider call, and the extractor may perform its existing semantic correction inside an HTTP attempt. Three HTTP attempts are not a claim of three maximum model invocations or zero additional charges.

Coach streams retry only before any delta/done was delivered. Partial answers never get a second generation appended automatically. They remain incomplete and need explicit user retry. Empty prematurely closed streams can retry; malformed JSON and unsupported events cannot. A successful done ends stream consumption immediately.

A metadata-only retry notice is visible even when diagnostic recording is disabled. When diagnostics are enabled, retry events include planned attempt/delay/status and terminal outcomes share the original operation ID. Server start events include the x-lt-attempt number, which is client-supplied and not an authoritative audit field.

When attempts or time/budget run out, existing manual retry controls remain available. This release does not claim to fix macOS permissions, native crashes, provider access, transcription gaps or content quality. Live-device/provider verification is separate from the deterministic failure-injection tests.

## Worked example: why a retry can stop before attempt three

The shared deadline includes request time and backoff. In
[`retryRead`](../lib/coach/retry.ts), the next delay is the larger of
`Retry-After` and jittered exponential backoff. The retry is rejected when
`delayMs + 250 >= remainingMs`; the 250ms margin is an admission check, not
a promise that the next request will finish in that time.

Consider a talk request with a 9,000ms deadline. Assume no visible output,
available request budgets, retryable errors and midpoint jitter
(`random = 0.5`), so the backoffs are 500ms and 1,000ms.

| Event | Elapsed time | Remaining time | Decision |
| --- | ---: | ---: | --- |
| Attempt 1 returns HTTP 503 after 2,000ms | 2,000ms | 7,000ms | Wait 500ms: 500 + 250 < 7,000 |
| Attempt 2 begins | 2,500ms | 6,500ms | Keep the original deadline |
| Attempt 2 returns HTTP 429 after another 3,000ms, with Retry-After: 4 | 5,500ms | 3,500ms | Stop: 4,000 + 250 >= 3,500 |

Only two HTTP attempts occur. The helper returns the last failure immediately
at the final decision; it does not wait until the deadline or shorten the
server's requested delay. The third attempt is an upper bound, not an entitlement.

A retry notice records a planned attempt. Cancellation during backoff or a
failed budget check after the wait can still prevent that attempt from starting.
When investigating, correlate the operation ID with server start events instead
of treating the notice alone as proof that another request reached the server.

The existing [retry tests](../lib/coach/retry.test.ts) cover shared deadlines,
Retry-After handling, cancellation during backoff and budget rejection. This
example explains the implementation; it is not a live-provider measurement.
