# Desktop cursor and mouse pass-through

The native title bar is present in all workspaces. Fixed-arrow styling applies to
LiveTranscript web content only. Buttons, text inputs, selectable transcripts,
and links retain their normal click and keyboard behavior in interactive mode.
The cursor is not hidden and the global OS cursor is not modified. Native window
borders, system dialogs, native select popups, iframes from other origins and the
application underneath retain their own cursor behavior. Native resizing remains
available, so the OS can use its resize cursor during a native resize.

## Use

1. Install the new desktop binary; a web refresh cannot add native commands.
2. Choose **Pass through** in the title bar to pin the visible overlay and let
   mouse clicks/wheel events go to the underlying application.
3. Toggle back with **Command+Shift+L** (macOS) or **Ctrl+Shift+L** (Windows).
   The shortcut is advertised only when native registration succeeded.
4. The menu-bar/system-tray **Restore mouse interaction** command explicitly
   disables pass-through and reveals/focuses the window. Use it when a hotkey is
   occupied or when the web interface reloads. Show/restore also restores input.

A mouse event has one recipient: interactive LiveTranscript OR the underlying
application. The app does not intercept/duplicate global mouse clicks, create
synthetic clicks, suppress OS indicators or bypass platform controls. Mouse
pass-through is not keyboard forwarding: click the underlying application to
focus it before typing. The global recovery shortcut continues to work unfocused.

Pass-through starts OFF on each native launch. It is not stored in localStorage.
Enabling it requires a registered shortcut or a successfully built tray. The
previous topmost state is restored on unlock. OS failures are surfaced, not
silently treated as success. A legacy shell can release a lock but must be
updated before enabling pass-through through the new control.

## Implementation and tests

- `src-tauri/src/pointer_mode.rs`: tested transition logic and failure rollback.
- `src-tauri/src/lib.rs`: main-thread serialization, real Tauri
  `set_ignore_cursor_events`, state event, shortcut and tray recovery.
- `lib/desktop/pointerClient.ts`: shared native state, event updates plus bounded
  polling, late-read suppression, cleanup and explicit errors.
- `app/globals.css`: desktop-only fixed-arrow rules without pointer-event changes.
- `qa/desktop-pointer`: actual component/CSS browser test with explicitly mocked
  IPC. Verifies cursor style and interaction, NOT OS-level input delivery.

Run `pnpm exec vitest run lib/desktop/pointerClient.test.ts components/TitleBar.test.tsx`,
`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib pointer_mode::tests`,
and `node qa/desktop-pointer/build.mjs && python3 qa/desktop-pointer/verify.py`.

## Required physical-device check before relying on the feature

On both macOS and Windows, with the new unsigned test binary:
- Hover/click buttons, transcript text, inputs and nested icons in the native
  webview. The content cursor should stay an arrow; text selection/copy remains.
- Put a text editor behind the app. Enable pass-through; click and scroll over
  the overlay. Confirm only the underlying editor receives those mouse events.
- Confirm audio capture and answer updates continue without mouse interaction.
- Restore via the global shortcut while the editor has focus, and separately via
  the tray. Verify normal buttons work and the prior topmost preference returns.
- Reload the webview, hide/show the window, and restart the app. Check recovery
  after reload/show and interactive default after restart.
- Occupy the shortcut before launch; verify tray-only recovery is reported. If
  neither recovery mechanism is available, enabling pass-through must fail.

CI build success and mocked OS-state tests do not certify these device behaviors.
No updater manifest or signed/notarized release is published by this change.
