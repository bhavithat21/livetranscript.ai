# Isolated real interactive rehearsal

Branch: `fix/spoken-requirements-rehearsal-20260926`. The `/interview/rehearsal` route is enabled on this exact Vercel Preview branch, or on non-production environments explicitly setting `COPILOT_REHEARSAL_ENABLED=1`. It is always disabled when `VERCEL_ENV=production`.

## Secure configuration

Use Vercel **Settings → Environment Variables → Preview → Specific Git branch**. Use a test Clerk instance and test-scoped provider keys with provider-side spend limits. Do not copy production database, billing, Ably or other service secrets. No database is required by the rehearsal recorder; reports remain device-local until explicit download. Normal Clerk authentication and same-origin checks remain in place; do not enable PREVIEW_NO_AUTH in a deployed preview.

Required:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` from the test Clerk application; authorize the Preview host in Clerk.
- `DEEPGRAM_API_KEY` or `ASSEMBLYAI_API_KEY` for the selected speech provider.
- `ANTHROPIC_API_KEY` for the existing Claude screenshot extractor.
- The provider credentials required by the selected `COPILOT_COACH_TALK_MODEL`, `COPILOT_COACH_GUIDE_MODEL`, `COPILOT_COACH_REVIEW_MODEL`; unset models inherit the existing repository configuration.

Model IDs are configuration, not measured winners. A configured key can still be expired, lack credits, or lack model access. Redeploy the exact reviewed branch after setting variables. Sign in and select **Check test configuration**. This endpoint makes zero paid calls and returns presence only, never secret values. Passing preflight is not an accuracy result.

Optional local setup uses `.env.local` (gitignored). Secure CLI alternative, following Vercel's branch-specific variable interface:

```sh
vercel env add DEEPGRAM_API_KEY preview fix/spoken-requirements-rehearsal-20260926 --sensitive
vercel env add ANTHROPIC_API_KEY preview fix/spoken-requirements-rehearsal-20260926 --sensitive
```

Enter values at the secret prompt, never as command-line literals or in chat. Repeat for the actual selected providers/auth. Do not pull/export production secrets into the repository.

## Rehearsal execution

Start the supplied fixture with `npm start`, share only the starter IDE, and have a second person deliver the reviewer instructions in a live call. Use headphones and select system audio plus candidate microphone. Explicitly assign the interviewer voice. The coach consumes role-tagged final speech, not a giant flattened transcript. Keep an ordinary independent record of what the interviewer actually said to measure ASR and missed instructions; the coach's own transcript is not ground truth.

The real route does not inject a mock recorder or model transport. Session tactics are selected explicitly before Start and frozen for that run. Default is base policy; select the exact allowlisted candidate IDs for a candidate rehearsal. The export records the policy key and IDs. No learning runs during capture. After ending, independent review can feed the existing paid lesson evaluator; credentials plus a distinct COPILOT_LESSON_JUDGE_MODEL are required for that optional step. Human approval notes are retained in local policy history, not sent to generation. End capture, independently review each answer against then-current requirements and real test output, and export the report. Export includes source text, recognized speech, responses and review notes, but no raw audio/images. Review privacy before sharing. Nothing is automatically uploaded to GitHub.

## Feedback loop and promotion gate

Exported failures become named regressions with exact source/requirement revisions. Fix code or propose a bounded communication tactic; run deterministic tests first, then a separate real rehearsal. LLM-judged evaluation is advisory. The learning panel now proposes/evaluates without activating automatically. Explicit approval requires a reviewer acknowledgement and a rehearsal-report reference; this is a human attestation, not proof checked by the software. Retain report+independent tests. Rollback remains available.

Never let a recorded candidate's later answer leak into the initial answer context. Keep entire unseen tasks separate from tuning data. At least three fresh 45–60 minute runs on the actual device, with no false requirement promotions, unhandled budget exhaustion, stale file edits or false success claims, are proposed release gates—not achieved metrics.

## Evidence labels

- Scripted transport tests measure state/scheduling behavior, not ASR/vision/reasoning.
- Header/configuration probes are not a provider invocation.
- The report's `accuracy` stays null and `readiness` stays `not-certified`; it cannot certify itself.
- `firstUsefulMs` currently measures request-to-first-text, not speech-end latency. Use independently timed source audio for that latter metric.
- HTTP endpoints still apply request limits; the coach has a 120-call session cap, with explicit paused 40-call extensions only, max 240. Screenshot limits are separate. Waiting does not reset a lifetime budget.

References: https://vercel.com/docs/environment-variables/manage-across-environments and https://vercel.com/docs/cli/env (consulted 2026-09-25). No production credential scope or authentication was changed by this setup.
