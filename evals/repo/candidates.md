# Candidate models for repository assistance

Verified on **2026-09-22**. This is a shortlist for experiments. No model in this document is a measured winner for this application, and this document does not change production routing. API IDs are verified against provider documentation; access, quota and availability on this project's accounts remain unverified until a real request succeeds.

## External evidence

[BenchLM's coding page](https://benchlm.ai/coding), refreshed September 21, ranks Fable 5.1 first at 84.6, Fable 5 second at 77.9 and GPT-6 Astra third at 77.0. These are BenchLM's calibrated category scores, not this application's success percentages. Its displayed coding weights are SWE-bench Pro 50% and LiveCodeBench 50%; coverage differs by model. Use the leaderboard to choose challengers, then measure our own tasks.

Coding rank cannot establish screenshot transcription accuracy, missing-file restraint, file-and-line navigation, question recall, or latency while an interviewer is speaking.

## LiveBench: separate coding tasks from repository work

The current site selects the **2026-06-25** release. Its public [task results CSV](https://livebench.ai/table_2026_06_25.csv) and [category definition JSON](https://livebench.ai/categories_2026_06_25.json), retrieved September 22, 2026, contain 59 model configurations across 23 tasks and seven categories. Both files returned `Last-Modified: Tue, 22 Sep 2026 05:39:32 GMT`. This is the question-set release and file update time, not a claimed execution date for every model. Source URLs and SHA-256 hashes are retained in `candidates.json`.

| Evaluated configuration | Coding mean | Agentic coding mean | JavaScript | TypeScript | Python |
| --- | --- | --- | --- | --- | --- |
| `claude-fable-5-1-max-effort` | 86.38 | 66.06 | 68.18 | 60.00 | 70.00 |
| `claude-fable-5-max-effort` | 85.99 | 62.17 | 68.18 | 53.33 | 65.00 |
| `gpt-6-astra-max` | 80.36 | 57.32 | 63.64 | 43.33 | 65.00 |
| `claude-opus-5-max-effort` | 81.44 | 65.20 | 77.27 | 43.33 | 75.00 |
| `gpt-5.6-sol-max` | 83.94 | 56.21 | 63.64 | 50.00 | 55.00 |
| `gpt-5.6-terra-max` | 78.25 | 54.95 | 68.18 | 46.67 | 50.00 |
| `gpt-5.6-luna-max` | 82.92 | 48.43 | 63.64 | 36.67 | 45.00 |
| `claude-sonnet-5-xhigh-effort` | 80.68 | 59.39 | 68.18 | 50.00 | 60.00 |

Means above are our arithmetic calculations from the published task columns: coding combines completion and generation; agentic coding combines JavaScript, TypeScript and Python. These are external scores under the named effort settings. They are not measurements at our live request deadlines. Haiku and Groq GPT-OSS entries were absent from this release; no missing score was filled in.

This changes what to test: Fable 5.1 is a strong TypeScript challenger, while Opus 5 deserves a direct JavaScript/Python comparison. High completion scores alone do not establish multi-file debugging skill. LiveBench's `logic_with_navigation` task is a logic/spatial problem, not file navigation. Its instruction-following `summarize` task is not the same as our evidence-grounded specialist synthesis.

The [LiveBench paper, v2 (April 18, 2025)](https://arxiv.org/abs/2406.19314v2) describes refreshed questions with objective ground-truth scoring. The [official changelog](https://github.com/LiveBench/LiveBench/blob/main/changelog.md) records agentic coding's switch to Mini-SWE-Agent and a 250-step limit on October 3, 2025. Preserve harness, effort and dataset versions in comparisons. The repository README's older release note does not override the live site's newer data. The [external cost CSV](https://livebench.ai/cost_2026_06_25.csv) uses some prices that differ from today's provider catalogs; use actual token usage and current provider rates for our cost decisions.

## Verified candidates

Prices below are published USD per million uncached input/output text tokens on the verification date. They are comparison inputs, not an invoice estimate; caching, service tiers, long-context multipliers and actual usage can change cost. Every candidate needs an account access check. `candidates.json` holds the same shortlist as metadata, not runtime configuration.

| API model ID | Provider | External coding rank / score | Published input / output | Initial experiment |
| --- | --- | --- | --- | --- |
| `claude-fable-5-1` | Anthropic | 1 / 84.6 | $10 / $50 | Hard multi-file debugging and adversarial review |
| `claude-fable-5` | Anthropic | 2 / 77.9 | $10 / $50 | Optional comparison with Fable 5.1 |
| `gpt-6-astra` | OpenAI | 3 / 77.0 | $10 / $50 | Hard debugging and independent review |
| `claude-opus-5` | Anthropic | 4 / 76.6 | $5 / $25 | Implementation, debugging, review |
| `gpt-5.6-sol` | OpenAI | 5 / 75.2 | $4 / $20 | Implementation, debugging, review |
| `gpt-5.6-terra` | OpenAI | 7 / 68.2 | $2 / $12 | Balanced repository explanation |
| `gpt-5.6-luna` | OpenAI | 10 / 67.8 | $0.20 / $1.20 | Fast requirements and synthesis challenger |
| `claude-sonnet-5` | Anthropic | 13 / 64.8 | $2 / $10 | Existing operational baseline |
| `claude-haiku-4-5-20251001` | Anthropic | Not recorded | $1 / $5 | Requirements, navigation and screenshot challenger |
| `openai/gpt-oss-120b` | Groq | Not recorded | $0.15 / $0.60 | Low-cost grounded explanation challenger |
| `openai/gpt-oss-20b` | Groq | Not recorded | $0.075 / $0.30 | Low-cost requirements and synthesis challenger |

The rank/score column is a dated selection from [BenchLM](https://benchlm.ai/coding). IDs, modalities and pricing come from [Anthropic's catalog](https://platform.claude.com/docs/en/models/overview), [Fable 5.1's overview](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Fable migration examples](https://platform.claude.com/docs/en/models/fable-5-1/migration-guide), [OpenAI's catalog](https://developers.openai.com/api/docs/models), and [Groq's production model list](https://console.groq.com/docs/models). OpenAI notes Sol pricing is promotional through at least November 21, 2026 on its [model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

Groq publishes roughly 1,000 tokens/sec for [GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b) and 500 for [GPT-OSS 120B](https://console.groq.com/docs/model/openai/gpt-oss-120b). Those provider figures do not measure our network overhead, first useful answer, reasoning time or complete specialist pipeline. Llama 3.x entries are currently listed with enterprise/contact-sales pricing, so they are not treated as known low-cost alternatives here.

## Select by purpose

These candidate assignments are engineering hypotheses. Keep the same evidence and success rubric for all candidates in a comparison.

| Purpose | Candidates to compare first | What must pass before latency wins |
| --- | --- | --- |
| Question and task routing | Existing local classifier, optional Jev | New-question and follow-up recall; revision handling; false-trigger rate; useful abstention |
| Screenshot extraction | Sonnet 5 baseline; Haiku 4.5, Opus 5 challengers | Exact code/path transcription; line ranges; no invented hidden files; explicit unreadable regions |
| Requirements and navigation | Haiku 4.5, Luna, Sonnet 5, GPT-OSS 20B | Capture all constraints and point to supplied files/symbols; preserve uncertainty |
| Implementation | Opus 5, Sol, Sonnet 5; Fable 5.1 challenger | Correct scoped change; interfaces preserved; acceptance checks pass |
| Debugging | Opus 5, Sol, Astra, Fable 5.1 | Explain causal chain across files; reproduce and fix the actual failure |
| Independent review | Different provider/family from implementer when available | Find seeded defects; avoid unsupported accusations; identify missing test coverage |
| Synthesis | Luna, Haiku 4.5, Sonnet 5, Terra, GPT-OSS 120B | Resolve specialist disagreement using evidence; concise navigation and defensible next step |

Jev's `jev-latest` uses structured `state` and `questions`, returning typed choice/score/yes-no results through its [TypeSafe API](https://docs.typesafe.ai/api). Evaluate it as a routing component against the current local baseline. It does not replace the generative model that writes explanations or patches. A remote classifier can make easy requests slower; measure the whole route before enabling it.

The current screenshot endpoint accepts Claude vision models only. OpenAI's documented image capability does not by itself make an OpenAI ID compatible with that endpoint. Groq's listed GPT-OSS candidates take text. Vision results must come from a separate image fixture run; repository-text scores must never promote a vision model.

## Request compatibility and fair comparisons

- The repository text adapter calls Anthropic Messages or OpenAI-compatible Chat Completions. `openai/gpt-oss-*` IDs must use the **Groq** base URL/key; they are not OpenAI-hosted model IDs.
- OpenAI Chat Completions uses `max_completion_tokens`, which covers both reasoning and visible output. `max_tokens` is deprecated. Record the actual model, effort, cap and completion status; a cap-induced incomplete answer is a failure. See the [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
- GPT-6 Astra supports text Chat Completions, but function calling requires Responses. Omit `temperature`, `top_p`, `top_logprobs` and `logprobs`. Astra accepts `low`, `medium`, `high`, `xhigh`, `max`; `none` is invalid. The GPT-5.6 models also support `none`. Use the model-specific [Astra guidance](https://developers.openai.com/api/docs/guides/latest-model) and [model catalog](https://developers.openai.com/api/docs/models), rather than copying a generic API example.
- For GPT-5.6, test `none` or `low` on simple classification and concise synthesis, and `medium` against `high` on difficult debugging. These are proposed test settings, not measured recommendations. The production setting must match the evaluated setting.
- Fable 5.1 always uses adaptive thinking. Anthropic's `output_config.effort` controls effort on Fable 5.1, Opus 5 and Sonnet 5; omit it for Haiku 4.5. Its `max_tokens` limit includes thinking and response text, so a tiny cap can bias results against thinking models. See [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Haiku 4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview), and [effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort).
- Groq GPT-OSS accepts `reasoning_effort: low | medium | high`. Do not pass `reasoning_format` for these models; it is unsupported. Their reasoning is separate from final content, and `include_reasoning: false` is optional. See [Groq reasoning](https://console.groq.com/docs/reasoning).
- Compare configurations under the same deployment deadlines and agreed spend ceiling. Retain failures, timeouts, missing usage and incomplete outputs in denominators. Measure first useful output as well as completion time; high aggregate coding quality cannot excuse missing the live interaction deadline.

## Promotion evidence

A valid promotion needs a local report with actual provider model identities, complete responses, fixed task fixtures, repeated trials, correctness review, latency distribution and token usage. Evaluate negative controls and held-out repositories as well as easy examples. Select the lowest-cost or fastest candidate that clears the quality and reliability gates **for each role**.

The accompanying metadata intentionally records `measuredWinner: false` and `accountAccess: "unverified"`. Never turn an external score into `reviewed: true` or copy it into the application's measured routing policy. No paid API calls were made to prepare this shortlist.

