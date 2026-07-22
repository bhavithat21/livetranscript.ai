# LiveTranscript Desktop (Tauri v2)

A thin native shell (Windows + macOS) that loads the deployed web app
(`https://livetranscript.ai`) in a native window. **The web app is untouched** —
this is an additive wrapper: `frontendDist` in `tauri.conf.json` points at the
remote URL, so there are no bundled frontend assets and no changes to `app/`.

Mic and screen/tab-audio permission prompts are handled by the platform webview
(WebView2 on Windows, WKWebView on macOS), so transcription works exactly as in
the browser.

## Prerequisites (on the build machine)

- **Rust 1.85+** (Tauri v2 needs a recent toolchain). Install/upgrade: `rustup update stable`.
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

## Phase 2 — silent system-audio capture (not yet wired)

The one native capability worth adding: **WASAPI loopback (Windows) / CoreAudio
tap (macOS)** for full-system audio capture with **no screen-share picker**. It
would register a `#[tauri::command]` in `src/lib.rs`, stream PCM to the web layer
via an additive `window.__lt_native` bridge (feature-detected — the browser path
stays unchanged), and feed the existing stage-4 PCM encoder. See
`docs/low-latency-design.md` §6.
