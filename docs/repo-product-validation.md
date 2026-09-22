# Repository assistant product validation

The product journey is: open Repo interview → upload or capture browser IDE views → preserve visible code and gaps → collect questions during discussion → navigate to relevant files → inspect specialist guidance → stop/retry or revisit an earlier answer.

## Recorded local validation — 2026-09-22

| Check | Result |
| --- | --- |
| Full application test suite | 289 tests passed across 44 files |
| ESLint | Passed with no errors or warnings |
| Production build and TypeScript | Passed |
| Release-check HTTP fixtures | Healthy release passed; wrong commit, missing feature and unprotected recording page correctly failed |
| Known-bug repository | Baseline: 1 pass / 2 failures; minimal patch in a disposable copy: 3 passes / 0 failures |
| Authenticated browser and live AI quality | Not run; model credentials and an authenticated test session are unavailable here |

These results cover local code and simulated provider boundaries. They do not certify the deployed release or live screenshot transcription and answer quality.

## Automated acceptance coverage

| Journey | Verified behavior | Test |
| --- | --- | --- |
| Read overlapping screenshots | Relevant code merges; a partial file becomes continuous only after the missing region and EOF are observed | `ScreenRepositoryPanel.test.tsx`, `screenEvidence.test.ts` |
| Work while questions arrive | New questions enter the ledger during an active analysis; settled questions drain in order | `CopilotPanel.test.tsx` |
| Select an earlier or repeated question | Selection, specialist tasks and retries retain the originating ledger ID even when two questions have identical wording | `CopilotPanel.test.tsx`, `useScreenRepository.test.ts` |
| Read history while work runs | Current analysis remains visible as a separate status; Stop current works without losing the selected answer | `ScreenRepositoryPanel.test.tsx` |
| Recover from failures | Retry retains the original question/task and rebuilds uploaded, screenshot, folder and transcript context | Both panel test files |
| Upload an invalid image | The newest error is visible, a valid retry recovers, and a late file read cannot restore a cleared session or start a request after leaving the panel | `ScreenRepositoryPanel.test.tsx` |
| Clear during analysis | Work is cancelled and late responses do not resurrect cleared evidence or answers | Panel and screen-hook tests |
| Follow the API pipeline | Two captured files flow through real parsing, reconstruction, specialist calls, synthesis and NDJSON response | `agentJourney.test.ts` |
| Lose a specialist | Its failure stays explicit; synthesis retains original source and other specialists' notes | Journey and orchestrator tests |
| Receive incomplete output | Refusal, filtering, unfinished streams and empty answers cannot mark a question successfully answered | Provider, journey and screen-hook tests |
| Interrupt an upload | Aborted/stalled request bodies stop before a model call; even a valid JSON prefix cannot become a completed timed-out upload | `agentHttp.test.ts` |

Run the product tests:

```bash
corepack pnpm exec vitest run components/copilot/ScreenRepositoryPanel.test.tsx components/copilot/CopilotPanel.test.tsx lib/repo
```

Run the release gates:

```bash
corepack pnpm test
corepack pnpm exec eslint .
corepack pnpm run eval:detection
corepack pnpm build
```

Component tests use a DOM test environment and simulated model/network responses. The API journey tests use the real application pipeline with only the authentication/telemetry and external model SDK boundary replaced. These tests demonstrate interaction and transport behavior, not browser rendering fidelity, OCR accuracy or reasoning quality.

## Verify the actual deployment

After pushing to the existing Vercel-linked production branch, wait for the deployment of that commit to succeed. Run the standard-library Python release check, replacing the SHA with the deployed commit:

```bash
python3 scripts/verify_deployment.py https://livetranscript.ai EXPECTED_COMMIT_SHA
```

This fails on an old release, absent feature identifiers, an unavailable homepage, or a signed-out recording page that does not redirect to sign-in. It never disables authentication or claims to test model output.

## Authenticated browser and live-model acceptance

Start with the included [known-bug repository](../examples/repository-cancellation/README.md). It has two source files, three executable acceptance cases, capture instructions and reviewer ground truth. The initial run intentionally has two failures; the minimal correct patch makes all three tests pass. Make a disposable copy and sign in normally. Configure the provider keys in the deployment environment; never paste keys into screenshots or the question field.

1. Open **Repo interview**. Capture the file tree, a partial function with its breadcrumb/gutter visible, its caller, and its tests. Include overlapping views. Inspect the evidence: compare exact identifiers, punctuation and line numbers with the original files. Unseen lines must remain missing.
2. Ask two questions while an analysis is running. Confirm both enter the ledger and finish in order with Auto enabled. Select the first answer, then cancel the next analysis using **Stop current**. Retry and confirm the original task and context are retained.
3. Change the captured function by inserting a line, then recapture. Earlier conflicting positions must be retired; the previous answer must show that newer evidence exists.
4. Ask for the root cause and smallest fix. Verify every referenced path and line exists in captured evidence. Compare the explanation to the actual caller, state transitions and failing test. Apply any proposed patch only to the disposable repository and run its tests yourself.
5. Stop sharing, deny a sharing request, upload an unsupported file, interrupt the connection and retry. Existing evidence must remain available after failure, controls must recover, and interrupted answers must remain incomplete.
6. Check desktop and narrow viewports at normal and enlarged text sizes. Confirm the question ledger, navigation, history, error messages and Stop/Retry controls remain reachable without clipped text.

Record real timings from question settled → preliminary navigation → first answer text → complete answer. Record OCR mismatches, incorrect citations, unsupported claims, patch correctness and test outcomes separately. A fast response or passing keyword score does not prove correctness.

Use the [model comparison harness](../evals/repo/README.md) for per-role measurements. Do not select a benchmark winner or claim live interview reliability until real model outputs and patches have been reviewed. Live model checks remain unrun in this workspace while API credentials and authenticated publication access are unavailable.
