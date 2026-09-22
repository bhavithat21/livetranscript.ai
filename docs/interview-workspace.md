# Interview workspace

Route: `/interview`. Accessible from the desktop/mobile AppNav and HomeMenu.
The existing `/record`, room, saved-session and copilot flows are unchanged.

## Three separate tabs

- **Live Interview** reuses native/browser audio capture and streaming ASR. Choose
  call audio, microphone, or two separate channels. Explicit recording permission
  is required. Open the existing copilot when appropriate. End capture to create
  a completed interview and switch to Feedback. Both audio channels are stopped
  and disconnected on exit; pending starts are cancelled when they resolve.
- **Mock Interview** asks one AI-generated question at a time, with follow-ups
  grounded in submitted answers. Configure role, seniority, behavioral/coding/
  system-design/mixed round, 3/5/8 questions and optional job context. Type or
  dictate answers. AI answers/hints are not supplied during the practice. A
  failed/cancelled question request preserves prior answers and can be retried.
  Finish early or submit the final answer to review. Code is text only; this mock
  does not execute tests or simulate a complete coding IDE.
- **Interview Feedback** reviews either mode, with answer-level evidence,
  strengths, gaps and next exercises. Reports explicitly distinguish absent
  candidate audio from weak performance, do not infer speaker identities from
  diarization numbers, and do not claim numerical scores or hiring probabilities.
  Import transcripts, export Markdown reports/transcripts, or explicitly delete
  a session with an inline confirmation.

Tabs are real accessible tab/tabpanel controls with arrow/Home/End navigation.
All panels remain mounted so switching tabs does not tear down recording or lose
mock drafts. A live and a mock interview cannot run concurrently. An active
session indicator remains visible on the other tabs. The workspace navigation
blocks accidental app-page exits while a session is active, and beforeunload
warns on full-page exit. Browser Back and OS process termination cannot be fully
prevented; unfinished sessions are not crash-recovery drafts.

## Data, authentication and provider requirements

The page and POST `/api/interview` use the app's existing `currentUserId` auth.
The API rejects cross-origin requests, invalid JSON, invalid action/config/turn
shapes and oversized bodies before calling an AI provider. It uses the existing
smart-tier/provider selection plus the existing fast fallback model and server
credentials. No new dependency, database migration, provider account or public
client credential is introduced. Missing provider configuration returns 503;
provider failures are retriable and raw provider exceptions are not logged.

Completed sessions are account-scoped **device-local** history, not database
records or cloud sync. The latest 20 are retained, with an explicit footer
explaining retention and exports. Browser storage is not encrypted; anyone with
access to the browser profile may read it. Storage failure retains new work in
memory and displays a warning; unreadable stored data is not overwritten. A new
account receives a fresh store. Deleted sessions are never resurrected by a late
review response. Raw audio is not saved by the workspace; the ASR and AI
providers receive data needed for the requested processing. Their retention
policies are not changed by this feature.

`lib/analyticsPrivacy.ts` excludes the interview page/API and associated referrer
URLs from analytics, in addition to existing replay restrictions. No transcript,
answer, role context or provider response is added to analytics/logging here.

Feedback generation is explicit, not automatic on capture stop. For a transcript
longer than 40,000 characters, only the beginning and end are reviewed. The UI,
export and model input explicitly identify this as partial coverage; the full
transcript remains in device history (up to its validated size limit). Call-only
recordings do not establish that the candidate's answers were captured. Arrival
order between separate ASR channels is approximate, not precise word alignment.

## Verification

Run the existing repository gates:

```
pnpm exec tsc --noEmit
pnpm test
pnpm lint
pnpm build
```

Tests cover input/prompt boundaries, excerpt disclosure, malformed storage,
account isolation, quota fallback, retention, pinned feedback and deletion races.
API and component/recorder regression tests cover auth, errors, cancellation and
session-preserving tab navigation. These do not establish real model accuracy.

Manual release checks still required: authenticated ASR + AI requests with actual
provider credentials; two-channel browser audio permissions; ending during a
pending permission prompt; revoked sharing; no-device/failure paths; macOS and
Windows native capture; switching tabs during capture/dictation/review; retrying
provider errors; 320px keyboard navigation and light/dark themes; storage-denied
and quota-full browsers; export and deletion. No desktop-native source or
installer settings are changed by this feature.
