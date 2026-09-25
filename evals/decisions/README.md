# Interview decision-model evaluation

This is an isolated evaluation layer for TypeSafe Jev and explicitly selected,
Jev-compatible Laya/OpenJev servers. It does not change production routing, install
weights, capture a screen, execute code, or train a model. An HTTP-compatible API
is not evidence of equivalent model capability, probability calibration or license.

## Findings checked on 2026-09-25

- **Laya (`NandhaKishorM/laya`)** is an Apache-2.0 text decision engine, not a
  generator of spoken answers, source code or screenshot transcriptions. Its own
  documentation describes base checkpoint limitations on novel decision workflows
  and warns that confidence must be fitted and evaluated on domain data. The HTTP
  server supports `/v1/systemone`; explicit aliases include `english`,
  `multilingual`, and `typed-decisions`. Context and option budgets vary by
  checkpoint. Do not paste an entire repository into a small decision request.
- **OpenJev is an ambiguous project name.** `razorback16/openjev` is an Apache-2.0
  server with DiffusionGemma and small-encoder backends. `openjev/openjev` on
  Hugging Face is a separate open-weight decision checkpoint licensed CC BY-NC 4.0;
  its card asks commercial users to contact the publisher. `ekzhang/openjev-sglang`
  is a separate Jev-compatible server using a much larger Qwen deployment.
  `AlexWortega/openjev` is another checkpoint family. `openjev.com` now calls its
  browser experiment SemIf. Pin the exact repository, weights, revision, serving
  implementation and license; never treat these names as one interchangeable model.
- Jev/Laya/OpenJev `confidence` fields do not all have the same semantics. Laya
  documents normalized-entropy confidence and an `answer_confidence` field. The
  benchmark records the selected option probability and multiclass Brier loss,
  not a supposed probability of correctness derived from an entropy score.
- Published GPU or batched timings are not laptop latency guarantees. Download,
  warm-up, input length, quantization, ASR, vision, network and queueing remain
  separate costs. Nothing here establishes a sub-second end-to-end interview SLA.

Primary sources:

- https://github.com/NandhaKishorM/laya
- https://nandhakishorm.github.io/laya/docker/
- https://nandhakishorm.github.io/laya/staged-adoption/
- https://github.com/razorback16/openjev
- https://huggingface.co/openjev/openjev
- https://huggingface.co/AlexWortega/openjev
- https://github.com/ekzhang/openjev-sglang
- https://openjev.com/
- https://typesafe.ai/blog/introducing-system-one-models-and-jev

## Placement in LiveTranscript

Current code already has deterministic local classification and an optional
TypeSafe Jev server classifier. Keep those behaviors unchanged while evaluating
candidates. The candidate's role is the decision layer:

```
audio / permitted screen observations
  -> deterministic dedupe, boundaries, revision tracking
  -> bounded observed state + candidate actions
  -> optional decision model (route / inspect / abstain / flag)
      -> fast generative model: SAY NOW
      -> coding model + selected source evidence: LOOK AT / CHANGE
      -> observed edit + actual test results: CHECK / VERIFY
```

A closed-choice model can rank `OrderService.update` among observed targets; it
cannot discover an unobserved implementation or prove a patch is correct. Keep
suggested patches separate from observed code. Never allow a model's `DONE`,
confidence, or a comment saying "tests passed" to replace actual test evidence.
Duplicate suppression, cancellation, stale-revision rejection and execution
permission checks remain deterministic code, not LLM decisions.

For a real on-device implementation, a Tauri sidecar should own the runtime and
expose a narrowly scoped native bridge. A cloud Vercel function cannot connect to
127.0.0.1 on the user's laptop. This CLI can run on that laptop for measurement;
it is not the native bridge. Do not expose an unauthenticated local model server
to arbitrary web origins. Do not add a new cloud endpoint without permission to
send interview/repository information to it. Screen assistance is for practice
or environments where the interviewer/platform permits it.

## Run offline first

Requires Node.js 22; no packages or provider credentials are needed.

```sh
node --test evals/decisions/benchmark.test.mjs
node evals/decisions/benchmark.mjs --plan
```

The plan is explicitly `not-run` and performs zero network requests. Contract
tests use stub responses. They verify the harness, not Laya/Jev/OpenJev accuracy.

The 15 public synthetic cases cover routing, an instruction to delay coding,
following a known callee, not inventing a missing file, checking the requested
navigation target, an incorrect `||` edit, an equivalent reordered `&&` edit,
clipped code, unfinished tests, bounded test claims, and prompt injection.
These are smoke tests, not a representative or statistically powered benchmark.

## Run a selected real endpoint

First review the exact model/checkpoint license, endpoint access controls and
call cost. The server must already be running. No endpoint or weights are chosen
or downloaded automatically. Supply a token intended only for this endpoint;
the runner never reads or forwards TYPESAFE_API_KEY or other provider keys.

```sh
# Example for a Laya server already running locally (not an installation command):
export DECISION_BENCHMARK_APPROVED=1
export DECISION_BENCHMARK_URL=http://127.0.0.1:8000/v1/systemone
export DECISION_BENCHMARK_MODEL=english
# Set DECISION_BENCHMARK_TOKEN securely when your endpoint requires a bearer token.
export DECISION_BENCHMARK_REPETITIONS=1
export DECISION_BENCHMARK_TIMEOUT_MS=2500
export DECISION_BENCHMARK_HARDWARE='record actual CPU/GPU and memory'
export DECISION_BENCHMARK_CHECKPOINT='record actual immutable checkpoint revision'
export DECISION_BENCHMARK_QUANTIZATION='record actual serving precision'
node evals/decisions/benchmark.mjs --live
```

Use the actual served model ID and explicit `/v1/systemone` endpoint for a selected
OpenJev implementation or TypeSafe. Non-loopback HTTP, embedded URL credentials,
query strings, fragments and redirects are rejected. The model's reported ID is
required; extra/missing labels and invalid distributions fail closed. Real-server
schema compatibility is not established by the stub tests.

Repetitions are capped at three, requests are sequential with bounded deadlines,
responses have a size cap and there are no automatic retries. Requests contain
only `model`, `state` and `questions`; expected labels and fixture annotations
stay in the runner. Reports are created in `benchmark-results/` (or an explicit
DECISION_BENCHMARK_REPORT path) without overwriting an existing file. They contain
choices, probabilities, correctness, errors, provenance, per-category metrics,
HTTP p50/p95, and first-request time. Model errors are sanitized and count against
accuracy. Multiclass Brier loss is computed only for valid returned distributions.

A nonzero exit means an error or a smoke-case mismatch; it must not be treated as
proof that a model is generally unsuitable. A zero exit is not production approval.
Cold-start state is not inferred from first-request time. Hardware and checkpoint
metadata are operator-supplied rather than automatically detected. Repetitions can
hit provider caches, so do not misreport them as independent cold requests.

## Promotion criteria

Before routing Live through a candidate, collect an authorized, de-identified
interview dataset and split entire sessions/repositories across training,
calibration and held-out test sets. Include accents/ASR corruption, follow-ups,
incomplete screenshots, wrong-file navigation, equivalent edits, stale patches,
and noisy terminal output. Measure candidate-set recall separately: no decision
model can select the correct file when retrieval omitted it.

Compare the existing local classifier plus current hosted fallback with each
candidate on the SAME events. Report errors, abstention coverage, false edit
warnings, missed critical mistakes, p50/p95 end-to-end latency, memory and power.
Do not transfer a confidence threshold between providers. Start in consented
shadow mode; candidate results do not control the interface. Promote a narrowly
scoped role only after a reviewed result meets its accuracy/latency budget.
Maintain a rollback path. Keep code generation, screenshot extraction and actual
patch verification as separate evaluations.
