# Interview workspace

Route: `/interview`. Three accessible tabs: Live Interview, Mock Interview and
Interview Feedback. Navigation is available through AppNav and HomeMenu.

## Mock is a live-system calibration environment

Mock is NOT a separate candidate-practice interviewer. It mounts the same
`CopilotPanel` used by Live and calls the same `useCopilot` transport and
`/api/copilot/answer` endpoint. This keeps mode routing, model selection,
provider fallback, per-mode uploaded context and answer generation on the real
application path. No fake answer generator or expected-answer injection is used.

1. Load or paste a scenario transcript/interviewer question. Optionally dictate
   interviewer input through the existing ASR microphone path.
2. Supply held-out expected behavior and draft calibration instructions.
3. Open the actual copilot, select a mode and ask the test question, or enable
   its Auto mode for settled transcript questions. Standard answers are recorded
   as test results with request-to-first-text and completion latency.
4. Annotate a completed response as Pass or Needs work, with improvement notes.
5. Change instructions and replay. Reset copilot for a clean conversation when
   comparing configurations; all context/history/screen conditions must match
   for meaningful comparisons. A single test is not a statistical benchmark.
6. Apply to Live requires at least one manually passed, completed result with
   exactly the current draft instructions. Applying updates a versioned profile
   used by subsequent Live Interview requests. Rollback restores the preceding
   instructions as another revision. No automatic promotion is performed.
7. End the test to save its report in the separate Feedback tab. Export accepted
   examples as JSONL for a user-managed regression/training dataset.

Expected behavior is NEVER sent to the answering model; it is included only in
human review, explicit system-feedback requests and exports. Draft calibration
is an isolated React context; switching tabs does not publish it. Per-request
snapshots pin the instructions used by each observation. Cancelled requests do
not count as successful tests. Failed and empty responses cannot be passed or
published. Stream supersession/unmount is guarded against stale output.

Calibration is a bounded, separate server field, appended without replacing the
fixed mode/grounding rules or truncating existing mode instructions. It changes
response preferences, not model weights. No provider fine-tuning job is started.
The profile currently applies to `/interview` Live (not the separate `/record`
route). The Repository Interview multi-agent path bypasses ordinary copilot
answers and is explicitly outside this calibration scope.

## Live and feedback

Live supports separate call/system audio and candidate microphone capture,
permission confirmation, a timer, transcripts, export and End -> Feedback.
Browser/native capture and the existing copilot continue to be reused.
Live feedback evaluates captured candidate answers only when identifiable.
Tuning reports use kind `tuning` and feedback subject `copilot`: they evaluate
system output, failures, observed latency and proposed instruction changes,
never candidate performance. Older kind `mock` candidate-practice sessions
remain readable and retain their original feedback semantics.

The new Feedback system-evaluation rubric distinguishes human annotations from
verified correctness. Text-only output is not proof code was executed. Timing
is measured in the browser from answer-request start; ASR and pre-request
orchestration are excluded. Missing screenshots, retrieval documents and chat
history are disclosed. Reports include bounded scenario/output excerpts with
explicit truncation markers, and the 40,000-character review window still
labels partial coverage.

Tabs remain mounted. Switching away from Mock hides but preserves its panel;
ending closes it and cancels pending responses. Live and Mock cannot be active
concurrently. Workspace link exits and beforeunload are guarded; browser Back
and OS process termination are not fully preventable. Unfinished tests are
in-memory, not crash-recovery drafts. Review test annotations before ending.

## Data and security

API and page authentication remain enabled. Interview and answer endpoints
reject cross-origin browser requests. Calibration text is limited to 1,500
characters; mode instructions retain their separate 4,000-character allowance.
No public secrets, new provider accounts or dependencies are introduced.

Completed sessions: latest 20, account-scoped browser-local history. Test run
list: latest 20, in memory until report completion. Applied profiles and one
rollback snapshot: account-scoped localStorage, with same-tab/cross-tab updates.
These are NOT cloud sync and are not encrypted. Browser storage failure is
surfaced; the active profile can remain in memory but may be lost on reload.
Anyone with browser-profile access can read local data. Explicit exports may
contain private scenarios and generated responses; do not publish them blindly.
Raw audio is not saved here. Providers receive data needed for requested work.
Interview content remains excluded from client analytics and session replay;
server usage events contain dimensions/counts, not calibration text or answers.

## Verification

Required automated gates: TypeScript, full Vitest suite, ESLint, production
build and existing detection evaluation. Added regressions cover shared request
routing, expected-answer isolation, calibration snapshots, manual acceptance,
publication/rollback, account isolation, system-feedback subject validation,
malformed input, response failure and transcript/report limits.

Actual authenticated provider accuracy, browser microphone/system permissions,
macOS/Windows hardware capture, and visual keyboard/mobile/light/dark behavior
remain distinct verification tasks. Production release verification must match
the deployed commit via `/api/health`, not merely see a successful preview build.
