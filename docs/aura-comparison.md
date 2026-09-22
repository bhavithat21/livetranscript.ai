# Aura-AI source review

Reviewed on 2026-09-22 against [`Rkcr7/Aura-AI` commit `50f7536c41e1bcd2573e2ada1dfb5e52822e4faa`](https://github.com/Rkcr7/Aura-AI/tree/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa). The [README](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/README.md) describes a desktop voice/screenshot assistant. This review inspected source; it did not run Aura, validate provider availability, or reproduce its performance claims. Marketing comparisons and tokens-per-second figures are not benchmark results for this product.

The repository's [MIT license](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/LICENSE) names Copyright 2025 Ritik and requires retaining its notice in copies or substantial portions. No Aura source, prompts, assets, or dependency was copied into this application. The implementation described below is original.

## Verified architecture and useful ideas

| Capability | Source evidence | Application to livetranscript.ai |
| --- | --- | --- |
| Desktop UI with asynchronous backend | [`main.py`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/main.py) starts a local FastAPI/Uvicorn service with pywebview on the main thread. | Our Next/Tauri architecture already separates capture/UI from provider calls. A Python rewrite would not itself establish a latency improvement. |
| Streaming text and provider selection | [`services/llm_service.py`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/services/llm_service.py) streams answer chunks, keeps primary/secondary configurations, checks providers, and reports fallback metadata. | Preserve actual model identity and visible errors. Compare providers per specialist role and measure first useful output as well as completion time. |
| Shared conversation context | [`services/context_manager.py`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/services/context_manager.py) keeps candidate data and recent exchanges; [`core/config.py`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/core/config.py) defaults to six exchanges. Vision results can enter the same history. | Retain relevant session continuity, while keeping observed code separate from model-generated conclusions. Bound context by evidence size and relevance, not only exchange count. |
| Multiple screenshots and model-specific image limits | [`web/js/screenshot-service.js`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/web/js/screenshot-service.js) queues images, adjusts the queue cap, bounds the long edge to 2,560 pixels, and submits images together. [`services/vision_service.py`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/services/vision_service.py) sends image inputs with an analysis prompt. | Evaluate overlapping captures, small punctuation, folded code and conflicting revisions. Our screenshot evidence store already preserves partial files, unknown line positions and capture conflicts; a prose answer from images is not a reconstructed repository. |
| Audio batching and sample-rate alignment | [`web/js/audio_processor.js`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/web/js/audio_processor.js) accumulates 1,024 PCM samples per message. [`web/js/audio_handler.js`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/web/js/audio_handler.js) requests an explicit AudioContext sample rate. | Check capture-to-transcript latency and recognition accuracy separately from LLM latency. Batch size needs measurement on our own audio path before adopting it. |
| Session recovery and preflight | [`api/session_manager.py`](https://github.com/Rkcr7/Aura-AI/blob/50f7536c41e1bcd2573e2ada1dfb5e52822e4faa/api/session_manager.py) retains in-memory sessions after a socket disconnect, expires disconnected inactive sessions, checks providers and buffers transcript until 1.5 seconds of silence. | Preflight should test the configured task capability, and reconnect tests should preserve question identity without replaying billable work. A successful model-list request alone does not prove image support or answer quality. |

## Boundaries found in source

- **“Best” does not mean benchmark winner.** `MultiLLMManager.auto_select_best_provider` chooses the first healthy provider in configured priority order. `response_time` is an ISO timestamp, not measured elapsed time. Provider descriptions in `ai_providers.example.json` are configuration labels, not task-quality evidence.
- **Context is not a file index.** The inspected history manager stores profile text and exchanges. The vision path returns generated analysis; it does not construct a source manifest with line anchors, coverage, revisions or executable verification. It therefore cannot substitute for `lib/repo/screenEvidence.ts`.
- **Retries can distort latency.** Text calls retry keys on any error and fall back to another provider; fallback text generation is non-streaming. Vision has a 75-second call timeout while the frontend resolver waits 45 seconds. Reusing these settings would not provide a coherent end-to-end deadline.
- **Desktop session assumptions do not transfer directly to a hosted service.** `initialize_managers` assigns each session's context to a module-level `vision_service`. That shared mutable design is unsuitable for copying into a multi-user server; our evidence must remain scoped to the authenticated request/session.
- **No automated evaluation evidence was found in the inspected commit.** The tracked file inventory contains no test suite or benchmark harness. README demos and source comments do not establish reproducible OCR accuracy, answer correctness, or p95 latency.

## Improvements selected for this product

### 1. Precise source retrieval within a fixed budget — implemented

Folder ingestion previously selected one arbitrary 3,600-character slice around the earliest matching term. That could hide a distant caller and omit the exact line information needed during an interview.

`lib/repo/index.ts` now selects up to three relevant locations before adding surrounding lines, favors rare and not-yet-covered query terms, numbers original indexed lines, and labels omitted ranges. Oversized lines remain omitted rather than appearing as clipped code. Excerpts remain at most 3,600 characters; the complete repository context is bounded to 32,000 characters, including path and symbol metadata. Excerpts are calculated after file ranking so unselected files do not incur that additional work. This preserves the existing `RepoMatch.excerpt` string API.

Regression tests in `lib/repo/index.test.ts` cover distant call sites, CRLF line positions, oversized source lines and a repository with very long names. This is deterministic retrieval, not an AST dependency graph or a guarantee that every relevant file was discovered. Folder ingestion limits can still omit source, and the prompt states that limitation.

### 2. Measure and route by purpose — benchmark integration

Use public leaderboards to choose candidates, then test those candidates through our real provider adapter. Record requested/returned model identity, generation settings, failures, token usage when supplied, first useful navigation and complete-answer latency. Evaluate requirements capture, implementation, debugging, review, synthesis and screenshot extraction separately. A model qualifies only if it meets the purpose's quality criteria; speed should break ties among qualified candidates.

Preserve manual configuration and explicit failed-specialist states. Do not copy Aura's provider-priority heuristic as a claim of measured superiority. Do not cache an answer by question text alone: a changed repository revision, transcript, task, prompt or model makes that answer stale. Our existing exact-frame deduplication already avoids a repeated accepted screenshot call; further caching needs measured benefit and revision-scoped keys.

The repository and vision evaluation documentation describes runnable local checks and opt-in live measurements. Unrun model comparisons must remain marked unrun; installing a provider or reproducing a README configuration is not a successful benchmark.
