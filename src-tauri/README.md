# LiveTranscript Desktop (Tauri v2)

A Windows and macOS shell whose main window loads the deployed web app from
`https://livetranscript.ai`. `frontendDist` in `tauri.conf.json` points at
that remote URL, so interface assets remain hosted while Rust/Tauri supplies
operating-system capabilities through feature-detected bridges.

| Runtime layer | Responsibilities | Delivery boundary |
| --- | --- | --- |
| Hosted web app | Interface, browser microphone, and browser screen/tab-audio capture | A web deployment updates this layer |
| Native shell | System-output audio, selected-monitor capture, optional remote input, tray/shortcut handling, and desktop updates | Native command or permission changes require a new desktop package |

WebView2 on Windows and WKWebView on macOS still handle browser microphone and
screen/tab-audio prompts. System-output capture is a separate path:
`useNativeCapture()` detects Tauri, invokes `start_native_audio`, and receives
PCM through an IPC channel. A normal browser never receives those native
capabilities and continues to use its browser capture path.

## Prerequisites (on the build machine)

- **Current stable Rust** (the locked desktop dependencies use recent Rust APIs). Install/upgrade: `rustup update stable`.
- **Node** (for the Tauri CLI).
- Platform build deps:
  - **Windows:** WebView2 runtime (preinstalled on Win10/11) + MSVC build tools.
  - **macOS:** Xcode command line tools (`xcode-select --install`).
- Tauri CLI: `npm i -g @tauri-apps/cli` (or use `npx @tauri-apps/cli`).

## Develop / run

```bash
# from repo root
npx @tauri-apps/cli dev
```

This opens a native window loading livetranscript.ai. (Because `frontendDist` is a
remote URL, there is no local dev server to start.)

## Build installers

```bash
npx @tauri-apps/cli build
```

Outputs to `src-tauri/target/release/bundle/`:
- **Windows:** `.msi` and/or `.exe` (NSIS)
- **macOS:** `.app` and `.dmg`

## Code signing (required for distribution)

- **Windows:** Authenticode certificate — set `WINDOWS_CERTIFICATE` /
  `WINDOWS_CERTIFICATE_PASSWORD` or configure `bundle.windows.certificateThumbprint`.
- **macOS:** Apple Developer ID — sign + **notarize** (`APPLE_ID`,
  `APPLE_PASSWORD`/app-specific, `APPLE_TEAM_ID`). Unsigned builds are blocked by
  Gatekeeper.

## Icons

Regenerate from a source PNG (≥512×512):

```bash
npx @tauri-apps/cli icon path/to/logo.png
```

The current icons are placeholders (brand emerald `#0f766e`); replace `app-icon.png`
and re-run to brand them.

## Native capabilities

System audio is implemented: Windows uses WASAPI loopback and macOS uses the
audio-capture sidecar. `start_native_audio` streams PCM through a Tauri channel to
the web audio bridge; `stop_native_audio` tears down that session.

Owner-approved remote assistance adds selected-monitor capture and optional
mouse/keyboard control. It starts view-only, requires live controller heartbeats,
and stops on disconnect, tray stop, emergency shortcut, app exit or panic-hide.
See [REMOTE-ASSIST.md](REMOTE-ASSIST.md) for the bridge, permissions, limits and
real-device verification procedure. `Desktop checks` compiles the complete shell
on macOS and Windows and runs its platform-independent input/lease tests.
