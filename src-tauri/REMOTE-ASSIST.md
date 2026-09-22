# Native remote assistance

The web host starts and approves the connection. Native capture and input are
available in the macOS and Windows desktop shell; the browser can be a controller.
This code does not create an unattended service, relay, reverse shell or OS login
session. Installed builds made before these commands were added must be updated.

## Bridge, protocol version 1

Invoke arguments and response fields use camelCase.

| Command | Arguments | Result |
| --- | --- | --- |
| `remote_assist_capabilities` | none | `supported`, `protocolVersion`, `platform`, `stopShortcut`, `stopShortcutRegistered` |
| `remote_assist_displays` | none | Array of displays with `id`, `name`, `x`, `y`, `width`, `height`, `scaleFactor`, `isPrimary` |
| `remote_assist_start` | `displayId`, `onFrame` Tauri binary channel | `leaseId`, `display`, `heartbeatMs:1000`, `expiresAfterMs:5000`, `maxFrameBytes:524288` |
| `remote_assist_heartbeat` | `leaseId` | void |
| `remote_assist_set_control` | `leaseId`, `enabled` | void; enabling may return an Accessibility permission error |
| `remote_assist_input` | `leaseId`, `event` | void |
| `remote_assist_stop` | `leaseId` | void; idempotent and cannot stop a newer lease |

Each binary channel message is a complete JPEG, at most 512 KiB. Frames fit
1280 × 900 and are sent at a maximum of 5 fps. Forward over the approved WebRTC
connection with bounded chunking and backpressure; never forward through the
transcript room. No screenshots are saved to disk. This format prioritizes text
navigation; it is not a measured low-latency video codec.

`event` is one of:

```ts
type Input =
  | { seq: number; type: 'move'; x: number; y: number }
  | { seq: number; type: 'button'; button: 'left' | 'middle' | 'right'; down: boolean }
  | { seq: number; type: 'key'; key: string; down: boolean }
  | { seq: number; type: 'scroll'; deltaX: number; deltaY: number }
  | { seq: number; type: 'text'; text: string };
```

Coordinates are fractions from 0 through 1 of the selected monitor. Native code
maps them to macOS CoreGraphics logical points or Windows physical virtual-desktop
pixels; callers must not multiply by `scaleFactor`. Negative monitor origins and
mixed DPI are supported by this mapping. Changing display layout ends sharing.
Keys are single printable Unicode characters or the explicit DOM names in
`remote-assist-core`. Scroll steps are integers between -20 and 20. Text is at most
1,000 UTF-16 units / 4,000 UTF-8 bytes, nonempty and with no NUL. The macOS input
adapter returns an explicit unsupported-key error for Insert. Input sequences must increase
throughout a lease, including across control disable/enable; maximum 240 events/s.

## Session lifetime and stop controls

Start only after the approved controller's connection is ready. Sessions start
view-only. Enabling input is a separate host action. Heartbeat every second only
after a new authenticated controller ping; neither a local timer nor input itself
renews the lease. A five-second gap ends capture/control and releases held keys and
mouse buttons. Expired leases cannot be renewed. A session lasts at most one hour.

The `remote-assist-stopped` event contains `{leaseId, reason}`. Stop forwarding
frames/input and dispose the connection when this event arrives. The host also
stops on its Stop button, the **Stop remote assistance** tray item, app close/exit,
or panic-hide. The emergency shortcut is **Cmd+Option+Shift+X** on macOS and
**Ctrl+Alt+Shift+X** on Windows. Display it as available only when
`stopShortcutRegistered` is true; OS shortcut conflicts are possible and the tray
stop remains available.

Native commands require the `main` webview at `https://livetranscript.ai` (localhost
is additionally accepted in debug builds). They are not callable by the remote
controller. The host remains responsible for its separate server-authenticated
session membership and approval; possessing a transcript room ID never grants
native input authority.

## Permissions and limits

macOS video capture requires Screen Recording even on macOS 15 and newer, where
the existing audio tap needs only audio permission. Input additionally requires
Accessibility. Permission denial is returned as an error; a restart can be needed
after a new Screen Recording grant. Windows cannot inject into elevated programs,
UAC/secure desktops or a locked login screen. The app does not elevate itself.

Cross-network connectivity depends on the configured WebRTC ICE/TURN services.
These native commands do not provide a TURN relay. This implementation has no file
transfer or clipboard synchronization. Runtime window icon/title personalization
is separate from installed binary name, code signing and Dock icon packaging.

## Verification

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml -p remote-assist-core
cargo check --locked --all-targets --manifest-path src-tauri/Cargo.toml
```

`Desktop checks` runs both commands on macOS and Windows after producing the audio
sidecar required by the existing bundle. The core tests cover lease expiration,
non-renewability, view-only input rejection, revocation, replay, rate/payload
limits, malformed packets, and negative-origin/Retina coordinate mapping.

On real devices, test two monitors with different scaling and one left/above the
primary. Confirm all four monitor corners, dragging, Unicode input, modifier-key
release, host revoke, controller tab close, network loss, emergency shortcut,
panic-hide, screen permission denial and Accessibility denial. Compile success
does not establish that OS permissions, capture performance or multi-monitor
input work on a user's hardware.

API sources: [XCap](https://github.com/nashaofu/xcap),
[Enigo](https://docs.rs/enigo/0.6.1/enigo/),
[Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput),
[virtual-desktop mouse coordinates](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput).
