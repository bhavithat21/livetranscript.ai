# Laptop video benchmark and session archive

## Environment and safe credential copying
The connected Vercel tool has no environment-secret read/write action. No credentials have been copied by the agent. To reuse the existing readable Vercel values without typing the API keys or writing .env files, run the included helper **on your authenticated laptop**, from this linked repo:

```sh
vercel login
vercel link
node scripts/copy-rehearsal-env.mjs
node scripts/copy-rehearsal-env.mjs --apply
```

Choose **livetranscript-ai**, team ID `team_lrZxZ9SjJD6F2CSeLAkfMtix`. The helper verifies project ID `prj_U1FL1N9LGnKAe2cTMc2W1l3ukboc`. `vercel` must be installed; the helper does not install software. The first run is a dry run. The second adds allowlisted auth/speech/model variables to **Preview / fix/spoken-requirements-rehearsal-20260926**. It does not change production, overwrite existing Preview variables, create a secret-returning HTTP route, or copy database/billing/Ably/analytics/auth-bypass secrets. CLI output is suppressed except a strictly checked report of variable names and status. API key values travel in memory and via stdin, not command arguments or files.

Only a complete `pk_test_` / `sk_test_` Clerk pair is copied. Configure test auth manually when source uses live Clerk. Production keys marked non-readable/sensitive may not be retrievable through the CLI; recreate only those selected Preview variables using the original provider credential. The helper respects that restriction. `not-added` may mean an existing variable or missing permission: inspect the dashboard, not a printed secret. It does not fall back to force-overwriting. Shared provider keys share credits/billing, so set provider spend limits. A copied key may be expired or unauthorized for a model.

After applying, redeploy the **Preview branch**, not production. Use its stable **branch URL** for `/interview/rehearsal`, sign in and click **Check test configuration**. That check reports presence only, not a successful provider invocation. Configure any missing model/provider/auth shown. No judge is needed for the base-policy run.

Official interfaces consulted: https://vercel.com/docs/cli/env and https://vercel.com/docs/environment-variables/manage-across-environments. The owner-run helper has unit-tested allowlists, not a live Vercel write test.

## Before each run
- Give the session a title, a single video URL, excerpt start/end in seconds, and a split (tuning or holdout). Use **1× speed**. These fields are metadata; the app does not control or synchronize the YouTube player.
- Select base policy for the first run. IDs/model configuration/commit and metadata are frozen in that session's export. Do not tune on holdout sessions; the page disables its learning panel for them even when the next-run setup is changed.
- Keep automatic local text saving enabled. It saves at roughly two-second intervals, on End, and after review changes. Use the same browser profile and **branch alias origin**, not a new per-commit URL, to access the archive after redeployment.
- Start audio, share the video tab with **tab audio** selected, and select the coding screen separately in the coach. Both video voices use the call channel: explicitly select the interviewer. Prefer headphones; turn off candidate mic for video-only replay to avoid echo/re-recording.
- Start the video at the recorded excerpt start. Do not pause for a slow answer. A video cannot obey agent navigation requests; use the separate interactive maze starter to test those.

## What is saved
IndexedDB, scoped to account + session ID + website origin. It stores recognized conversation, final transcript, selected code/evidence replay, requirements, agent results and statuses, client timings, model names/configuration, frozen lessons, benchmark metadata, human reviews and independent expected events. No automatic server/GitHub upload, no raw microphone/video/screenshots, and no automatic model training. IndexedDB is not encrypted and browser/profile access can expose it. Redaction is best-effort; review exports before sharing.

The archive is limited to **30 sessions / 32 MB per account**, **6 MB per report**. It does not silently delete older runs. Quota/storage errors are displayed. Abrupt tab/browser termination can lose the last unsaved interval or more if saving was failing. A recovered draft is labelled incomplete, not a completed interview. Final model callbacks and review saves are serialized. Export backups before clearing browser storage or switching devices. Viewing a saved report never resumes inference or capture. Delete is explicit and irreversible on this device.

## Metrics and interpretation
`continuous-interview-v1` records all requests by lane/status, success sample counts, nearest-rank p50/p95 request-to-first-text and completion timing. First text is NOT verified useful text. Guide/review usually return completed structured outputs; do not invent a first-text metric. Failed, stale and cancelled requests remain in totals but are excluded from successful latency distributions. p95 with fewer than 20 samples is flagged unstable.

After End, review every available answer against the requirement/code state at that moment. The summary reports **review coverage** and **pass rate among reviewed completed answers** separately. A 100% pass rate from one reviewed answer does not mean 100% session accuracy.

Independently list expected questions and requirements (including misses) after the run. Mark each detected/missed and link detected items to observed event IDs. Invalid/repeated matches do not count. Recall is null until every listed event has been reviewed. This is only as complete as the human annotation; the app cannot certify that no events were omitted.

Speech-end latency, acoustic word error rate, wrong-speaker rate, duplicate-trigger rate, real code-test pass rate and dollar cost remain null until supported by independent evidence. The ASR's own transcript cannot be its own reference. The exported result keeps `accuracy: null` and `readiness: not-certified` regardless of synthetic tests or human pass ratings. A model-name label alone does not prove provider authenticity.

## Repeatable plan (targets, not measured performance)
Run one 10-minute tuning excerpt to diagnose capture, then a continuous full-length video. Fix failures and repeat the **same excerpt** for before/after comparison; separately run at least three fresh 45–60 minute interactive sessions. Match hardware, source/excerpt, speed, model IDs, policy and protocol when comparing, and keep full videos/tasks separate between tuning and holdout. Do not mix synthetic transport runs into real-provider measurements.

Track critical failures first: missing/incorrect requirement promotion; wrong-speaker response; unsupported existing file/line claims; stale patch; false test-success claim; freeze or silent request budget exhaustion. Every critical failure becomes a named regression with session ID, commit, relevant event/result IDs, observed/expected behavior and an independent evidence reference. Deterministic regressions gate code changes; holdout real rehearsals gate coaching-policy activation. No automatic promotion from the archive.

Use **End**, add reviews and expected events, then **Export rehearsal evidence**. For this assistant to analyze the evidence, upload the exported JSON; there is no automatic remote access to your browser archive. Raw audio/video recordings are not made by this feature.
