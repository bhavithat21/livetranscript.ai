# Local-first classification benchmark

This compares the real routing functions used by the app: local rules → legacy classifier, versus local rules → Jev → the same legacy fallback. Jev is a routing candidate, not a replacement for code generation, screenshot extraction or repository reasoning. It does not run a different prompt just to improve benchmark scores.

The 25 synthetic, hand-labeled utterances cover strong signals, ambiguous requests, candidate chatter, mixed repository/coding and repository/design tasks, and current external facts. Each has an expected mode, question flag, web flag and rationale. Exact accuracy requires all three decisions to match. A null is incorrect; a null on a real question also counts as a missed question. Review labels and add held-out real utterances with permission before interpreting this as interview performance.

## Run

Supply server secrets through your terminal environment or your CI secret store: `TYPESAFE_API_KEY` and either `OPENAI_API_KEY` or `GROQ_API_KEY` for the selected legacy model. Do not put keys in chat, source files, commands saved in shell history, reports or `NEXT_PUBLIC_*` variables. This runner does not automatically load `.env` files.

```bash
CLASSIFIER_BENCHMARK_LIVE=1 \
COPILOT_CLASSIFIER_MODEL=gpt-4o-mini \
TYPESAFE_MODEL=jev-latest \
CLASSIFIER_BENCHMARK_REPEATS=3 \
CLASSIFIER_BENCHMARK_REPORT=classifier-benchmark-report.json \
npx vitest run --config evals/classifier/vitest.config.ts
```

Use model IDs available on your own accounts. Both variants share the exact selected legacy ID. Defaults match production: Groq `llama-3.3-70b-versatile` when a Groq key exists, otherwise OpenAI `gpt-4o-mini`; Jev defaults to `jev-latest`. The report records requested IDs separately from returned model identities. Pin provider snapshots when available: an alias is not an immutable model. A returned identity change blocks a proposal.

The default is three repetitions, bounded to 1–5. The runner is sequential and alternates variant order between repetitions. Network calls only happen where the production local classifier abstains. With 25 fixtures and three repetitions, the absolute upper bound is 225 provider calls if every local decision abstains and every Jev call falls back; the actual total is usually lower. Each call may incur provider charges. Configuration is validated before any calls: a missing key or unsupported legacy provider produces a blocked JSON report and fails the command. Without `CLASSIFIER_BENCHMARK_LIVE=1`, the dedicated runner skips. Normal `npm test` never discovers this paid runner.

Reports are checkpointed after every row and contain the fixture, result/confidence, expected labels, path, actual provider attempts, uncertainty/error/fallback outcomes, timing and reported token usage. Provider error bodies and secrets are never recorded. Local decisions have no provider calls. Tokens missing from a provider response remain explicitly unknown; no price or dollar-cost estimate is invented.

## Read the result

For each variant, inspect `allUtterances`, `questionPath`, `networkAmbiguous`, `networkQuestions` and the category breakdown. These show exact and per-field accuracy, nulls, question/web false negatives, chatter false positives, fallback frequency, and p50/p95 latency. Local hits are separated so they cannot conceal slow Jev calls or double-call fallbacks. Latencies include the entire classification function path, but exclude browser HTTP/authentication, speech, question detection, web search and answer generation. These are not full product latency measurements. The additional correct-only latency view helps explain cases where fast failures lower the aggregate.

The report can propose Jev for human review only after both variants complete the same suite with at least three repetitions; Jev achieves at least 90% exact accuracy overall and on network cases; accuracy, missed questions/web facts, chatter activation and null rates do not regress; both providers return real model identities; and Jev's network p95 improves including fallbacks. Lower confidence or wrong answers do not qualify as a speed improvement. Inspect raw decisions and rerun on a separate representative set. Repeated synthetic prompts are not independent samples or statistical proof. `reviewed` and `productionChanged` stay false, and this benchmark never updates production environment settings.
