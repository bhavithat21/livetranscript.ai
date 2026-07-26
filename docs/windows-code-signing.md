# Windows code signing (kill the "virus detected" warning)

The `/download` Windows `.exe` is **unsigned** (CI job is literally
"Windows build (unsigned)"). Chrome Safe Browsing + Windows SmartScreen flag any
unsigned installer with no download reputation as "virus detected" / "not
commonly downloaded." It is not a real virus — just missing an Authenticode
signature. This doc is the turnkey fix.

## Why not a physical EV USB token

Since 2023-06-01, all new OV **and** EV certs keep the private key on a hardware
token or cloud HSM — the key can't be exported to a file. A **physical EV token
can't be plugged into a GitHub Actions runner**, so it would force manual signing
on a local Windows box every release. Our pipeline is CI-based, so a token is the
wrong tool.

## Use Azure Trusted Signing instead (CI-compatible, same trust)

- Same **instant SmartScreen trust** as EV — warning gone immediately, no
  reputation wait.
- **~$9.99/month** vs ~$300/yr for an EV token.
- Signs **inside CI** via a cloud HSM — no physical token.
- Tauri v2 supports it natively through `bundle.windows.signCommand`.
- Requirement: identity validation needs an org/individual **3+ years old**.

### Human-gated setup (only the account owner can do these)

1. Create an **Azure account** + a **Trusted Signing** account and a
   **certificate profile** (portal: "Trusted Signing Accounts").
2. Complete **identity validation** (3+ years old requirement).
3. Create a service principal / app registration and grant it the
   **Trusted Signing Certificate Profile Signer** role on the signing account.
4. Note: endpoint region (e.g. `https://wus2.codesigning.azure.net`), account
   name, profile name.

### Turnkey code changes (apply once the account exists)

**1. `src-tauri/tauri.conf.json`** — add `windows.signCommand` under `bundle`
(replace the three `My*` placeholders with your account/profile/app name):

```jsonc
  "bundle": {
    "active": true,
    "targets": "all",
    "windows": {
      "signCommand": "artifact-signing-cli -e https://wus2.codesigning.azure.net -a MyAccount -c MyProfile -d LiveTranscript %1"
    },
    // ...existing externalBin, icon, etc.
  }
```

**2. `.github/workflows/desktop-release.yml`** — install the signing CLI on the
Windows matrix leg before the build step, and pass Azure creds:

```yaml
      - name: Install Azure signing CLI (Windows)
        if: matrix.platform == 'windows-latest'
        run: cargo install artifact-signing-cli

      # ...in the tauri-action `env:` block, add:
        env:
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
```

**3. Repo secrets** — add `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET` (from the service principal in step 3 above).

### Do NOT apply #1/#2 before the account is live

A live `signCommand` with no Azure account will **fail every Windows build** and
turn the currently-green CI red. Apply only after secrets are set.

## Interim: click-through (works today, warning still shows)

Until signing is live, beta testers can bypass:
- **Chrome download bar:** the ⌄ next to the blocked file → **Keep**.
- **SmartScreen on run:** **More info** → **Run anyway**.

## macOS note

The Mac build is signed with an **Apple _Development_** cert
(`Authority=Apple Development: Revanth...`), not a Developer ID distribution cert,
so Gatekeeper still warns (right-click → Open to bypass). Proper Mac distribution
needs a **Developer ID Application** cert + notarization — the
`desktop-release.yml` env block already has the `APPLE_*` secret slots wired for
tauri-action; they just need real values.
