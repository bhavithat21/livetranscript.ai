# LiveTranscript Desktop (Tauri v2)

A thin native shell (Windows + macOS) that loads the deployed web app
(`https://livetranscript.ai`) in a native window. **The web app is untouched** —
this is an additive wrapper: `frontendDist` in `tauri.conf.json` points at the
remote URL, so there are no bundled frontend assets and no changes to `app/`.

Mic and screen/tab-audio permission prompts are handled by the platform webview
(WebView2 on Windows, WKWebView on macOS), so transcription works exactly as in
the browser.

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
