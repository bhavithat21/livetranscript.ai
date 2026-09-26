# Screenshot-only text anchoring — experimental native candidate

## What is implemented
The agent still receives only selected-window screenshots and permitted audio.
There is no DOM/text-model/IDE extension/accessibility/file-system reader in this
tracker. Native window coordinates are used for capture/placement, not code.

A semantic screenshot supplies the initial code/line rectangles. The UI checks
exact patch preimage, task/question/file version, source origin and observation
hash, then sends rectangles + a capture ID to `inline_tracking`. Native retains
one full-resolution reference capture for up to 30 seconds and validates that it
belongs to the same selected-window lease. It builds immutable luma templates;
raw reference/current pixels do not enter React or an LLM during local tracking.

The dependency-free Rust kernel locates surrounding pixel features, searches the
bounded observed editor band, rejects multiple matches, then verifies the target
at original resolution. Two strongly changed pixels in an 8x8 tile invalidate
small edits instead of averaging them away across a thumbnail. Edited target,
changed header or resized image requires a new seed; the template never learns
its own potentially wrong prediction. Out-of-view targets may reacquire locally
if the same unambiguous evidence returns before semantic context changes.

Separate aligned comparison of known editor pixels catches changes away from
the target. Background/terminal areas use a coarse reread trigger. These checks
are conservative evidence, not proof of all repository state. Newly exposed
scroll edges are unknown; no off-screen code is reconstructed from motion.

`ScreenObserver` skips semantic extraction only for a current matching local
receipt. A new question, explicit recapture, detected edit, dirty background or
lost tracking still goes through the existing bounded semantic path. Dirty
recommendations stay hidden until that review can complete; a later clean frame
cannot briefly resurrect them. Request epochs stop an older extraction clearing
a newer refresh. Hung screenshot transport is independently abort-raced, and
explicit recaptures coalesce while image capture is already outstanding.

## Latency and resource architecture
- Native `spawn_blocking` does capture, full-resolution pixel matching and checks.
- Webview receives geometry, diagnostics, a reduced thumbnail, and occasionally a
  high-resolution JPEG selected for semantic reading. Verified local frames use
  a 160px gate thumbnail instead of 640px (up to 16x fewer thumbnail pixels).
- Requested pacing: 50ms AFTER a finished frame while changing, 125ms when a
  visual anchor is stationary, 250ms without an anchor. This is NOT a promise of
  20fps or 50ms end-to-end delay: capture, search, IPC and paint add time.
- One native capture at a time, one semantic request, no accumulated video queue.
  Fixed templates, 16M source-pixel ceiling, 600K template-pixel ceiling, 1.5M
  candidate-position ceiling. Budget exhaustion withholds the pointer.
- `Export tracking metrics` in existing Inline Coach controls saves counts and
  last-240-frame p50/p95/max CPU/native timings, not screenshots or source text.
  Position correctness and answer accuracy stay null without independent labels.

## What the tests prove / do NOT prove
`qa/visual-tracker/verify.py` renders authored coding scenes in Chromium, captures
PGM pixels, then executes the SAME Rust module used by the native shell. The
tracking executable receives only image paths and the initial seed. DOM is used
only by the test driver to prepare screenshots and record independent ground
truth; later text positions or scroll offsets never enter the tracker.

Tests include horizontal/vertical motion, off-screen return, repeated blocks,
small operator/two-pixel edits, surrounding changes, filename changes, occlusion,
zoom and 100/125/150/200% rasterization. Kernel time excludes OS capture, grayscale
conversion, IPC, rendering, vision acquisition and model generation. Initial
rectangles in the benchmark are known, not produced by real vision. Screenshot
fixture passes do not certify physical macOS/Windows capture/input or a real
interview answer. No provider calls or automatic policy promotions occur.

Limitations: exact pixel checking can lose lock during antialiasing/subpixel
scroll, blinking carets, selection, folding or occlusion. Matching/initial vision
coordinates remain estimates, not calibrated probabilities. Identical visible
screens cannot reveal a file change; off-screen edits are unavailable. Capture
is still xcap selected-window screenshots, not yet a persistent ScreenCaptureKit
or Windows Graphics Capture stream. Test that the compositor excludes our own
overlay; there is no monitor fallback and no invisibility/proctor-bypass claim.

## Trying the matching frontend + native source
This is part of PR #22, not a released updater. Do not install an old production
binary expecting a Preview refresh to add commands. With the normal Tauri build
prerequisites, project dependencies and LOCAL test provider/Clerk configuration:

```
pnpm install --frozen-lockfile
# macOS: build the existing audio helper first
bash scripts/build-audio-helper.sh
# With cargo-tauri v2 installed, in a second/local terminal as appropriate:
cargo tauri dev --config src-tauri/tauri.tracker-dev.conf.json
```

The dev config starts `pnpm dev` on localhost:3000. Existing debug-only localhost
allowance is reused; release origin checks/capabilities/auth are NOT broadened.
On Windows use the existing documented sidecar build setup, not the macOS script.
No secrets are bundled or copied. Open a permitted Repository Coach session,
select the IDE WINDOW, wait for the first screenshot interpretation and current
patch, enter Inline Coach, focus the IDE, then scroll/edit. The native tracker
arms automatically only when sufficient source-row evidence exists.

Recover through Cmd/Ctrl+Shift+L or the tray. End capture before switching builds.
Run the same 10-minute scenario at several DPI/font settings; independently mark
wrong-pin episodes, missed pins, operator edits and reacquisition times. Export
tracking metrics and the separate rehearsal evidence as applicable; do not claim
readiness from a zero API count or a fast kernel benchmark.
