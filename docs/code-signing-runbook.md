# Verified code signing — turnkey runbook (macOS + Windows)

The desktop app ships **unsigned** today (macOS "unidentified developer", Windows
SmartScreen warning). The CI is **already wired** so signing turns on the moment you
add the secrets below — no code change needed, and the build stays green/unsigned
until then. Everything here is **human-gated**: it needs paid accounts + identity
verification only the account owner can complete.

> Updater signing (`TAURI_SIGNING_*`, minisign) is separate and already set — that
> proves an *update* came from us. This doc is OS **code signing** (Gatekeeper /
> SmartScreen trust).

## How the wiring works (so nothing breaks before you're ready)

- **macOS** — `.github/workflows/desktop-release.yml` step *"Enable macOS signing"*
  exports the `APPLE_*` vars into the job env **only if `APPLE_CERTIFICATE` secret is
  non-empty**. Absent → the vars never exist → clean unsigned build (the empty-var
  crash is avoided). Present → tauri-action signs + notarizes automatically.
- **Windows** — `src-tauri/tauri.conf.json` `bundle.windows.signCommand` runs
  `scripts/sign-windows.ps1`, which **no-ops (exit 0) unless `LT_WINDOWS_SIGN=1`**.
  The release workflow sets that flag only when the Azure creds exist; the unsigned
  fast build (`windows-build.yml`) never sets it, so it stays green.

## macOS — Apple Developer ID + notarization

1. Enrol in the **Apple Developer Program** ($99/yr) — requires Apple ID + identity
   verification. https://developer.apple.com/programs/
2. In Xcode or the portal, create a **"Developer ID Application"** certificate. Export
   it as a `.p12` with a password.
3. Create an **app-specific password** for notarization at appleid.apple.com
   (Sign-In & Security → App-Specific Passwords).
4. Add these **GitHub repo secrets** (Settings → Secrets → Actions):
   - `APPLE_CERTIFICATE` — base64 of the `.p12` (`base64 -i cert.p12 | pbcopy`)
   - `APPLE_CERTIFICATE_PASSWORD` — the `.p12` password
   - `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Your Name (TEAMID)`
   - `APPLE_ID` — your Apple ID email
   - `APPLE_PASSWORD` — the app-specific password from step 3
   - `APPLE_TEAM_ID` — your 10-char Team ID
5. Re-run the release (push a new tag). The mac build is now signed + notarized;
   Gatekeeper opens it with no warning.

## Windows — Azure Trusted Signing (CI-compatible, ~$10/mo)

Chosen over a physical EV token because post-2023 EV keys are hardware-only and can't
sign inside CI. Trusted Signing gives the **same instant SmartScreen trust** via a
cloud HSM. Requires an org/individual identity **3+ years old**.

1. Create an **Azure account** → a **Trusted Signing account** + a **certificate
   profile** (portal: "Trusted Signing Accounts"). Complete identity validation.
2. Create a **service principal** (App registration) with the **Trusted Signing
   Certificate Profile Signer** role on the account.
3. Add these **GitHub repo secrets**:
   - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (the service principal)
   - `AZURE_TS_ENDPOINT` — your Trusted Signing account endpoint URL
   - `AZURE_TS_ACCOUNT` — the Trusted Signing account name
   - `AZURE_TS_CERT_PROFILE` — the certificate profile name
4. Re-run the release. `sign-windows.ps1` signs each installer via `azuresigntool`;
   SmartScreen trusts it immediately.

## Verify after enabling

- macOS: `spctl -a -vv /Applications/LiveTranscript.app` → "accepted / Notarized".
- Windows: right-click the `.exe` → Properties → **Digital Signatures** tab present;
  or `signtool verify /pa LiveTranscript_x.y.z_x64-setup.exe`.
- Either platform: download from `/download` on a clean machine — no warning.

## Cost summary

| Platform | Product | Cost | Gate |
|----------|---------|------|------|
| macOS | Apple Developer Program | $99/yr | Apple identity verification |
| Windows | Azure Trusted Signing | ~$10/mo | Org/individual 3+ yrs old |
