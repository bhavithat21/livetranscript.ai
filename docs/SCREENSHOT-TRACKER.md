# Screenshot-only text anchoring — experimental native candidate

## What is implemented
The agent receives only selected-window screenshots and permitted audio.
There is no DOM/text-model/IDE extension/accessibility/file-system reader in this
tracker. Native window coordinates are used for capture/placement, not code.

A semantic screenshot supplies initial code/line rectangles and separate editor,
visible-file identity, and optional watched-output rectangles. Missing or
ambiguous boundaries disable continuous tracking; no stationary header is
inferred from the first complete code row. The UI checks the exact patch preimage,
task/question/file version, source origin and observation hash, then sends
rectangles plus a capture ID to `inline_tracking`. Native retains one full-size
reference capture for up to 30 seconds for arming and checks the selected-window
lease. Active templates stay immutable: raw reference/current pixels do not
enter React or an LLM during local tracking.

The dependency-free Rust kernel finds surrounding pixel features, searches the
bounded observed editor region, rejects multiple matches, then verifies the
target at original resolution. Two strongly changed pixels in an 8x8 tile can
invalidate a small edit rather than averaging it away across a thumbnail.
An edited target, changed header or resized image requires a new seed. The
tracker never learns its own potentially wrong prediction. An off-screen target
may reacquire locally when the same unambiguous evidence returns, provided the
relevant semantic context is still current.

Aligned comparison of known editor pixels detects changes away from the target.
Only explicitly located terminal/test/problem-output regions are watched outside
the editor. Scrollbars, minimaps and unrelated chrome are not semantic triggers.
Unknown/off-screen areas are not claimed to be monitored. Newly exposed scroll
edges remain unknown: motion does not reconstruct off-screen code.

`ScreenObserver` skips semantic extraction only for a current, matching, clean
local receipt. A new question, explicit recapture, detected edit, watched-output
change or lost tracking uses the bounded semantic path. Dirty recommendations
stay hidden until review completes; a later clean frame cannot resurrect them.
Request epochs stop an old extraction clearing a newer refresh. Receipts from a
retired anchor cannot invalidate its successor. Hung screenshot transports are
independently abort-raced. Automatic and explicit image grabs share a single
ownership guard; the keyframe gate is not armed while a grab/extraction is busy.
Stopping capture clears review/error state before a new source is attached.

## Latency and resource architecture
- Native `spawn_blocking` performs capture, full-resolution matching and checks.
- The webview receives geometry, diagnostics, a reduced thumbnail, and occasional
  high-resolution JPEGs explicitly selected for semantic reading. Clean tracked
  frames use a 160px gate thumbnail instead of 640px (up to 16x fewer pixels).
- Requested frame periods: 50ms while changing, 125ms for a stationary anchor,
  250ms without an anchor. Work already spent capturing/processing is subtracted
  from the next wait, with an 8ms minimum yield and no catch-up queue. These are
  requested periods, NOT achieved frame-rate or end-to-end latency guarantees.
- One native capture and one semantic request at a time; no accumulated video
  queue. Fixed templates, 16M source-pixel ceiling, 600K template-pixel ceiling,
  and 8M candidate-position ceiling. Budget exhaustion withholds the pointer.
  Full uniqueness checking is retained rather than accepting a partial search.
- Identical aligned rows take a byte-equality fast path. Different pixels still
  undergo the original strict tile checks; the optimization does not relax the
  operator-change detector.
- `Export tracking metrics` in Inline Coach saves counts and last-240-frame
  p50/p95/max native timings, not screenshots or source text. Position correctness
  and answer accuracy remain null without independent labels.

## Verified scaling fixes — 26 September 2026
The previously failing pixel suite at code base `330dcbe0` had two different
causes. At 125% rasterization, the test driver rounded rectangle origins and
sizes independently, producing an output region extending one pixel beyond its
image. The driver now rounds endpoints before subtracting. Native conversion
already used endpoints; this was a fixture-label fix, not a native DPI fix.

At 200%, the real tracker exceeded its 1.5M candidate search ceiling and reported
that as a nonunique anchor. The bounded ceiling is now 8M and budget exhaustion
has its own error. A new native regression exercises a Retina-sized search.
The suite also adds 1920 CSS pixels at 2x (3840 physical pixels wide).

Code commit `6485c80413211c01bd95f1d21b790e32dd765336`, Actions pixel run
`36254404731`: 16 kernel unit tests and all 16 browser-pixel cases passed.
All 217 requested frames were evaluated; zero seed failures. 202 frames had
tracked rectangles; other frames exercised expected abstention. Among these
labeled fixtures there were zero wrong targets, zero semantic-guard failures and
0px maximum position error for tracked frames. Kernel p50 was 3.0151ms and p95
10.3906ms. These are one CI runner's measurements, not laptop guarantees.

The v2 report explicitly counts requested/evaluated frames and seed failures so
failed initialization cannot silently disappear from the benchmark denominator.

## What these tests prove / do NOT prove
`qa/visual-tracker/verify.py` renders authored coding scenes in Chromium, captures
PGM pixels, and executes the SAME Rust module used by the native shell. The
executable receives image paths and the initial seed only. DOM is used solely
by the test driver to construct scenes and independent ground-truth labels;
subsequent text positions and scroll offsets never enter the tracker.

Coverage includes horizontal/vertical motion, off-screen return, repeated
blocks, operator/two-pixel edits, surrounding changes, filename changes,
occlusion, zoom and 100/125/150/200% rasterization. Kernel time excludes OS
capture, grayscale conversion, IPC, rendering, initial vision acquisition and
model generation. Initial rectangles are known test annotations, not output of
a real vision provider. Pixel-fixture passes do not certify physical Windows or
macOS input/capture, real screenshot extraction or interview answer quality.
No provider calls or automatic coaching-policy promotions occur in this suite.

Limitations: strict pixel checking can lose lock during antialiasing/subpixel
scroll, blinking carets, selection, folding or occlusion. Initial vision boxes
and visual matches are estimates, not calibrated probabilities. Visually
identical screens cannot reveal a file change. Off-screen edits are unavailable.
Capture still uses xcap selected-window screenshots, not a persistent
ScreenCaptureKit/Windows Graphics Capture stream. Verify compositor separation
from our overlay on the actual device. No monitor fallback, global cursor
suppression or invisibility/proctor-bypass guarantee is provided.

## Run the matching frontend + native source
This is PR #22, not a public updater release. Refreshing Preview cannot add native
commands to an older installed binary. With normal Tauri build prerequisites,
project dependencies, and local test provider/Clerk configuration:

```bash
git switch feat/inline-coach-pointer-20260926
pnpm install --frozen-lockfile
# macOS only: build the existing audio helper first.
bash scripts/build-audio-helper.sh
# With cargo-tauri v2 installed:
cargo tauri dev --config src-tauri/tauri.tracker-dev.conf.json
```

The development config starts `pnpm dev` on localhost:3000. Existing debug-only
localhost permission is reused; release origin restrictions, capabilities and
authentication are not broadened. On Windows follow the existing sidecar build
instructions rather than running the macOS helper command. No secrets are
bundled/copied. Start a permitted Repository Coach session, select the IDE WINDOW,
wait for screenshot interpretation and a current patch, enter Inline Coach, and
focus the IDE. Tracking arms only when sufficient source-row evidence exists.

Recover via Cmd/Ctrl+Shift+L or the tray. End capture before switching builds.
Run a ten-minute scenario at several DPI/font settings and independently mark
wrong-pin episodes, missing pins, operator edits and reacquisition intervals.
Export tracking metrics and separate rehearsal evidence as applicable. PR #21's
saved-rehearsal changes are a separate branch; they are not merged by this patch.
Do not declare readiness from a zero API count or a fast kernel benchmark.
