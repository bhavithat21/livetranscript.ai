# Inline Coach: adjacent edit guidance (experimental candidate)

## Interaction contract
A monitor-sized transparent native surface shows **one current edit** beside its
observed source, with the explanation above the replacement code. Dashboard,
sidebar, transcript panes and other chrome remain mounted but are not visible.
It never applies code or forwards the same click to two applications.

The selected source is an **IDE window**, not a full display. xcap window capture
is used to avoid including our own composited annotation. If window capture is
unsupported/blocked, this mode fails instead of falling back to monitor images.
Ordinary display capture, browser capture, and source import still work in the
normal repository workspace, but do not grant spatial overlay eligibility.

## User flow (requires new native build + matching web candidate)
1. In an explicitly permitted running Repository Coach session, open
   **Inline Coach → Find IDE windows**. Approve Screen Recording if requested.
2. Select the actual editor/browser IDE window, entirely within one display.
   Select **Share selected IDE window**; let the first observation complete.
3. Restore the app to normal window size (not OS fullscreen/maximized). Select
   **Enter Inline Coach**, then click your IDE to focus it. Input passes underneath.
4. Cmd/Ctrl+Alt+Shift+Left/Right selects the previous/next edit; Cmd/Ctrl+Shift+L
   restores the normal app. Tray → Restore mouse interaction is independent.
   Some global shortcuts can be refused by the OS or conflict with other apps.
5. Existing controller review handles observed edits. A changed preimage hides
   old instructions until fresh guidance is available; it does not falsely
   advance based on a click or claim that a matching text edit passes tests.

A CSS arrow-only policy applies inside the interactive LiveTranscript webview.
In pass-through the **underlying application** determines the mouse shape; no
system-wide cursor suppression, interception, mirroring or concealment promise.

## Evidence and positioning
Optional `lineRects` are normalized to the entire supplied selected-window image.
Vision is instructed to locate actual numbered rows only and omit clipped,
wrapped or ambiguous rows. Both extraction validators enforce bounded geometry,
unique numeric line identity and membership in the observed source range.
Code, filename, file revision, result currency and exact complete patch preimage
must match the newest screen. Coordinates are not sent into reasoning context.

Known pixel rectangles are projected using native window/monitor bounds. Windows
uses physical bounds divided by monitor scale; macOS's capture window bounds are
logical. Negative monitor origins are retained, never treated as global (0,0).
Moving between displays, crossing display edges, minimizing/closing the source,
loss of focus, changing scaling/viewport, or an old local sample hides the pin.
Local image keys invalidate before slow vision/model processing finishes. There
is at most one native read and one extraction per source at a time; existing
model budgets remain. Full image reads use the existing JPEG/size limits.

Vision coordinates **are estimates**, not proof of correct localization. No
claim that a score of .95 is a calibrated probability. The user must visually
confirm highlighted source; per-device calibration/error measurement is a gate.
Very small edits can be lost in a reduced luminance sample; this is not an
immediate-input validation guarantee. Cursor blinking can temporarily invalidate
anchors. There is no OCR dependency or video transcript repair.

Equal-count replacement blocks become per-line steps. Insertions attach to an
existing neighboring line explicitly labeled before/after; missing lines are
never inferred. One patch's explanation is reused for its line steps, not falsely
represented as independently generated per-line reasoning. Larger edits are
shown in the full workspace instead of clipped partial replacement code.

Callouts choose right, left, below, or above based on available space. They do
not intersect the target rectangle; they may obscure other surrounding code.
When there is no safe room the overlay shows a location message, not a wrong pin.
A small recovery hint remains visible. Motion animations are intentionally absent.

## Native recovery
Mouse-ignore is enabled only after topmost succeeded and a recovery shortcut or
tray is registered. Failure rolls back; mouse restoration is attempted before
stacking restoration. Prior window geometry/resizability is restored on exit.
A watchdog restores the main window after capture heartbeats stop for >3 seconds.
Native UI mutations are dispatched to the main thread. Unsupported older shells
show a visible update requirement instead of pretending that a click succeeded.

## Validation boundaries
Browser fixtures render the actual annotation component over a **synthetic IDE**
with deterministic boxes. They test projection/collision, source matching, stale
pin suppression and cursor UI, NOT live vision localization or OS click routing.
Native compile/unit checks do not establish physical DPI, compositor behavior,
frameless window focus or capture performance. No new installer/update release
should be promoted until the physical-device acceptance below is completed.

Native acceptance: Windows 100/125/150/200% scaling; macOS Retina; negative-origin
second display; source scroll/file switch/edit/folding; source move/resize and
monitor switch; actual input pass-through; tray/hotkey recovery; capture failure
and stalled main-thread tests; editor/callout contrast and complete replacement
legibility. Measure target-box pixel error and false-pin rate on independent
annotated captures, not screenshots from the synthetic test page.

This work branches from production 6ddebb82. It does not merge PR #21's separate
spoken-requirement/rehearsal changes or provision any provider credentials.
