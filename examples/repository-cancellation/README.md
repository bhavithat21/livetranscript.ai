# Known-bug repository for product acceptance

This tiny repository is intentionally broken. It provides ground truth for testing screenshot reconstruction, cross-file reasoning, navigation, and a proposed patch. It needs only Node.js; no packages or credentials are needed to run its tests. Live assistant analysis still requires a signed-in application and configured model credentials.

Make a disposable copy, then open that folder in your editor:

```bash
cp -R examples/repository-cancellation /tmp/repository-cancellation-demo
cd /tmp/repository-cancellation-demo
node --test acceptance.mjs
```

The baseline is **one passing test and two failing tests**. These intentional failures are outside the application's normal Vitest suite.

## Capture and ask

1. Show the file tree and `src/orders.mjs` with its full path and line numbers. Capture only lines 4–9 first. The assistant must preserve the missing beginning of the file.
2. Capture the complete `src/store.mjs`, then all of `acceptance.mjs`. Scroll with overlap if needed.
3. Ask: “Cancellation publishes twice when retried. Explain the full call path, tell me exactly where to navigate, propose the smallest fix, and explain how to verify it.”
4. Capture all of `src/orders.mjs` to fill the gap. Confirm it reconciles the overlap instead of duplicating lines.
5. Ask the same question again after the first answer completes. Select each occurrence in the question ledger; task actions and retries should stay attached to that occurrence.
6. Apply the assistant's proposed change to the disposable copy. Run `node --test acceptance.mjs` again. A correct minimal fix makes all three tests pass.

## Reviewer ground truth

Do not include this section in the screenshots used to evaluate reasoning.

- `src/store.mjs:5–8` changes only an active order and reports whether the transition happened.
- `src/orders.mjs:4–6` calls that transition, publishes unconditionally, then returns the result. A retry and an unknown ID therefore publish an event even though no transition happened.
- The minimal fix is to publish only when `changed` is true. Preserve the returned boolean and existing payload.
- `acceptance.mjs` verifies first cancellation, retry, and unknown ID. Merely deduplicating by ID in the test or suppressing all publishing is incorrect.
- This fixture covers one synchronous process with a non-throwing publisher. Durable delivery, concurrency across processes, and publish failures remain untested; the assistant must not claim these are solved.

Compare reconstructed characters and line numbers against the original files. Record whether the assistant names both source files, explains the state-to-event relationship, preserves unseen-code uncertainty, proposes a working patch, and refrains from claiming it executed these tests itself.
