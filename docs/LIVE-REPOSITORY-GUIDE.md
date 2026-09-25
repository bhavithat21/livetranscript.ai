# Live repository copilot

## Supported workflows

`/interview/repository` is the permission-based hands-free workspace. Existing Repository navigation opens it through `/copilot?mode=repoInterview`. The legacy screenshot/multi-agent workspace remains at `/copilot?mode=repoInterview&classic=1`.

1. Confirm external AI and capture are allowed. Select interviewer/system audio, microphone for a mock interviewer, both separate channels, or screen-only with a preflight task.
2. Start the session. Then explicitly Share IDE, select a Desktop display in an updated native app, upload a screenshot, or import an authorized source folder. Prefer a selected IDE window; keep the assistant and confidential windows out of the observed surface. Whole-display capture can include unrelated content.
3. SAY NOW streams independently of code analysis. LOOK AT names a known file or requests missing evidence. CHANGE contains exact uniquely anchored preimages and proposed replacements. CHECK distinguishes observed differences from proven mistakes. VERIFY suggests allowed test/build commands without running them.
4. End stops observation, audio, and inference. Review feedback, then explicitly approve an export. Exports contain source text and conversation events; remove confidential material before sharing.

## Runtime architecture

The reducer maintains an ordered, bounded event journal and canonical partial repository snapshot. It reuses the existing overlap/conflict reconstruction engine. Observed code, proposed edits, candidate-visible edits and terminal evidence are separate. Conflicts retire old source anchors. Unknown paths and uncertain preimages do not become actionable edits. Model results carry question/evidence/code revisions; stale results are discarded.

The observer compares local thumbnails at 5 Hz, waits 400 ms for stability, and limits accepted captures to one per 1.4 seconds. It never sends raw video continuously. The browser implementation compares changed tiles; the read-only native module captures only its selected, leased display. Capture and inference are separate single-flight operations. A session caps extraction requests at 240 and guidance requests at 120. Errors pause or require explicit retry rather than looping. Small visual changes can still be missed; Capture now and screenshot upload force a fresh observation.

The speech lane and implementation/review lane run concurrently. New files update code context without repeatedly restarting the same spoken guidance. Role-specific deadlines are bounds, not promised latency. The model endpoint adds authentication, body bounds, same-origin checking, secret-safe errors, and a per-process rate limit; a distributed production limiter remains advisable for multi-region scale.

Context compilation sends bounded whole JSON records and source-line groups. It ranks lexical matches, visible-file recency, inferred text references, and test filenames. WeakMap caches avoid persisting private code. The graph is NOT a complete AST or execution-derived call graph. Capture confidence scores are NOT calibrated correctness probabilities.

## Models

The implementation reuses existing repository provider adapters and model policy. Optional server overrides:

- COPILOT_REPOLIVE_MODEL_SAY
- COPILOT_REPOLIVE_MODEL_PLAN
- COPILOT_REPOLIVE_MODEL_REVIEW

Use supported account model IDs and matching server-only provider keys. No client keys, arbitrary endpoint forwarding, hidden model download, or automatic production promotion is introduced. Laya/SemIf/OpenJev evaluation remains separate in PR #12. No local weights are bundled or claimed to be benchmarked. The current question normalizer only removes speaker/filler noise; complex ASR reconstruction still needs model-level evaluation.

## Verification semantics

A matching replacement means only that the text was observed. It does not mean the code is correct. A different replacement may be equivalent. A clipped region requires another observation.

Before a test run, Mark test started records code revision and supplies a unique printed marker. Print it on its own line, then run the test in the permitted IDE. Only terminal summaries after that marker are attributed to this revision. Further edits invalidate old test evidence. This is screen-observed evidence, not an independent execution attestation. The app never executes IDE commands or submits solutions.

## Replay and benchmarks

`/interview/replay` replays a labeled synthetic session or imports a validated event export without capture or model requests. The production reducer is reused. It supports stepped playback, feedback and explicit export. It is not a simulation of model quality or screenshot extraction accuracy.

`/interview/benchmarks` runs three public synthetic tasks against the exact live speech/code endpoints after explicit approval. It makes at most six provider calls, can be stopped, shows actual returned model identities, and exports measured request timings and outputs. Its mechanical contract checks are not patch-correctness scores. Inspect exported outputs before choosing models. Missing credentials yield failed rows, never a silent pass.

`scripts/repo-goldens.mjs` generates 24 small three-file fixtures (four bug families across JavaScript, TypeScript, Python, Java, Go and C#). CI compiles/runs their seeded bugs and reference fixes. These are real executable regression fixtures, not 24 large framework repositories and not model pass@1. Reference code is not sent to model trials.

The Repository live validation workflow builds the actual app, measures layout and captures screenshots/traces at 375/768/1024/1280/1440/1920/2560 CSS pixels. It verifies replay completion, feedback retention, no unintended capture/provider calls, and anonymous inference denial. Artifacts preserve evidence for review.

Desktop checks compile both macOS and Windows adapters and run native gate tests. Physical screen-recording permissions, multi-monitor changes, real audio, signed/notarized installer behavior and real provider quality require device/account validation. Compilation must not be represented as that validation.
