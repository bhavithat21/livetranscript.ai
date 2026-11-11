# Windows code signing

The desktop release workflow already supports Azure Trusted Signing. Signing is
conditional: a release build is signed only when its Azure credentials are
present, while ordinary local builds and the separate fast Windows build remain
unsigned. Do not infer an artifact's signing state from a successful workflow;
verify the downloaded installer itself.

For account creation, identity validation, and the parallel macOS setup, use the
[code-signing runbook](code-signing-runbook.md). This page describes the Windows
path that is currently checked into the repository.

## Current release path

1. The Windows release job checks whether `AZURE_CLIENT_ID` is available.
2. When configured, it exports the Azure credentials, sets
   `LT_WINDOWS_SIGN=1`, and adds
   `--config src-tauri/tauri.windows-sign.conf.json` to the Tauri build.
3. That overlay adds `bundle.windows.signCommand` without changing the base
   Tauri configuration.
4. Tauri invokes `scripts/sign-windows.ps1` for each Windows artifact. The
   script authenticates with the service principal, signs with
   `azuresigntool`, and requests an RFC 3161 SHA-256 timestamp.
5. A signing command failure fails the release instead of silently publishing an
   artifact as signed.

If Azure credentials are absent, the overlay is not merged and no signing command
runs. This keeps unsigned developer and preview builds possible without weakening
the signed release path.

## Required repository secrets

The conditional release path reads these six Action secrets:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TS_ENDPOINT`
- `AZURE_TS_ACCOUNT`
- `AZURE_TS_CERT_PROFILE`

Treat the set as one configuration unit. A present client ID enables the signing
step, so missing companion values cause signing to fail rather than falling back
to an unsigned release.

## Verify the installer

Inspect the exact installer downloaded from the release or download page:

```powershell
Get-AuthenticodeSignature .\LiveTranscript_x.y.z_x64-setup.exe |
  Select-Object Status, StatusMessage, SignerCertificate, TimeStamperCertificate
```

The status must be `Valid`, and the signer must match the intended certificate
profile. As a second check on a Windows SDK machine:

```powershell
signtool verify /pa /v .\LiveTranscript_x.y.z_x64-setup.exe
```

Also open **Properties → Digital Signatures** and inspect the signature and
timestamp. A release page, successful build, updater signature, file hash, or the
presence of Azure secrets is not evidence that a particular installer passed
Authenticode verification. Tauri updater signing proves update-package integrity;
it is separate from Windows publisher trust.
