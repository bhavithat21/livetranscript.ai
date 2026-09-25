# Transcription fidelity and visual refinement

This release addresses observed segmentation and display failures without retroactively guessing at recorded speech. No user recording, transcript, share token or private acronym is committed as a fixture. No raw audio was supplied for the reported session, so no word-error-rate reduction is asserted.

## Recognition
- Deepgram Nova-3 continues streaming interim captions. Phrase endpointing changes from 50 ms to 300 ms (Balanced) or 500 ms (Careful); smart formatting stays enabled and forced no-delay formatting is removed.
- AssemblyAI Universal 3.5 remains available. Balanced/Careful select its documented balanced/max_accuracy presets. Neither vendor is labeled an empirically proven winner.
- Stable provider-connection + utterance keys replace revisions, including AssemblyAI formatted finals. Genuine repeated words on new turns are retained.
- Word-level speaker changes are split only when word text accounts for the full provider transcript. Uncertain alignment preserves all text and abstains on a single-speaker label.
- Disconnect drains until Metadata/Termination, close or a bounded two-second deadline. Multiple final results may arrive before acknowledgement. Callbacks are installed before buffered audio is sent.
- Recording no longer automatically rewrites ASR fragments with an LLM. The source buffer updates synchronously before save; summary failure does not discard recognized words. Pending provider startup is cancelled on unmount.
- Settings → Audio has a device-local Balanced/Careful preference and custom vocabulary. Hints are sent on the next connection. Terms are prioritized, deduplicated and bounded by count plus a deliberately conservative UTF-8 prompt budget. Terms are not replacement rules.

## Reader and design
- Reading view groups same-speaker fragments into bounded paragraphs and exposes Original segments. No wording is edited or deleted by presentation. Unknown and unfinalized results remain explicit.
- Fixes the accumulated 30-second speaker-header threshold which previously relabeled every later fragment.
- Porcelain/graphite surfaces, indigo actions and self-hosted variable Geist Sans/Mono replace the mismatched blue/teal treatment. The Live/Repository canvases remain dark graphite in both themes.
- Text accent and button fill use separate tokens. Browser QA checks AA text contrast on primary surfaces, including hover fills; decorative borders are not the only affordance.

## Verification
Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`. Protocol tests use synthetic WebSocket frames, not real provider inference. Record lifecycle tests use fake audio/network boundaries and the real component.

`pnpm build && node qa/refinement/fonts.mjs` reuses Next’s actual self-hosted font assets. Start `node qa/refinement/server.mjs`, then run `python3 qa/refinement/verify.py` with Playwright Chromium installed. The browser suite renders the actual shared document, public home and Audio settings at seven widths in both themes (42 combinations), checks lossless toggling and font loading, and stores screenshots/measurements only. No fonts are uploaded with QA reports.

An offline bundle may use `node qa/refinement/fonts.mjs --allow-fallback` and `node qa/refinement/bundle.mjs`; it must report fontVerified=false and is not typography proof.

## Remaining empirical gate
Use a consented audio clip and a reviewed human transcript to compare vendor/preset word error rate, acronym accuracy, speaker assignment and speech-end latency. Do not infer participant count from ASR labels, force unknown acronyms into plausible expansions, or represent an AI summary as the source transcript.
