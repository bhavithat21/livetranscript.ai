# App appearance

Open **Settings → App appearance** to change the name, select an icon, or choose a local PNG/JPEG. The same preference drives the header, compact navigation, browser title/favicon, and desktop window title. Previous desktop name presets migrate to this preference; a name already saved in Settings takes precedence.

Images stay on the device. Uploads are limited to 2 MB and 4096 × 4096 pixels, decoded locally, and fitted within a 256 × 256 PNG without cropping. The form reports invalid images, storage failures, and denied native updates. Reset restores both name and icon. A completed upload cannot overwrite a later preset choice or reset.

| Surface | Runtime customization |
| --- | --- |
| App header, navigation, browser title/favicon | Name and icon |
| Desktop window title, macOS/Windows/Linux | Name |
| Desktop window icon, Windows/Linux | Icon, with the current desktop capability update |
| Installed app name, launcher shortcuts, macOS Dock icon | Rebuild the installer |
| Executable/process name, bundle identifier | Kept unchanged |

The desktop runtime loads the hosted application. Older installers may lack the new window-icon permission; the web preference still saves and the UI requests a desktop update. macOS does not claim a runtime Dock icon change. A browser tab cannot rename the installed program.

## Prepare a custom installer

The helper creates a separate [Tauri configuration overlay](https://v2.tauri.app/reference/config/). It preserves all existing main-window settings and inherits the bundle identifier, updater key/endpoint, signing configuration, and executable name. It does not rewrite the checked-in base config or a signed installed bundle.

From the repository root, choose a **new output directory** and a square PNG (256–4096 px, preferably 1024 px):

```sh
node scripts/brand-desktop.mjs --name "My Workspace" --icon /path/my-icon.png --out /tmp/my-workspace-branding
npx @tauri-apps/cli icon /tmp/my-workspace-branding/source.png --output /tmp/my-workspace-branding/icons
npx @tauri-apps/cli build --config /tmp/my-workspace-branding/tauri.branding.conf.json
```

Use paths appropriate to your operating system and quote paths containing spaces. For a name-only build, omit `--icon` and the icon-generation command. The script refuses to overwrite an existing overlay; choose another output directory for another variant. The [Tauri icon command](https://v2.tauri.app/develop/icons/) creates the `.icns`, `.ico`, and PNG bundle assets.

Build on the target operating system with the prerequisites and audio sidecar described in [the desktop README](../src-tauri/README.md). Production installers still require the existing OS and updater signing credentials. This helper does not bypass signing. A branded build keeps the same application identity, so it replaces the installed app rather than installing a second independent copy. Future standard updates can restore standard installed branding; use the overlay when producing future custom builds too. The hosted UI keeps its separate device preference: also choose your preferred name/icon in **Settings → App appearance** to match the installed branding. Reset returns the hosted UI to LiveTranscript.

## Verification

```sh
npm run test -- lib/appIdentity
node --test scripts/test-brand-desktop.mjs
```

The tests cover shared preferences and legacy migration, save/reset/reload, invalid input and first-error focus, canceled upload races, storage failure, PNG/JPEG bounds, image normalization and cleanup, and mocked native resource lifetimes/permissions. On physical Windows/macOS machines, verify window-title changes, Windows window-icon changes, restart persistence, denied native permission feedback, and the installed custom icon/name. Automated bridge tests do not replace these platform checks.
