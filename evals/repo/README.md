# Repository specialist measurements

The repository agents use independent requests for requirements, implementation/debugging and review, followed by synthesis. The initial model is `claude-sonnet-5`, an operational default, **not a benchmark winner**. The screenshot extractor also uses this Claude model. Current model IDs and image capabilities were checked against [Anthropic's official model overview](https://platform.claude.com/docs/en/models/overview) and [vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision).

Configure each role on the server with `COPILOT_REPO_MODEL_REQUIREMENTS`, `COPILOT_REPO_MODEL_IMPLEMENTATION`, `COPILOT_REPO_MODEL_DEBUGGER`, `COPILOT_REPO_MODEL_REVIEWER`, `COPILOT_REPO_MODEL_SYNTHESIS`, and `COPILOT_REPO_MODEL_VISION`. Vision requires a Claude model and `ANTHROPIC_API_KEY`. Text roles support Claude via `ANTHROPIC_API_KEY`, OpenAI models via `OPENAI_API_KEY`, and Groq model families via `GROQ_API_KEY`. Configure actual account-supported IDs; no model is silently substituted when a provider fails. Returned model identities and failure states appear in the agent stream.

To collect live measurements (this makes paid API calls):

```bash
REPO_BENCHMARK_LIVE=1 REPO_BENCHMARK_MODELS=claude-sonnet-5 REPO_BENCHMARK_ROLES=debugger,reviewer npx vitest run --config evals/repo/vitest.config.ts
```

Add comma-separated model IDs to compare candidates. `REPO_BENCHMARK_REPORT` overrides the output JSON path. Each role/model runs three fixed scenarios: duplicate cancellation events, conflicting screen captures, and an HTTP error-propagation bug. Reports retain complete answers, actual provider model IDs, failures, isolated call latency, expected-path coverage, expected-concept coverage, explicit uncertainty and unsupported-execution-claim diagnostics.

These automatic scores are **heuristic proxies**, not execution-based correctness. Inspect each raw answer for sound reasoning, usable minimal patches, preserved unknowns and accurate navigation. The harness does not measure visual transcription or full interview performance. It records failures rather than assigning them to another provider. Normal unit tests never make live API calls.

After reviewing the report, route a role from measured results with server environment variable `COPILOT_REPO_BENCHMARK_POLICY`:

```json
{
  "version": 1,
  "reviewed": true,
  "roles": {
    "reviewer": {
      "model": "claude-sonnet-5",
      "samples": 3,
      "benchmarkId": "replace-with-the-actual-report-id"
    }
  }
}
```

The policy is administrator-supplied configuration, not cryptographic evidence that measurements occurred. Do not mark it reviewed until you inspect a real report. Explicit per-role model environment variables take priority. Roles without an approved measurement retain the documented default. Invalid or undersampled policies fail visibly. No benchmark results are included or invented by this implementation.

All agents preserve original provided evidence when synthesizing. Incomplete screenshot fragments remain uncertain; suggested patches are analysis, not applied edits. No tests in an interview repository are executed by these endpoints. Specialist calls have 28-second timeouts, synthesis 50 seconds, and the request has a 110-second cap. Cancelling the response also cancels provider requests.
