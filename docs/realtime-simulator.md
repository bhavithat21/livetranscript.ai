# Real-time simulator and bounded lesson learning

## Open the simulator

In the interview workspace, choose **Mock Lab → Real-time simulator**. This uses the same question detector, proactive scheduler, context builder, repository state reducer, patch validation, and `CoachController` as Live. Only the clock, speech/screen observations, and model transport are synthetic.

Controls: scenario, deterministic seed, Play/Pause, Next event, 0.5–4× speed, Run to end, Reset, Run all scenarios, and JSON export. Pausing the *timeline* freezes virtual time. A scenario's separate *coach pause* action tests real controller cancellation. No microphone, video, cloud model, credentials, or code execution is required. No simulator result is eligible to promote a lesson.

## What is tested

The 13 authored scenarios cover fragmented questions and candidate speech; duplicate screen/transcript events; follow-ups during streaming; a never-settling non-cooperative adapter; pause/resume; late screenshots; divergent edits and stale passing tests; interviewer hold; ending a session with in-flight work; unsupported patch targets; failure with explicit retry; mixed-system-audio role selection; and imported source that must not count as screen navigation.

A seeded transport varies response timing; 25 seeds × 13 scenarios = **325 executions**, not 325 independently authored tasks. The virtual clock accelerates deterministic orchestration checks. Its timings are not real ASR, vision, network, or LLM performance measurements.

Run locally:

```sh
pnpm run test:simulator
SIMULATOR_REPORT=qa-results/coach/simulator-suite.json pnpm run test:simulator
node --test scripts/test-repo-coach.mjs
node qa/coach/server.mjs
# In another terminal, after installing the pinned Playwright runtime:
python3 qa/coach/simulator.py
```

The repository-coach CI runs these alongside the existing Live and responsive checks. Reports carry `providerInference: false`, seed, delivered events, request outcomes, validation failures, and per-scenario assertions. Incomplete or invalid runs cannot report success. Browser validation covers seven widths, real-time play/pause/step, running all scenarios, no page overflow, and no provider requests.

## Reproduced bugs and fixes

1. **Non-cooperative transport hangs a lane forever.** Aborting the controller did not settle an adapter's unresolved promise. The controller now races completion against cancellation/deadline, releases its lane, consumes late failures, and refuses late content.
2. **Resume leaves an interrupted question unanswered.** Duplicate protection incorrectly suppressed the original pending work after pause. Resume remembers only interrupted lanes and scheduled guidance and restarts those once; completed lanes and failed requests do not silently retry.
3. **Imported files falsely confirm navigation.** Having a file in context does not mean the user opened the requested editor region. File-import evidence no longer satisfies screen navigation, and replay preserves that source origin.

Additional guards snapshot role-tagged dialogue before answering, prevent disposed controllers from accepting new actions, and avoid resetting deduplication for an unchanged lesson policy.

## Feedback loop

The coach's Learning loop is account-scoped device memory. Useful/Needs work reviews and failed requests supply aggregate diagnostics. Candidate speech, visible source, generated patches, and actual terminal observations remain distinct.

Learning is **off by default**. It can be run explicitly or opted into while the coach is paused/ended. An evaluator proposes one of five reviewed, closed-catalogue tactics rather than arbitrary prompt text. Before activation, it compares the existing and candidate policy on six separate authored scenarios, twice each, using the configured coach generator and a separately configured judge. The generator never sees the evaluation rubric. A complete evaluation requires 37 model calls at most (one proposal plus 12 × two answers and one judge); provider charges apply. Cancellation, errors, incomplete reports, malformed results, or failed quality/grounding/latency checks leave the active policy unchanged. Rollback and the last 20 audit entries are visible.

Set `COPILOT_LESSON_JUDGE_MODEL` to a supported, independently configured model distinct from the relevant coach generators. Its provider must also have valid server credentials. Do not put keys in browser code, fixtures, or exports. Missing configuration fails closed with an actionable error. Tests use injected responses and do not establish that a tactic improves real-model results.

This is **prompt calibration, not model-weight training**, independent code execution, or guaranteed improvement. Repeated reuse of a small evaluation set can overfit. Larger unseen tasks, human review, and physical-device tests remain necessary before broader rollout. Active sessions keep their current policy until paused/restarted; no tuning happens in the critical answer path.

## Video test boundary

Mock Lab → Video test opens a validated YouTube reference or opt-in embedded player. Select the video's tab/system audio and the permitted coding display through normal browser/desktop capture controls. Both recorded people are on system audio: explicitly select the interviewer voice before enabling video-test answers. Captured speech and screen feed the real Live controller. The page does not silently download videos, bypass sign-in, assume speaker identities, or synchronize a hidden media player.

Automated retrieval of the user's referenced public video was blocked by YouTube's sign-in/bot check. No audio or video from it was available for end-to-end acoustic/vision/model evaluation. The simulator is a separate, reproducible system test and must not be described as successful YouTube playback. Uploading an authorized short recording and providing real provider credentials to a suitable test environment would allow those independent evaluations.
