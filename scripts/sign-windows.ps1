# Windows Authenticode signing via Azure Trusted Signing — invoked by Tauri's
# bundle.windows.signCommand for each Windows artifact ($args[0] = file to sign).
#
# SELF-GUARDING: signing only runs when LT_WINDOWS_SIGN=1 (set by the release
# workflow's "Enable Windows signing" step, which fires only when Azure creds exist).
# Otherwise this exits 0 WITHOUT signing — so the unsigned fast build (windows-build.yml)
# and any local build stay green. This is why a signCommand can safely live in the
# base config: it's a no-op unless explicitly enabled.
#
# Requires (set as env by the workflow when enabled): AZURE_TENANT_ID, AZURE_CLIENT_ID,
# AZURE_CLIENT_SECRET, AZURE_TS_ENDPOINT, AZURE_TS_ACCOUNT, AZURE_TS_CERT_PROFILE.

param([string]$FilePath)

if ($env:LT_WINDOWS_SIGN -ne '1') {
    Write-Host "sign-windows: LT_WINDOWS_SIGN not set — skipping signing (unsigned build)."
    exit 0
}

if (-not $FilePath -or -not (Test-Path $FilePath)) {
    Write-Error "sign-windows: no valid file to sign ('$FilePath')."
    exit 1
}

# Install the Trusted Signing dotnet tool + Azure auth on first use (CI is ephemeral).
Write-Host "sign-windows: signing $FilePath via Azure Trusted Signing..."
dotnet tool install --global azuresigntool 2>$null | Out-Null

# azuresigntool authenticates with the AZURE_* service-principal env vars.
azuresigntool sign `
    --azure-key-vault-url "$env:AZURE_TS_ENDPOINT" `
    --azure-key-vault-tenant-id "$env:AZURE_TENANT_ID" `
    --azure-key-vault-client-id "$env:AZURE_CLIENT_ID" `
    --azure-key-vault-client-secret "$env:AZURE_CLIENT_SECRET" `
    --trusted-signing-account "$env:AZURE_TS_ACCOUNT" `
    --certificate-profile "$env:AZURE_TS_CERT_PROFILE" `
    --timestamp-rfc3161 "http://timestamp.acs.microsoft.com" `
    --timestamp-digest sha256 `
    --file-digest sha256 `
    "$FilePath"

if ($LASTEXITCODE -ne 0) {
    Write-Error "sign-windows: signing FAILED for $FilePath."
    exit $LASTEXITCODE
}
Write-Host "sign-windows: signed $FilePath."
