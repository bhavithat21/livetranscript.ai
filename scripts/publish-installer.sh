#!/usr/bin/env bash
# Publish a signed desktop installer to Vercel Blob (public) and print the URL to
# use for NEXT_PUBLIC_DOWNLOAD_MAC_URL / NEXT_PUBLIC_DOWNLOAD_WIN_URL.
#
# Why Blob: public, on our existing Vercel platform (no new vendor), serves large
# binaries to beta users directly — unlike the private GitHub repo whose releases
# can't be downloaded publicly.
#
# Prereqs (one-time): a Blob store on the Vercel project
#   npx vercel blob create-store livetranscript-downloads
# Then run this per installer:
#   ./scripts/publish-installer.sh path/to/LiveTranscript.dmg
#   ./scripts/publish-installer.sh path/to/LiveTranscript-setup.exe
#
# It prints the public URL. Set it in Vercel env (Production):
#   npx vercel env add NEXT_PUBLIC_DOWNLOAD_MAC_URL production
# then redeploy. The download page picks it up automatically.

set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 <path-to-installer>  (.dmg or .exe)" >&2
  exit 1
fi

echo "Uploading $FILE to Vercel Blob (public)…" >&2
# --add-random-suffix=false keeps a stable, predictable public path per filename.
npx vercel blob put "$FILE" --add-random-suffix=false
echo "" >&2
echo "→ Copy the URL above into NEXT_PUBLIC_DOWNLOAD_MAC_URL or _WIN_URL, then redeploy." >&2
