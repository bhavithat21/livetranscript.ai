# Interview studio

Entry point: `/interview`, linked from AppNav and HomeMenu. This is additive;
`/record`, existing copilot modes, remote assistance and native installers remain
available. The studio reuses the application's design tokens and audio adapters.

## Live interview

Choose a target role, seniority, focus, duration and optional background. Capture
system audio, microphone audio, both on independent streams, or enter typed turns.
A recording-permission acknowledgment is required before starting live audio.
System audio is labeled **Interviewer**; microphone audio is labeled **Candidate**.
Use headphones and verify attribution before generating feedback. Multiple remote
speakers share the interviewer label; acoustic bleed is not perfect diarization.

Optional live assistance opens the existing CopilotPanel only after the user says
AI assistance is permitted. The panel receives the labeled interview transcript.
Its generated suggestions are not part of the scored transcript. Its existing
optional microphone/context and screen features remain independent of the studio.

Recording has visible starting/recording/stopping/error states and can be stopped
without ending the session. The timer shows elapsed time and a configurable target;
reaching that target does not automatically stop the interview. End stops capture,
drains provider finals, includes any typed draft, and opens transcript review.

## Mock interview

Choose mixed, behavioral, coding or system-design focus; junior, mid, senior or
staff level; 15–60 minute target; and 3/5/8/10 questions. The server enforces a
maximum of 12 questions if called directly. Follow-ups count toward the limit.

The AI asks one question at a time. Answer with typed text or the existing microphone
transcription service. **Finish answer & next question** stops capture, includes the
typed draft and passes the answer history to the interviewer. Another question is
not permitted until an answer has been captured. Read-aloud uses the browser's
speech synthesis when available; recording cancels it to avoid feedback loops.
The mock mode deliberately does not show answer suggestions before answering.

## Feedback and history

After ending, correct text and speaker labels before requesting feedback. The
report includes a six-dimension scorecard, question-by-question strengths and gaps,
practice outlines, next steps and limitations. Scores are 1–5; unsupported or
inapplicable dimensions are **Not assessed**, not zero. An overall coaching score
is calculated only when at least two dimensions have verified evidence. Coverage
is shown with the score; this is not a hiring prediction.

Every scored dimension must cite a 12–500 character quote found in an actual
candidate turn. Interviewer text, resumes, generated suggestions and invented
quotes cannot support scores. Per-question evidence must come after that question
and before the next interviewer turn. The server computes the overall score; it
does not trust a model-provided overall. Matching a quote is an evidence check,
not a guarantee that the model's interpretation is correct. Live review follows
labeled interviewer turns, which may include conversational fragments rather than
complete questions. Transcript-only feedback cannot establish speaking confidence,
body language, word-level timing, code execution, or an employer's decision.

**Save to Library** explicitly uses the existing authenticated session storage.
No database migration is required. The full report is stored in the summary and
rendered as safe Markdown on the existing session-detail page. Speaker names are
preserved. Editing or regenerating after saving creates a new copy on the next
save; prior Library entries are not overwritten. The existing session deletion
and sharing controls continue to apply. Saving does not automatically share.

Markdown and JSON exports include the transcript and feedback, but omit background
resume/JD text. This feature does not auto-persist unsaved interviews in browser
storage. Reloading or leaving can lose unsaved work. No raw-audio recording file is
saved by the studio; configured speech/AI services process their respective inputs.
The interview route and API are excluded from client analytics and session replay.
The existing explicit save event contains a session ID, not the transcript.

## API and configuration

`POST /api/interview` accepts `action: question | feedback`, mode, settings, and
labeled turns. It requires a real signed-in user and matching Origin. Development
preview-auth stubs cannot spend AI quota. The endpoint reuses `OPENAI_API_KEY` and
the already-used `gpt-4o-mini` default. Optional `INTERVIEW_MODEL` selects another
OpenAI Chat Completions model supporting JSON mode. Existing transcription
credentials are still required for audio; typed mock sessions do not need STT.
No key is exposed to the browser and no new dependency is introduced.

Limits: 512,000 request bytes, 600 turns, 10,000 characters per turn, 100,000 total
transcript characters, 22,000 background characters. Oversized input is rejected,
not silently truncated. Provider calls have bounded output and a 45-second SDK
timeout. Client requests are cancelled after 55 seconds or when the interview ends.
Late AI responses cannot append questions to an ended or replacement session.
Provider failures leave the transcript available for retry/export.

## Verification

Dependency-light core checks:

```sh
node --test scripts/test-interview-core.mjs
```

Project checks (the existing Quality workflow runs on the feature pull request):

```sh
pnpm exec vitest run lib/interview components/interview app/api/interview
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Tests cover validation, speaker attribution, quote verification, aggregate size
limits, mock turn progression, API auth/origin/error handling, analytics privacy,
late AI responses, capture cancellation, and provider resolution after Stop.
Local core compilation and 16 Node smoke tests passed during implementation.
The full dependency-installed suite and real provider/device behavior require
separate verification; passing mocks is not a native-audio or model-quality test.

Before release, exercise browser tab-audio sharing and Windows/macOS loopback,
permission denial, audio-source loss, two-channel headphones capture, disconnects,
voice-to-next-question finalization, dark/native themes, keyboard-only and narrow
layouts, authenticated feedback, Library persistence and export. No desktop-native
source is changed, but the actual installed version's existing capture bridge must
be checked against the hosted studio.
