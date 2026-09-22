# Remote assistance

Remote assistance connects a signed-in helper's browser to a desktop host. The laptop owner starts the session, selects a display, verifies the helper's six-character code, and explicitly approves that helper. Joining an invitation alone does not reveal the screen or enable input. A browser can act as a helper; controlling the host operating system requires the updated desktop application and the operating system's capture/input permissions.

## Session and transport boundaries

The remote connection has its own protocol and authorization. It does not inherit access from the transcript room feature.

| Component | Responsibility |
| --- | --- |
| `lib/remote/auth.ts` | Server-issued room and actor identities; signed, account-bound credentials; absolute session expiry; narrow Ably capabilities; ICE relay configuration |
| `app/api/remote/session/route.ts` | Authenticated, same-origin session creation, invitation joining, and Ably token refresh |
| `lib/remote/protocol.ts` | Shared identity/channel conventions and strict validation of native input events |
| Remote browser client | Pin Ably's authenticated sender ID, require host approval, negotiate WebRTC, enforce expiry, and disconnect the transport |
| Native host | Capture the selected display, map normalized coordinates to that display, require a live input lease, reject input replay, release pressed keys, and provide a local emergency stop |

Ably carries connection signaling only. Screen frames and input travel over the approved WebRTC connection, protected by WebRTC's transport encryption. Signaling messages must be bounded and validated, and sender identity comes from Ably's `message.clientId`, never a client-supplied field inside `message.data`. The helper label is derived from that ID so an untrusted nickname cannot impersonate another person. The code identifies this connection, not a person's legal identity; compare it with the intended helper before approving.

The application creates a random 128-bit room ID and independent 96-bit actor IDs. Session credentials expire 30 minutes after creation. A late join keeps the original expiry. Ably tokens are issued for at most five minutes, and refreshing them cannot renew the session. Both participants must remain signed in to refresh their tokens.

| Actor | Requests channel | Peer channel |
| --- | --- | --- |
| Host | Subscribe to `remote:<room>:requests` | Publish to `remote:<room>:peer:*` |
| Helper | Publish to `remote:<room>:requests` | Subscribe only to `remote:<room>:peer:<own-client-id>` |

Helpers cannot subscribe to each other's signaling or publish host offers. The host must approve one helper and ignore all subsequent answers and ICE candidates from other identities. The connection must close when the host stops, the session expires, the transport fails, or the native lease is lost.

There is deliberately no process-local session registry: separate serverless instances must make the same authorization decision. Stopping a session closes the host transport and native lease; it does not centrally revoke every previously issued Ably token. A copied invitation can still request signaling access until its original expiry, but cannot reopen a stopped host or recreate native permission. Restarting creates a new room and invitation. Durable, centrally revocable sessions would require a shared store or a provider revocation service.

## API contract

`POST /api/remote/session` accepts a same-origin JSON request from a signed-in account. The upload is limited to 4 KiB, measured as it arrives rather than trusting `Content-Length`. A best-effort per-instance/account token bucket limits requests to 30 per minute; this is abuse reduction, not a distributed quota.

| Request | Response |
| --- | --- |
| `{ "action": "create" }` | A host grant including a shareable invitation |
| `{ "action": "join", "invite": "…" }` | A new helper grant bound to the current account |
| `{ "action": "token", "credential": "…" }` | Ably `TokenDetails` scoped to that grant's identity and role |

A grant contains `roomId`, `role`, `clientId`, `hostClientId`, `credential`, `expiresAt` in Unix milliseconds, `displayName`, `iceServers`, and `relayConfigured`. Only the host grant includes `invite`. Account IDs are not included in the shareable invitation. Actor credentials are signed, not encrypted: they contain the actor's own account ID and must be treated as private session data.

Create and join do not accept caller-selected room IDs, role names, capabilities, client IDs, or nicknames. An invitation cannot mint a host token. An actor credential cannot be used by a different signed-in account or exchanged as an invitation. The development authentication bypass is not accepted by this endpoint.

All responses use `Cache-Control: no-store`. Credential-bearing bodies, transport descriptions, frames, input, and relay credentials must not be sent to analytics or logs. Invitations belong in a URL fragment, consumed and removed promptly by the remote page; they must not be placed in a path, query string, local storage, or session storage. Browser telemetry must exclude the remote-assistance surface, including its initial URL and session recording.

## Provisioning

Set these variables only on the server. None uses a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
| --- | --- |
| `ABLY_API_KEY` | Required. Its capabilities must include publish/subscribe for the `remote:*` namespace. Existing transcript-room access alone may be insufficient. |
| `REMOTE_SESSION_SECRET` | Optional dedicated signing material, at least 32 UTF-8 bytes. When absent, a domain-separated HMAC key is derived from the existing Ably API key. Rotating either active signing source invalidates existing grants. |
| `REMOTE_TURN_URLS` | Optional comma/space-separated `turn:` / `turns:` URLs, up to four; for example `turn:relay.example:3478,turns:relay.example:5349?transport=tcp`. |
| `REMOTE_TURN_SECRET` | Preferred with a coturn-compatible TURN REST configuration. Generates account-specific credentials that expire with the session. Must be at least 16 characters. |
| `REMOTE_TURN_USERNAME`, `REMOTE_TURN_CREDENTIAL` | Alternative static TURN credentials for providers that require them. These are necessarily delivered to signed-in participants. Prefer scoped, expiring credentials when available. |

Without TURN, the application provides a public STUN server and reports `relayConfigured: false`. A direct connection may work but is not reliable across restrictive corporate networks, symmetric NAT, or blocked UDP. Do not present STUN-only configuration as guaranteed remote access. Invalid or incomplete relay configuration returns an actionable unavailable state rather than silently ignoring it.

Ably errors return a generic connection failure and are not logged verbatim, because provider exceptions may contain request or authorization data. Request-origin checks are an additional browser boundary; the signed-in account and signed role credential remain mandatory.

## Input contract

Each native input event carries a strictly increasing positive safe integer `seq`. Accepted input types are normalized `move`, explicit `button` and `key` down/up states, bounded integer `scroll` deltas from -20 to 20, and `text` limited to 1,000 UTF-16 characters / 4,000 UTF-8 bytes. Unknown fields, nonfinite numbers, off-screen coordinates, unsupported key names, NUL text, and duplicate or old sequences are refused. The native layer validates again; passing browser validation does not confer native authority.

All keyboard/button states must be released on disconnect, control revocation, lease expiry, capture errors, and emergency stop. Screenshots alone do not grant control. The host's capture permission, explicit helper approval, and live native control lease are separate conditions.

## Verification and remaining platform checks

`npx vitest run lib/remote/auth.test.ts lib/remote/protocol.test.ts app/api/remote/session/route.test.ts` verifies account/role binding, forged and expired credentials, channel capabilities, late-join expiry, bounded input/replay, upload limits, origin/auth checks, provider failures, and TURN credential generation without calling live providers.

The automatic native build publishes an explicitly installed preview. It does not update existing stable installations. Before promoting remote assistance as device-verified, run the complete product flow on both supported host operating systems:

1. Start a host session, choose each available display, and join from a different signed-in device/network.
2. Confirm a waiting helper cannot view or control anything before host approval. Join a second helper and confirm it cannot receive the approved peer's screen or signaling.
3. Match the helper code, approve, and exercise pointer corners, display scaling, negative monitor origins, mouse buttons, scrolling, modifiers, and Unicode text in a disposable editor.
4. Revoke control while a modifier/button is held; verify input releases immediately. Repeat for network loss, capture failure, window close, local emergency stop, and session expiry.
5. Deny screen capture and input permissions, then grant them through OS settings. Confirm the app gives a recoverable error and never reports control as enabled while native permission is missing.
6. Verify both direct and TURN-relayed connections and confirm the interface distinguishes unavailable relay setup. Confirm no invitation, frame, input, or relay secret appears in logs or analytics.

Web deployment updates the hosted UI; it does not replace an installed native binary. Native capture/input changes require a new desktop package, platform build verification, and the project's existing signing/release process.

Provider references: [Ably capabilities](https://ably.com/docs/auth/capabilities), [Ably identified clients](https://ably.com/docs/auth/identified-clients).
