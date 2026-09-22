# Repository purpose benchmarks

Use external coding rankings to shortlist candidates, then measure this application's actual tasks before selecting a model. [Candidate research](candidates.md) and [dated source metadata](candidates.json) distinguish BenchLM's published scores from verified provider IDs, prices and LiveBench task results. A leaderboard rank never enters this suite's correctness score or runtime policy. The existing `claude-sonnet-5` default remains an operational choice until a candidate qualifies on reviewed local results.

## What is measured

| Purpose | What a reviewer must establish | Runtime role |
| --- | --- | --- |
| Requirements | Every question/constraint captured; facts separated from assumptions | `requirements` |
| Navigation | Correct observed file/symbol/line targets and an ordered next evidence request | `requirements` |
| Implementation | Minimal correct change, compatible data flow and focused verification | `implementation` |
| Debugging | Supported root cause, appropriate fix, meaningful reproduction/tests | `debugger` |
| Review | Evidence-supported risks, constraint violations and missing tests | `reviewer` |
| Synthesis | Reconcile original source with deliberately incorrect and failed specialist notes | `synthesis` |

Six distinct, versioned source scenarios cover duplicate cancellation events, conflicting screenshots, payment error propagation, a tenant boundary, stable pagination and stale search results. Every scenario has purpose-specific expected behavior and an explicit uncertainty rubric. The suite uses the production system prompts and provider settings. Synthesis calls the production streaming path and receives original source plus fixed notes, allowing its judgment to be compared independently of upstream model quality.

The suite retains raw answers, source/prompts, actual returned model IDs, repeated trials, errors, p50/p95 complete-response latency, synthesis time to first token, reported input/output tokens, output/reasoning settings, suite hashes and the code commit. Missing provider usage stays unknown. Keyword/path coverage is retained only as a diagnostic; it cannot select a model. No generated code is executed. Correctness comes from documented human review against the supplied source and answer keys, not a claim that patches passed executable tests.

Image transcription is a [separate vision suite](../vision/README.md). This text suite does not measure OCR, transcription, speech-to-answer latency, complete repository reconstruction or an end-to-end interview. Jev question-routing quality is also a separate task; a coding leaderboard cannot establish classifier accuracy.

## Collect an explicit, bounded run

Provide account-supported model IDs and provider keys through the shell environment or secret manager: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`. The benchmark does not read browser credentials, fetch production secrets or automatically load `.env.local`. Nothing runs against a provider in normal `npm test`.

Start with two candidates for debugging and review. The plan is offline and shows key presence, not key values:

```bash
export REPO_BENCHMARK_MODELS=claude-sonnet-5,gpt-5.6-sol
export REPO_BENCHMARK_ROLES=debugger,reviewer
npm run eval:repo:plan
```

This produces `benchmark-results/repo-plan.json`: **48 calls** (2 candidates × 2 purposes × 6 distinct cases × 2 repetitions). Review the account cost before enabling live collection:

```bash
REPO_BENCHMARK_LIVE=1 npm run eval:repo
```

The full six-purpose run makes 72 calls per candidate. Candidate order rotates between scenarios/repetitions, and calls run sequentially to reduce provider contention. Production specialists run in parallel, so these timings describe isolated model calls. Every trial checkpoints `benchmark-results/repo-report.json`, including failed calls. A stopped or partial run cannot drive selection. A completed response must include a valid actual model identity; incomplete or truncated generation counts as an error without silent fallback.

| Variable | Default / use |
| --- | --- |
| `REPO_BENCHMARK_MODELS` | Required comma-separated API model IDs |
| `REPO_BENCHMARK_PURPOSES` | All six purposes; takes priority over legacy `REPO_BENCHMARK_ROLES` |
| `REPO_BENCHMARK_ROLES` | Optional subset; `requirements` expands to question capture + navigation |
| `REPO_BENCHMARK_CASES` | All six IDs in `fixtures.ts`; optional subset for investigation |
| `REPO_BENCHMARK_REPETITIONS` | `2`, allowed 1–10; a one-repeat investigation is ineligible for selection |
| `REPO_BENCHMARK_MAX_CALLS` | `200`; exceeding the cap fails before paid calls |
| `REPO_BENCHMARK_SEED` | `repo-purpose-v2`; controls reproducible scenario order |
| `REPO_BENCHMARK_REPORT` | `benchmark-results/repo-report.json` |
| `COPILOT_REPO_MAX_OUTPUT_TOKENS` / `COPILOT_REPO_REASONING_EFFORT` | Same production settings, recorded in every report |

Use a new report path for each run; collection checkpoints replace the chosen path. Pin stable model IDs where available. If an alias returns different actual models between repeated trials, it cannot qualify. The emitted policy uses the actual returned model ID, not a moving alias. Changing source cases, prompts, provider settings, retrieval or models calls for a fresh run; this small local suite is not proof of general superiority across arbitrary repositories.

## Review correctness and select per purpose

```bash
npm run eval:repo:review
```

This creates `benchmark-results/repo-reviews.json` plus a readable `.md` review packet containing source, raw responses and exact criteria. An existing review JSON is never overwritten. Read each source case and answer; set `reviewer` and an ISO `reviewedAt` timestamp after collection. For **each criterion of each completed response**, record `outcome: "pass"` or `"fail"` and a concrete evidence note (at least ten characters). Keep failures in the report. Provider errors already count as failed trials and need no invented answer review.

```json
{
  "root-cause": {
    "outcome": "fail",
    "note": "The answer treats abort() as sufficient, but the supplied fetcher can ignore the signal."
  }
}
```

The report hash, response hashes and current suite hash bind each review to what was measured. Editing answers, deleting errors, reusing an older review, incomplete criterion checks or substituting repeated copies of one case all fail validation. Hashes protect consistency; they do not cryptographically prove that an administrator ran a provider or reviewed an answer honestly.

```bash
npm run eval:repo:select
```

Default eligibility requires **at least 3 distinct cases × 2 repetitions per purpose, 100% reviewed case correctness, zero provider errors and p95 latency ≤ 50 seconds**. The normal run covers all six cases. Requirements must pass both question-capture and navigation evaluations. The selector ranks qualifying candidates by reviewed pass rate, error rate, then p95 latency. This chooses the strongest observed candidate within the sample; near-ties are not statistically conclusive. Costs are not inferred from tokens or stale price tables.

The selector writes comparison JSON/Markdown and `benchmark-results/repo-policy.json`. If nobody qualifies, it writes an empty policy and exits unsuccessfully so a stale local winner cannot survive unnoticed. Roles without evidence retain their operational default. Optional `REPO_BENCHMARK_GATES=/path/to/gates.json` allows stricter task budgets or explicit quality tradeoffs, with hard floors of 3 cases, 2 repetitions, 90% pass rate and at most 10% errors. `REPO_BENCHMARK_REVIEWS`, `REPO_BENCHMARK_SELECTION`, and `REPO_BENCHMARK_POLICY_OUTPUT` override artifact paths.

## Apply a reviewed policy

Selection is offline and **does not change production configuration**. After inspecting the comparison and raw answers, set the generated v2 JSON as the server-only `COPILOT_REPO_BENCHMARK_POLICY`. A separately reviewed vision policy can contribute its `roles.vision` entry; retain its own evidence hashes. Do not replace text-role evidence with vision scores.

Runtime validates distinct-case/repetition counts, purpose coverage, quality gates, evidence hashes and the reviewed metadata before labeling v2 routing `measured`. Legacy v1 configuration remains compatible but is labeled `configured`, because three arbitrary samples do not establish measured correctness. Explicit `COPILOT_REPO_MODEL_REQUIREMENTS`, `_IMPLEMENTATION`, `_DEBUGGER`, `_REVIEWER`, `_SYNTHESIS`, and `_VISION` settings always take priority; remove a role override deliberately if the measured policy should control it. Vision remains restricted to Claude models in this application.

The report and review are local evaluation artifacts. No live results, winners or confidence claims are checked into this implementation. Regression tests use clearly identified synthetic in-memory reports and never publish them.
