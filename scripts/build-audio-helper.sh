#!/usr/bin/env bash
# Compiles the macOS ScreenCaptureKit helper (src-tauri/binaries/audio-capture.swift)
# into Tauri sidecar binaries. Tauri resolves sidecars as
# "audio-capture-{target-triple}", so we emit every triple we ship:
# both arches plus the universal name used by CI's universal-apple-darwin bundle.
#
# Consumed by: developers (dev builds) + .github/workflows/desktop-release.yml (macOS runner).
# Produces: src-tauri/binaries/audio-capture-{aarch64,x86_64,universal}-apple-darwin (gitignored).
set -euo pipefail
cd "$(dirname "$0")/../src-tauri/binaries"
SRC=audio-capture.swift
FRAMEWORKS=(-framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation)
# Embed an Info.plist section: a bare helper binary has no bundle, so without
# this TCC can't attribute the CoreAudio process-tap permission to it — the tap
# "starts" (noErr) but silently delivers zero frames when spawned by the app.
EMBED=(-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker audio-capture-info.plist)

swiftc -O -target arm64-apple-macos13.0  -o audio-capture-aarch64-apple-darwin "$SRC" "${FRAMEWORKS[@]}" "${EMBED[@]}"
swiftc -O -target x86_64-apple-macos13.0 -o audio-capture-x86_64-apple-darwin  "$SRC" "${FRAMEWORKS[@]}" "${EMBED[@]}"
# Universal name used by CI's `--target universal-apple-darwin` bundle.
lipo -create audio-capture-aarch64-apple-darwin audio-capture-x86_64-apple-darwin \
     -output audio-capture-universal-apple-darwin
echo "built: aarch64 / x86_64 / universal apple-darwin sidecars"
