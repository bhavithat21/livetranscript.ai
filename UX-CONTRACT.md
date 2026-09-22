# UX contract

## Product context

Technical users read transcripts, inspect repository context and collaborate on a
laptop. These changes cover `/remote`, `/settings`, shared identity and navigation.
UI language is English; expiry is a relative duration. Accessibility target is
WCAG 2.2 AA, with device/browser gaps recorded in release verification rather than
assumed complete. Visual rules are in `DESIGN.md`.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Requested capability | User request: remote connection to control own laptop and change app name/icon | Product instruction | 2026-09-22 |
| Remote authorization and lifetime | `docs/remote-assistance.md`, `lib/remote/auth.ts`, `lib/remote/protocol.ts` | Maintained API contract and implementation | 2026-09-22 |
| Native control boundary | `src-tauri/src/remote_assist`, `src-tauri/remote-assist-core` | Native lease and input contract | 2026-09-22 |
| Identity persistence | `lib/appIdentity/useAppIdentity.ts` | Device preference contract | 2026-09-22 |
| Analytics exclusion | `lib/analyticsPrivacy.ts`, `app/providers.tsx` | Capture boundary | 2026-09-22 |
| Billing, deletion and legal terms | No changes in this feature | Out of scope | 2026-09-22 |

## Visual contract

`app/globals.css` owns runtime colors, themes, controls and scrolling. `app/layout.tsx`
owns fonts. DESIGN.md mirrors these values. Review changed tokens against their
owner and inspect light, dark, native and narrow states when that platform is
available. No independent theme adapter is introduced.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | AppearanceSettings and RemoteAssist | Existing settings inline form pattern plus this contract | explicit save, invitation submit, local file picker | component tests, keyboard validation |
| Scrollbar | app/globals.css | global scrollbar tokens and baseline | native forced-colors | CSS audit and rendered inspection where available |
| Toast | Inline status/alert regions | Existing settings and remote connection state | success, recoverable error, persistent condition | component tests |

## Navigation and responsive behavior

HomeMenu and AppNav expose Remote assist. Settings owns appearance; the remote
page links there directly. Leaving the remote route ends the connection. A user
can reconnect by starting a new session. Do not preserve invite or control grants
in URLs, browser storage or analytics. Optional incoming invite fragments are
consumed into component memory and removed immediately.

Remote controls wrap on mobile. The shared screen preserves its aspect ratio.
The screen can receive pointer/keyboard events only when host control is enabled.
Escape releases held input and exits its keyboard region; Send Escape is a
separate visible action for the remote application. Text entry supports phones
and IME without relying on a hardware keyboard.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create host session | Display + Create invitation | creating | same route, waiting | invitation copy action | retry after setup/auth error | action remains in place | remote API contract |
| Join | Paste invitation + Request connection | creating, waiting | same route, helper code | code to verify with owner | inline field/error, paste fresh invitation | invalid input receives focus | remote API contract |
| Approve viewing | Owner verifies helper code | connecting | same route, view only | Connected | closed on timeout; create fresh session | stop stays reachable | native lease contract |
| Enable/revoke control | Owner permission action | busy until native acknowledgement | same route | explicit permission label | failure leaves input disabled or ends session | stays on local action | native lease contract |
| End | Either peer, native tray or shortcut | local teardown | same route setup | ended reason | native lease expires even if UI stalls | ordinary setup controls | native lease contract |
| Save name/icon | explicit save or preset/file selection | icon preparation | same settings route | saved on this device | inline error, retry or reset | invalid field receives focus | identity contract |
| Reset appearance | Reset appearance | immediate local change | same route | reset status | storage limitation stated honestly | same action region | identity contract |

## Async and resilience

Permission changes are pessimistic. No input is queued for later reconnection.
The transport owns timeouts, generation guards, peer pinning and cleanup. Duplicate
submit is blocked by both the client lifecycle and UI action guard. End stays
available while another operation is pending. Stale operations cannot reopen an
ended session. No automatic reconnect restores a prior grant.

The host API requires a real signed-in user, including on development previews.
Token/session failure tells the user to sign in or create a fresh invitation.
Missing desktop commands show an update path. Missing relay configuration is
reported as direct mode; a browser-only helper is supported, a browser-only
laptop-control host is not.

## Validation and feedback

Forms use noValidate with explicit field labels, associated errors and first-error
focus. Native radios are used for display choice. Native file picker geometry is
accepted; icon bytes are validated and resized locally. Busy labels never claim
completion. Clipboard errors offer Show invitation for manual copying. Invite
fields are masked, with an explicit reveal only on the host.

Host approval is the permission action; it is not an extra confirmation dialog.
Control enablement explains that it affects laptop applications. Turning off or
ending is immediate and needs no confirmation. No browser alert/confirm/prompt is
used. Status regions contain no copied invite, credentials or typed remote text.

## Migration and verification

The two old name preferences converge on `lib/appIdentity`; the desktop hook is a
compatibility wrapper. The installed bundle name and macOS Dock icon require a
custom installer, with signing identity and updater kept stable.

Required commands: pnpm test, pnpm exec tsc --noEmit, pnpm lint, pnpm build; native
core tests and Mac/Windows builds. `premium-ui.json` scopes the static feature
audit. Unit tests cover invalid input, peer isolation, replay, consent, cancellation,
lease expiry and icon validation. Real two-device capture/control and OS permission
testing must be recorded separately; mocks never satisfy that platform gate.

Representative sibling: existing Settings and HomeMenu. Browser coverage should
include empty/loading/error/success, keyboard, narrow viewport, dark mode and
reduced motion. Report unavailable environments explicitly. No new CRUD dataset,
calendar, Japanese UI or billing flow is introduced.
