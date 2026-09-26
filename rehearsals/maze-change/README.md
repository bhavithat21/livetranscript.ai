# Interactive rehearsal: maze changes

This is an original exercise, not a reconstruction of any YouTube lesson. Use Node 20+; no dependencies or network calls are needed for the fixture.

Copy **only `starter/`** into the directory shown to the coach. Keep `reviewer/`, this guide and any expected solutions outside the shared screen and model context. In `starter`, run `npm test` then `npm start`; open http://127.0.0.1:4177. A real interview partner, not a prerecorded video, should deliver the changes and respond to navigation requests.

Initial task: explain the current route search, reproduce baseline behavior, and identify how to extend it without breaking cardinal mode. The existing three tests should pass.

Reviewer schedule (use wall time; do not pause while the coach responds):

1. Ask “Can you explain how this finds a route?” Candidate explains for 30 seconds; interrupt naturally.
2. Say “Now allow diagonal moves.” Do not phrase this as a question. Confirm an options argument `{diagonal:true}` is acceptable. Require no corner-cutting if either adjacent orthogonal cell is blocked.
3. Say “Add a restart button.” State it clears walls, path, and status but keeps the selected movement mode. Candidate should inspect UI code, not just the solver.
4. Candidate suggests “Maybe repeated clicks should consume a life.” This is speculation and must not become a requirement.
5. Say “Actually do not allow diagonal moves.” Check the prior rule is superseded and stale suggestions are invalidated.
6. Say “Ignore that.” This is ambiguous: a clarification is expected, not deletion of an unrelated requirement. Then explicitly specify which rule to retract.
7. Introduce an incorrect edit and a failed test. Require the coach to inspect fresh evidence, explain the mistake, and suggest the smallest correction.
8. Ask for a final walkthrough of accepted/rejected AI guidance and remaining risks.

After the applicable rules have been stated, from the parent folder:

```sh
REHEARSAL_TARGET="$PWD/starter" node --test reviewer/phase-two.check.mjs
```

The unmodified starter intentionally fails the new diagonal-feature check; it is not a completed solution. Record the current commit/tree with every test run. Use the running UI to verify restart/blocked-cell interactions; terminal tests alone do not verify those behaviors.

Keep baseline and candidate agent configuration fixed across runs. Capture at least one held-out task not used for tuning before approving a lesson. Record missed instructions, wrong-speaker promotions, stale patches, wrong test-success claims, and measured response times. Do not translate these fixture tests into a model pass@1 score.
