# Repository interviews from screenshots

In the recording assistant, select **Repo interview**. Choose **Share IDE** for a browser-hosted workspace, then **Capture code**. **Watch IDE** checks the selected screen every eight seconds, skips identical images, and sends one capture at a time. **Screenshot** accepts an existing PNG, JPEG or WebP image. Folder import remains optional.

Show the file tree, open the entry point, and then follow the suggested files. Keep the editor breadcrumb and line-number gutter visible. Scroll with overlap and unfold relevant blocks. Claude transcribes only visible text; navigation identifies unread files, gaps and uncertain lines that need another capture. Terminal output and visible requirements are included when present.

## What the reconstruction means

The app maintains an in-memory, partial reconstruction of observed source. It does not have filesystem access to the browser IDE. It cannot recover code that was never shown, reliably infer hidden dependencies, or establish a runnable copy from incomplete views. An observed EOF plus continuous confident text is coverage information, not proof that OCR is correct.

Overlapping captures merge by line number. A disagreement invalidates earlier line positions for that file, preserves conflict history, and requests fresh coverage. Snippets without readable line numbers remain unanchored. Missing source is explicitly marked instead of generated. Old terminal output is marked as a previous observation. Evidence can be inspected and exported as JSON, including incomplete ranges and revisions.

Screenshots and selected evidence go to the configured model provider. Raw screenshots and the reconstruction are session-only and disappear on reload. Common credential filenames are excluded from parsed evidence; this is not comprehensive secret detection inside ordinary source or screenshots. The question ledger is stored locally and can be cleared independently.

## Live assistance

Question capture continues while analysis runs. Auto mode drains settled questions in order. Follow-up transcription revisions reset the settle timer and cannot be marked answered by a stale response. Failed questions remain available for explicit retry. Clicking a question pins it; answer history retains the last 30 completed or failed analyses in this session.

**Plan**, **Debug**, **Review**, and **Debrief** run independent requirements/navigation, implementation or debugger, and review specialists, followed by streamed synthesis. Each receives the same bounded source evidence. The UI shows the actual model, duration, failure state and notes for each role. Navigation is available from local evidence before model analysis completes. The final response includes the questions, exact navigation, control/data flow, suggested patch, expected verification, and open evidence gaps.

These agents suggest changes and commands. They do not edit or execute the interview repository. Test outcomes are only observations if captured from actual terminal output. New captures mark existing analysis as based on an older revision.

## Models and evaluation

See [the benchmark guide](../evals/repo/README.md) for per-role model configuration and the opt-in live comparison harness. All roles initially use Claude Sonnet 5; this is an operational default, not a measured winner. Configure different providers per role or use a reviewed measurement policy. No model-quality or OCR-accuracy benchmark has been run in this workspace because provider keys are not available.

Unit tests cover reconstruction gaps/conflicts, bounded extraction, cancellation, concurrent specialists, provider failures, question revisions, input validation, stream completion and answer history. These checks establish pipeline behavior, not interview success or the accuracy of live model responses.

For repeatable product journeys, release checks and live-model acceptance criteria, see [the product validation guide](repo-product-validation.md).
