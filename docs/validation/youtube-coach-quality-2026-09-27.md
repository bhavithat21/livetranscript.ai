# YouTube mock-interview coach validation — 2026-09-27

## Scope and verdict

Observed production in Chrome using the user-selected YouTube video, `https://www.youtube.com/watch?v=ZE_YEn-okfk` (AI Coding Mock Interview with Senior FAANG Engineer). This is candidate-facing practice guidance, not interviewer assessment. Initial inspection used local commit `117800e`. The implementation below was then rebased by applying the fixes in a clean worktree based on deployed main commit `43a7bf3`, on branch `codex/coach-answer-experience`.

The coach can hear the discussion, extract visible code and produce a relevant answer. There is insufficient evidence to claim it outperforms the interviewee. We observed selected moments, not a blinded comparison across the full interview; speaker attribution, candidate questions and unrelated audio affected the input.

## Observed behavior

- A synchronous/asynchronous question produced a grounded answer about a blocking ten-second sleep. UI-reported first text: 1,020 ms; completion: 3,107 ms. These are generation measurements, not speech-onset-to-answer latency.
- The answer's caveat about blocking versus async RPC stubs risks conflating client invocation style with server execution. The visible method remains blocking regardless of client stub style.
- A concurrency follow-up produced a relevant but overly long answer (UI-reported 1,112 ms first text, 4,152 ms completion). The method alone cannot establish whether a caller already serializes requests. A distributed deployment also needs more than a per-process mutex for cross-instance exclusivity.
- A spoken restart became the current question: "Is it the I mean, let's again, I would ask you, are the AI." This caused unnecessary composing/cancellation before the coherent question arrived.
- Both candidate and interviewer voices were present in system audio. With no explicit interviewer selection, a question is only a question-shaped utterance, not proof of interviewer intent. A diarization number is not an identity. Unrelated ad audio also entered the transcript.
- After selecting YouTube, the preview showed the correct source. One safe-read failure paused watching. Explicit recapture recovered 18 lines of `ReportGenerator.java`, 25 paths and later a service fragment.
- OCR included `ReportGenerator()()` and `sleep(timeout:10)`; the latter may include an IDE parameter hint. Extracted text must not be presented as byte-exact source.
- Navigation requested lines 1–1 of `java/com/myservice/demo` and later `build`; both are directory-like entries, not established source files.
- A guide request failed validation or provider execution. The UI did not expose which cause; this run cannot diagnose it.

## Focused changes

1. Recognize common auxiliary-led spoken questions without relying on a question mark; recognize "I would like to see how you…" requests.
2. Hold unfinished auxiliary stems; use the repaired clause after an explicit spoken restart. Preserve duplicate suppression and legitimate repeated questions.
3. Request 35–65 words in 2–3 spoken sentences, with a 90-word ceiling; lead with an answer and one reason/tradeoff. Preserve constraints and avoid invented experience. This is prompt guidance, not an enforced runtime guarantee.
4. Clarify server/client async reasoning, caller-level uncertainty and OCR limitations in the talk prompt.
5. Filter directory-like, clipped and unclassified paths from automatic next-file suggestions. Observed files and familiar extensionless build filenames remain eligible. This heuristic cannot perfectly classify every extensionless path without a richer observation schema.

## Reproducible local comparison

`lib/coach/videoQuality.test.ts` contains 17 targeted deterministic regressions, including a virtual-clock dispatch test. Before changes: 6 passed, 11 failed. After changes: 17 passed. These authored regression cases demonstrate fixes to reproduced failures; they are not a held-out accuracy score or evidence of improved model-generated prose.

The revised prompt has not been evaluated against a real provider: local provider keys were not available. No production prompt or deployment was changed by this validation.

## Next provider-backed acceptance run

Use the same visible fragments, finalized transcript and explicit speaker roles for baseline and revised prompts; use the same configured model and generation budget. Alternate order, repeat each case at least three times, and keep outputs for review.

| Case | Required behavior | Failure examples |
| --- | --- | --- |
| Is report generation synchronous? | Explain caller waits during blocking work; distinguish unseen caller | Async client stub makes server nonblocking; claim full repository access |
| Work cannot be shortened: prevent timeout | Return job ID and run bounded background work; status/polling; preserve work | Delete sleep as the real fix; unbounded thread per request |
| Can users request multiple reports? | Clarify per-user/global scope; bounded concurrency or deduplication; cross-instance limit if relevant | Global mutex asserted necessary; assume caller has no guard |
| Fragment then correction | Wait for coherent ask; preserve earlier complete answer until replacement is usable | Bill each fragment; respond to an ad or candidate self-talk as interviewer intent |

Review correctness, question fidelity, constraint retention, speakability, evidence honesty and useful next step separately. Measure question-end-to-first-useful-answer as well as provider first text/completion, aborted requests and cost. A faster incorrect answer is a failure.

Example target wording (authored illustration, not a measured model result):

> The report work is synchronous, so the request stays open while it runs. Since we can't shorten that work, I'd return a job ID and run it on a bounded worker queue, with a status endpoint for the client. We'd need to agree on retries and duplicate requests so the same report isn't generated twice.

## Answer-first implementation and validation

The current changes prioritize the question, spoken answer, proposed replacement and verification. The shared-screen preview is collapsed in evidence and stays mounted; hiding it does not stop capture. Question correction cancels obsolete work. Explicit refresh uses newly read code. Failed partial speech is labelled incomplete. Suggested replacement code has copy feedback, and copying never marks an edit as applied. The existing safe Markdown renderer handles inline formatting in answers.

Video-test mode exposes interviewer selection without opening the transcript. Candidate-labelled dialogue may inform speaking style, but cannot establish code facts or personal achievements. The screen extraction prompt excludes identifiable editor inlay hints and requires uncertainty when source and overlay cannot be distinguished. This instruction needs provider-backed OCR evaluation; it is not a claim of solved OCR.

Context selection now ranks actually observed files separately from the visible path list. Visible and included files remain in the bounded known-path envelope; references outside that envelope are excluded. This prevents directory-heavy screens from starving the answer of observed source. A regression covers 150 higher-ranking unseen paths.

| Verification | Result | Evidence / limitation |
| --- | --- | --- |
| Full unit suite | PASS | 121 files, 888 tests; rerun with 20-second timeout after a frame serialization timeout in the initial run |
| Coach contract suite | PASS | 83 checks: source boundaries, stale responses, exact proposals, observations, test linkage and capture cancellation |
| New UI regressions | PASS | Question correction, fresh-evidence refresh, pause/resume, partial failure, optional preview and explicit stop |
| Production build (webpack) | PASS | Compiled, type checked and generated routes; default Turbopack remains blocked by the local dependency symlink |
| TypeScript | PASS | Full no-emit check; production route-export issue separately found and corrected during build |
| Chrome desktop and 390px | PASS | Answer/code sequence, correction, copy feedback, test marker, pause/resume; width equals scroll width at 390px |
| Chrome runtime logs | PASS | No error/warning entries in the local fixture tab |
| Lint | PASS | Full repository eslint completed without findings |
| Strict UI audit | PASS | Zero findings; scope now includes components/coach |
| Actual new provider answer quality | BLOCKED | No local provider credentials; fixtures are synthetic and do not measure accuracy or naturalness |
| Physical capture after this UI change | PARTIAL | Prior production capture verified; new collapsed-preview lifecycle tested with injected source, not a fresh native picker session |
| Better than the interviewee | NOT ESTABLISHED | Requires paired human review on the same questions/evidence; two production samples are insufficient |

The default Turbopack build cannot use this worktree's external dependency symlink. The webpack production build passed, including type checking and route generation, with a dependency warning from keyv/got about a dynamic request expression. Build validation exposed an unrelated invalid exported helper in the execute route; it is now private. The health route's JSON import warning was also corrected. No execution capability was added to the screen-only coach.

Screenshots from local fixture QA: `/private/tmp/coach-answer-desktop.png`, `/private/tmp/coach-answer-mobile.png`, `/private/tmp/coach-answer-full.png`. Fixture response times are deliberately synthetic and must not be compared with production latency.

No production deployment has been performed for these changes. The earlier 1.020/1.112-second first-text and 3.107/4.152-second completion samples remain baseline observations only.
