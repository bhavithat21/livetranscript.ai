# Choosing models for this product

External rankings identify candidates. They do not establish screenshot accuracy,
faithful navigation or response speed in this app. The dated [candidate catalog](../evals/repo/candidates.md)
combines BenchLM, LiveBench and verified provider API documentation. Candidate IDs,
source dates, effort settings and published prices also appear in
[candidates.json](../evals/repo/candidates.json). No candidate is labeled an application winner.

| Purpose | What the application measures | How selection works |
| --- | --- | --- |
| Question routing | Mode/question/freshness correctness, missed questions, fallback rates, P50/P95 latency and tokens; local and network paths separately | Compare local-first legacy against local-first Jev; review the measured proposal before enabling Jev |
| Requirements and navigation | Captured constraints, correct file/line references, missing-evidence handling and independent repeated cases | Both purposes must qualify before routing the requirements specialist |
| Implementation and debugging | Correct minimal changes, root causes, constraints, test plans and absence of unsupported execution claims | Review actual answers against case-specific criteria, then apply quality/error/latency gates |
| Review | Real defects, plausible counterexamples, minimal fixes and no invented evidence | Independently measured reviewer role |
| Synthesis | Reconciles fixed specialist disagreements with original source evidence | Uses the production streaming path, recording first text and total completion time |
| Screenshot reconstruction | Real PNG inputs with known visible paths, punctuation, line anchors, gaps, conflicts and misleading instructions | Exact evidence scoring plus image/response review; vision is selected separately |

Code responses are reviewed against known fixtures; these suites do not claim to
execute or prove generated patches. Vision uses synthetic editor images, not
HackerRank integration. Add representative consented recordings/repositories before
claiming full interview reliability. Changing prompts, effort, token budgets or
retrieval requires another comparison. Token usage is measured when returned;
missing usage is unknown, never zero. Published token prices are not measured bills.

## Run from GitHub

Open **Actions → Model benchmarks → Run workflow**. Select the suite, exact model
IDs and repetition count. For the classifier suite, supply one Groq/OpenAI model
ID in the models field, such as `gpt-4o-mini`; Jev is the other path. For vision,
use Claude model IDs supported by the existing screenshot provider.

Configure the needed provider secrets under **Settings → Secrets and variables →
Actions**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, and
`TYPESAFE_API_KEY`. Only keys for the selected providers are needed; the classifier
comparison requires TypeSafe and its selected legacy provider. Keys belong in secret
settings or a local environment, never in commits or chat. This workflow makes
paid calls only when manually run. It validates bounded call counts and keeps
partial reports as artifacts. It does not publish a routing policy automatically.

For local commands and review/selection tools, see the
[repository suite](../evals/repo/README.md), [vision suite](../evals/vision/README.md)
and [classifier suite](../evals/classifier/README.md).

## Jev integration

Jev makes typed classification decisions; Claude/OpenAI still produce explanations,
patch suggestions and summaries. Clear questions continue through local rules.
To enable Jev for ambiguous utterances, set the server environment:

```dotenv
COPILOT_CLASSIFIER_PROVIDER=jev
TYPESAFE_MODEL=jev-latest
```

Add `TYPESAFE_API_KEY` through the hosting provider's secret settings and redeploy.
The key is never public. TypeSafe receives only the current utterance, trimmed to
1,000 characters; this integration sends no screenshots or whole repository.
Uncertain, malformed, unavailable or slow Jev responses fall back to the configured
Groq/OpenAI classifier. Jev has a 1.2-second deadline within the shared eight-second
classification deadline. These are configured limits, not measured latency claims.
The API returns actual model identities, attempt outcomes, durations and available
tokens without echoing private utterances or provider errors.

Confidence gates are conservative initial settings, not yet calibrated on this
product's data. Jev does not decide whether repository code is correct and does not
authorize tools or edits. With Jev disabled, the existing generative provider path
remains available. The current repository default remains `claude-sonnet-5` until
real measurements qualify another model for a specific purpose.

## Related implementation research

[Aura-AI comparison](aura-comparison.md) records source-level findings and license
checks. Its provider-priority routing is useful context, not benchmark evidence.
This project uses an original line-numbered retrieval implementation with explicit
omissions, rather than copying source from that project.
