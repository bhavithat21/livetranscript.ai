---
version: alpha
name: LiveTranscript
colors:
  background: '#f5f2e9'
  foreground: '#25271f'
  reader: '#ffffff'
  primary: '#a53c25'
  primary-hover: '#8d2e1c'
  accent: '#dde873'
  muted: '#65685b'
  line: '#e1dfd4'
  danger: '#b91c1c'
  dark-background: '#161812'
  dark-foreground: '#f3f1e7'
  dark-primary-text: '#dde873'
fonts:
  body: 'Geist Sans'
  technical: 'Geist Mono'
---

# LiveTranscript — studio identity and live-edge reading

## Visual direction
The September 25 studio direction supersedes the blue/indigo palette. Use warm
ivory, ink charcoal, terracotta actions and restrained citrus. No blue branding,
links, speaker indicators or focus treatment. The user can retain their own
uploaded identity; do not silently overwrite custom names or custom icons.

Symbol Studio informs oversized editorial typography and a consistent symbolic
identity. Awwwards' Lando Norris and Sonar Music references inform confident
composition, deliberate interactions and motion that serves the narrative.
These are references, not copied trademarks, assets, source or page content.

The new owned caption mark uses open brackets, short transcript lines and a live
dot. `lib/brand/mark.ts` owns vector geometry, `BrandMark` renders it, `app/icon.svg`
is the server favicon, and `public/brand/icon.png` matches the default preference
and client favicon. Native installer identities are released separately.

## Ownership and contrast
`app/globals.css` owns semantic tokens, themes, focus, controls and scrolling.
CSS modules consume the tokens. Marketing signal artwork and the charcoal Live
stage intentionally use fixed warm variants. Color and animation are never the
only way to express capture state, an error or an action.

Dark-mode citrus text must not be used as a background under a white label.
`--primary-fill` remains terracotta; `--signal` is the accessible text accent.
Validate ink, muted, accent, button and hover contrast in light/dark. Preserve
native high-contrast controls. Red labels remain reserved for stop/failure.

## Typography, layout and motion
Geist Sans and Geist Mono stay self-hosted through Next Font. Keep the interface
readable instead of introducing several decorative font families. Public home
uses larger tight-tracked headlines, numbered workflow rows, a symbolic poster,
and clear section rhythm. Product routes preserve restrained controls, bounded
transcript measure and readable code. Never shrink transcript text to fit a
fixed side drawer.

`WorkspaceShell` remains the single tool-navigation owner. Existing paths,
settings, capture permissions and stored user text are not rewritten. Historical
shared documents use natural page scrolling; active transcripts have one
explicit scroll owner. Every page must work from 375 through 2560 CSS px.

Motion is progressive enhancement: SSR/no-JS text stays visible. Once-per-entry
reveal and a finite signal entrance do not intercept wheel/touch or add a render
loop. A Pause motion button and live `prefers-reduced-motion` changes disable
motion. No parallax during Live, forced scrolling of the marketing page, fake
live recordings, unverified metrics, fabricated testimonials or silent autoplay.

## Latest transcript contract
`useFollowLatest` treats follow as state, not as a near-bottom measurement after
content has grown. Incoming batches, interim-to-final revisions, resize/font
changes and reopened Live rails pin to the newest text immediately. There is no
smooth-scroll animation queue and no time-based crawl that falls behind speech.

A deliberate upward wheel/touch/key/scrollbar gesture pauses following so a user
can inspect history. Show Jump to latest; returning to the bottom or pressing
End resumes. Layout-triggered scroll events do not masquerade as user intent.
Static archives never auto-scroll. Readable grouping must preserve every word.

Live answers still advance to the latest entry by default; explicit history
navigation is respected. This is not a new backend synchronization service.

## Verification
`qa/refinement` renders the real home/AppNav, shared reader, Audio settings,
TranscriptView and ChatView with authored examples. CI loads actual Next-built
Geist fonts. Test 42 presentation layouts plus 28 live layouts (7 sizes, both
themes), burst updates, revised finals, history pause/resume, text reflow and
motion preferences. `qa/coach` additionally tests the real integrated Live rail.
Browser fixtures do not establish microphone, provider or physical-device quality.
