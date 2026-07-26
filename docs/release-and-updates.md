# Desktop release & auto-update runbook

How beta users get updates, and how to cut a release that the shipped app can
auto-install. Nothing here needs Apple code signing — the Tauri **updater** key is
a separate, free, self-generated key.

## The two signatures (don't confuse them)

| Signature | Cost | What it does | Needed for beta? |
|---|---|---|---|
| **Tauri updater key** (minisign) | Free, self-generated | Signs the update manifest so the app trusts a new build | **Yes — required for auto-update / the "Check for Updates" button** |
| **Apple Developer ID** (code signing + notarization) | Paid Apple account | OS trusts the app; macOS remembers the Screen-Recording grant | No (beta ships unsigned; users right-click→Open, and re-approve Screen Recording each launch until signed) |

Current state (checked into `src-tauri/tauri.conf.json`):
- `bundle.createUpdaterArtifacts: true` ✅ (build emits the signed update bundles)
- `plugins.updater.pubkey` is set ✅ (a keypair was generated at some point)
- `plugins.updater.endpoints` → this repo's `releases/latest/download/latest.json` ✅
- The **private** key matching that pubkey is **not on this machine** — it must be
  in the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret, or it was lost (see Step 1).

## Step 1 — Make sure the updater private key exists and is set

**First check if it's already wired:** GitHub → repo → Settings → Secrets and
variables → Actions. If `TAURI_SIGNING_PRIVATE_KEY` (and, if the key has a
password, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are present, the key exists —
**skip to Step 2**. (Assume it matches the committed pubkey; if a release later
fails signature verification on the client, the key was rotated → regenerate.)

**If the secret is missing and you don't have the private key backed up**, the
committed pubkey is orphaned — regenerate the pair:

```bash
# From the repo root. Prompts for an optional password (recommended).
npx @tauri-apps/cli signer generate -w ~/.tauri/livetranscript.key
```

This prints/writes two things:
- **Private key** → the contents of `~/.tauri/livetranscript.key` (keep secret).
- **Public key** → a base64 string it prints to the console.

Then:

1. Put the **public** key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
   (replace the existing value), commit, and push. The pubkey MUST match the key
   that signs releases or clients reject every update.
2. Put the **private** key + password into GitHub Actions secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` = the full contents of `~/.tauri/livetranscript.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you chose (omit/empty if none)

> Back up the private key somewhere safe (password manager). If it's lost you must
> regenerate + bump the pubkey again, and existing installs can't auto-update to
> the mismatched release — those users re-download once from `/download`.

## Step 2 — Tag a release

CI (`.github/workflows/desktop-release.yml`) builds macOS + Windows installers and
the `latest.json` updater manifest on any `v*` tag, then publishes them to a GitHub
release.

```bash
# Bump the version first (tauri.conf.json "version" + package.json), commit, then:
git tag v0.1.1
git push origin v0.1.1
```

Watch the run in the repo's **Actions** tab. On success the release has: the `.dmg`,
the `.exe`/`.msi`, their `.sig` files, and `latest.json`.

> The updater endpoint reads `releases/latest/download/latest.json`. If the repo is
> **private**, GitHub blocks anonymous downloads of release assets, so the shipped
> app's updater (unauthenticated) can't fetch them — auto-update silently fails.
> For a private repo, either make releases public or host `latest.json` + artifacts
> somewhere public (e.g. Vercel Blob, see `scripts/publish-installer.sh`) and point
> the endpoint there.

## Step 3 — How each user actually updates

- **Auto (on launch):** the app checks `latest.json` at startup; a newer signed
  version downloads + installs + relaunches. Silent.
- **Manual (tray button):** tray menu → **"Check for Updates…"** — same flow,
  on demand, with the window brought forward.
- **First hop / fallback:** the currently-installed beta has the OLD (broken)
  updater, so it can't auto-update to the first fixed build. That one is installed
  **manually** from **livetranscript.ai/download** (installers live in
  `public/downloads/`, refreshed per Step 4). Every release after auto-updates.

## Step 4 — Refresh the manual-download installers

The `/download` page serves `public/downloads/LiveTranscript-mac-arm64.dmg` and
`…-win-x64-setup.exe` (overridable via `NEXT_PUBLIC_DOWNLOAD_MAC_URL` /
`_WIN_URL`). After a release, replace those two files with the new build's
installers (or point the env vars at the release/Blob URLs) and redeploy, so new
beta users don't download a stale version. `scripts/publish-installer.sh` uploads
to Vercel Blob and prints the public URL for the env override.

## Summary — to turn on updates for beta users right now

1. Confirm/set `TAURI_SIGNING_PRIVATE_KEY` (+ password) in GitHub secrets (Step 1).
2. If the repo is private, make release assets publicly fetchable (Step 2 note).
3. Bump version, `git tag v0.1.1 && git push origin v0.1.1` (Step 2).
4. Replace the installers in `public/downloads/` and redeploy (Step 4).

No Apple signing required for any of this — that only affects the OS first-launch
warning and the repeating macOS Screen-Recording prompt.
