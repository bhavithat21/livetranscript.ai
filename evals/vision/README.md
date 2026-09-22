# Screenshot extraction measurements

This harness sends actual PNG images through the same `extractScreenEvidence` helper as `/api/copilot/repo-screen`: identical Claude request, system prompt, output budget, timeout and strict observation parser. It does not substitute transcript text for an image or treat mocked responses as model measurements. The current production extractor supports Claude; candidates must be model IDs your Anthropic API account supports.

Eight fixed synthetic editor views cover punctuation/indentation, paths and line numbers, missing gutters, folded blocks, obscured source, unknown filenames, conflicting captures, terminal/problem text, explicit EOF and screenshot prompt injection. Expected answers are never passed to the model. The renderer uses Next's existing optional Sharp dependency; install optional dependencies if Sharp is absent. Generated SVG layout/text are fixed. PNG hashes and the saved images expose any font or rasterizer differences across hosts.

Run ordinary offline parser/scorer/selection regressions without model credentials:

```bash
npx vitest run evals/vision/fixtures.test.ts evals/vision/select.test.ts
```

Preview every generated input and its expected output before paying for model calls:

```bash
VISION_BENCHMARK_RENDER=1 npx vitest run --config evals/vision/vitest.config.ts
```

This writes PNGs and `manifest.json` into `vision-benchmark-fixtures` (`VISION_BENCHMARK_ASSETS` overrides the directory) without contacting a provider.

Run a **paid, opt-in image benchmark** after configuring `ANTHROPIC_API_KEY` securely in the environment:

```bash
VISION_BENCHMARK_LIVE=1 \
VISION_BENCHMARK_MODELS=claude-sonnet-5 \
VISION_BENCHMARK_REPEATS=3 \
npx vitest run --config evals/vision/vitest.config.ts
```

Use comma-separated available Claude IDs to compare candidates. One candidate × eight frames × three repetitions makes **24 paid image calls**. `VISION_BENCHMARK_MAX_CALLS` is a preflight cap (default and maximum 96); the harness refuses to exceed it. Calls are sequential and candidate order rotates between repetitions. `VISION_BENCHMARK_REPORT` changes the default `vision-benchmark-report.json` path. Reports are checkpointed after every attempt and remain incomplete if interrupted. PNGs are saved beside the report in its `.images` directory.

Every attempt records the requested and actual model, input image hash, raw response, validated observation, isolated latency and provider token usage when available. Failed extraction retains model/token telemetry when the provider returned it, including truncated or invalid JSON responses; unknown usage is not zero cost. Failures remain failures, and their private raw response bodies are not stored in error diagnostics. Metrics include exact code character accuracy, exact line precision/recall, path precision/recall, line-anchor accuracy, invented paths, unsupported lines, false/missing EOF claims, terminal/requirement matching and retirement of conflicting previous captures. Self-reported model confidence is never a correctness score. A frame passes only when all its visible evidence matches, no unsupported evidence appears, and any required conflict remains explicitly unresolved.

Create a review template after a complete run:

```bash
VISION_BENCHMARK_PREPARE_REVIEW=1 npx vitest run --config evals/vision/vitest.config.ts
```

The template starts unapproved and cannot overwrite an existing review. Inspect the saved images against `fixtures.ts` and the raw responses. Fill `reviewer`, `reviewedAt` (an ISO date), set `reviewed: true`, mark each image's `legible` and `groundTruthCorrect` checks, and list inspected `reviewedCandidates`. `rejectedSamples` optionally lists `requestedModel|fixture|repetition` entries that must fail despite an automatic match. The template's report hash binds that review to the exact report bytes. `VISION_BENCHMARK_REVIEW` changes its output/input path.

Compile the selection without making API calls or changing deployment settings:

```bash
VISION_BENCHMARK_SELECT=1 npx vitest run --config evals/vision/vitest.config.ts
```

The compiler recalculates scores from observations, verifies complete case/repetition coverage and saved PNG hashes, and requires a stable actual model identity. Defaults require all eight distinct cases, at least two repetitions, ≥95% exact-frame pass rate, ≤5% provider errors and P95 extraction latency ≤12 seconds. The fastest eligible candidate wins; if none qualify, the policy is null and routing remains unchanged. `VISION_BENCHMARK_GATES` can supply a JSON quality-gate object; runtime minimums still require ≥3 cases, ≥2 repetitions, ≥90% pass rate and ≤10% errors. Gates represent product targets, not measured achievements.

The `policy` field in `vision-benchmark-selection.json` is compatible with `COPILOT_REPO_BENCHMARK_POLICY` version 2. Merge its `roles.vision` into a reviewed text-role policy if both exist; preserve each role's evidence hashes. A configured `COPILOT_REPO_MODEL_VISION` takes priority over the measured policy and must be unset for measured vision routing to apply. Selection output can be relocated with `VISION_BENCHMARK_SELECTION`.

These are small synthetic extraction measurements, not general visual intelligence rankings. They do not establish arbitrary browser-IDE accuracy, screenshot upload permissions, end-to-end speech latency, real repository correctness or monetary cost. Add representative, permissioned screenshots and inspect their ground truth before claiming production OCR quality. No live model scores are committed by this implementation.
