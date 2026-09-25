# Evidence-driven repository coach

For practice and assessments/interviews explicitly permitting external AI. The app observes a selected source, suggests navigation and edits, and never submits an assessment, bypasses a platform restriction, writes repository files, or executes a suggested shell command.

## Entry points

- `/interview`: enable **Repository coding interview** before starting. Finalized interviewer audio feeds the same coach used in replay; candidate microphone text does not trigger investigations.
- `/interview/repository`: standalone coach, source/screenshot imports and replay controls.
- Mock Lab → **Repository replay**: load an exported event journal, move through observation checkpoints, inspect prior feedback, and explicitly re-analyze the selected checkpoint.
- `/copilot?mode=repoInterview`: classic screenshot/folder tooling remains available.

## Implemented pipeline

The browser or native selected display is sampled locally at 4 Hz. A stable-keyframe gate tolerates tiny caret blinking, detects persistent small edits, and emits at most one extraction request at a time. Captures have a 1.5 second minimum spacing, a 20/minute and 180/session ceiling, and an 18 second deadline. Stop and capture revocation invalidate outstanding work. Hashing/diffing is local; semantic interpretation still uses the configured screenshot provider. These are scheduling limits, not measured inference latencies.

The state reducer maintains bounded task, question, observation, partial file, navigation, proposed patch, observed edit, test-output and feedback records. Source IDs, capture timestamps and observed line ranges travel with source text. Overlapping screenshots merge only when anchors agree; edits retire old anchors conservatively. Late older screenshots cannot overwrite newer evidence. File imports are exact text but do not prove which editor view is open. Missing lines stay missing; confidence from extraction is a model-reported estimate, not a calibrated correctness probability.

Conversation and code guidance run concurrently. Talk streams independently; guide/review results are schema-validated before publication. The fast lane does not wait for a full repository analysis. Task/constraint changes refresh speech guidance and invalidate obsolete edits. A view confirmation must match a known requested path and observed range. Proposed edits require an exact current `before` region. Text matches to a proposal are not proof of correctness; different but potentially equivalent code is sent for review rather than automatically labeled wrong.

Context compilation uses bounded lexical/symbol-reference ranking plus observed paths, current view and test evidence. Cache keys depend on canonical observed content, not how overlapping screenshots were split. This is **not** a complete AST, type-resolved call graph, or proof of data flow. Budgets are measured in characters, not exact model tokens.

Test output is observation, not a command-execution attestation. **Mark test start** records a command label and code revision; the user then runs it in their own environment. Only fresh subsequent output may link to that marker. Later edits make results stale. Incomplete new-run output supersedes older terminal summaries, and one passing package cannot erase an earlier failure in the same run. Supported summary patterns include Jest/Vitest, pytest, TAP, Maven/Surefire, JUnit, unittest, dotnet, Rust and Go; unfamiliar output stays incomplete.

## Models and budgets

Server-only optional model overrides:

```
COPILOT_COACH_TALK_MODEL=<configured supported model>
COPILOT_COACH_GUIDE_MODEL=<configured supported model>
COPILOT_COACH_REVIEW_MODEL=<configured supported model>
```

Unset overrides inherit existing repository purpose models. Provider availability is validated; absent keys produce an explicit configuration error. Credentials never enter replay JSON. The controller permits at most 12 requests/minute and 120/session, without automatic failure retries. Server rate limiting is per-instance and is not a fleet-wide billing guarantee.

Laya/OpenJev/SemIf evaluation remains separate (PR #12). No checkpoint is installed or selected here. End-to-end latency, battery impact, extraction accuracy and coding quality must be measured with actual configured providers and physical devices before making performance claims.

## Replay and feedback

Replay exports contain selected source text and transcript fragments, not raw screenshots/audio. The export dialog requires acknowledgment because code can be private; known credential patterns are redacted but redaction is not a guarantee that all secrets are found.

Loading is offline and paused. **Previous/Next observation** and the checkpoint slider rebuild only the evidence available at that point; future observations cannot leak into the context. Old model responses and user notes are reference-only. **Analyze replay** makes explicitly requested provider calls using that checkpoint. Feedback never automatically promotes a model, trains weights, or modifies production prompts.

## Reproducible validation

```
node --test scripts/test-repo-coach.mjs
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm run lint
pnpm run build
node qa/coach/server.mjs
python3 qa/coach/verify.py
python3 scripts/golden-repo-smoke.py --output qa-results/golden
```

The browser suite renders both the standalone coach and the real WorkspaceShell + LiveInterview + RepositoryCoach at 375, 768, 1024, 1280, 1440, 1920 and 2560 CSS pixels. It checks readable width, page overflow, no active chat composer, grounding, pause/end and repeated-question behavior. Audio, extraction and model boundaries are synthetic fixtures, not live provider or OS-permission tests.

For an offline browser renderer without network navigation, `node qa/coach/bundle.mjs` builds self-contained QA bundles. Set `COACH_OFFLINE_BUNDLES=qa-results/coach-bundles` when running `verify.py`; the report labels this mode explicitly. No production authentication is modified by the QA fixtures.

Golden fixtures are **24 authored micro-repositories**, four defect families across JavaScript, Python, Java, Go, C# and Rust. Their intentionally faulty baselines must fail and authored replacements must pass. They are not 24 framework-scale projects and do not measure model patch pass@1. Provider-backed eval steps that skip for missing keys are not quality passes.

## Desktop distribution

Native read-only capture uses explicit selected-display leases on Windows and macOS. New native commands require a newly built installer; a web deployment does not add commands to an old binary. CI runs native lease tests and platform compilation. Unsigned Windows and universal macOS test installers are separate from the signed/notarized release and updater process. Packaging success is not physical audio/screen permission validation.

## Remaining measured-release gates

- Real-provider end-to-end trials, held-out accuracy and cost/latency measurements.
- Representative multi-file framework tasks beyond authored micro-fixtures.
- Physical macOS/Windows permission, capture, heat/battery and installer checks.
- Licensed/calibrated local model selection, optional semantic ASR reconstruction and deeper static-analysis integration.
- Signed/notarized public installer publication where signing credentials are available.
