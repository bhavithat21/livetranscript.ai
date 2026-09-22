---
version: alpha
name: LiveTranscript
description: A readable conversation workspace with quiet glass controls and precise technical context.
colors:
  background: '#faf9f7'
  foreground: '#16151a'
  reader: '#fffdf9'
  primary: '#0f766e'
  danger: '#b91c1c'
  dark-background: '#121216'
  dark-foreground: '#f0efed'
  dark-primary: '#34d399'
typography:
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
  display:
    fontFamily: 'Fraunces, Georgia, serif'
  technical:
    fontFamily: 'ui-monospace, monospace'
rounded:
  control: '9999px'
  panel: '1rem'
  section: '1.5rem'
spacing:
  page-inset: '1rem'
  panel-padding: '1.25rem'
  content-max: '64rem'
components:
  primary-button:
    backgroundColor: '{colors.primary}'
    textColor: '#ffffff'
    rounded: '{rounded.control}'
  reader:
    backgroundColor: '{colors.reader}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.panel}'
---

# LiveTranscript design

## Overview

The reference is a technical reading desk: a warm paper surface, a serif heading,
plain working text, and translucent controls around the document. Technical users
must read an answer or act on a connection while talking. Product routes favor
familiar controls, short labels, and persistent status over promotional imagery.
The home/pricing routes retain their existing marketing register.

The signature is Fraunces with teal accents and glass chrome. Avoid neon dashboards,
oversized decorative cards, and low-contrast text over the shared screen. Remote
control and appearance extend the existing Settings/Library patterns.

The standalone AI workspace adds a setup rail beside a bounded reading column.
Audio context is an optional top rail. On small screens, setup collapses so the
question composer remains the primary action. Reading surfaces stay solid;
Focus mode is a visual preference and carries no invisibility guarantee.

The UI is currently English. System font fallbacks render user-supplied names and
technical content; this is not a claim of fully localized product flows. No market
or jurisdiction is inferred from the language.

**Ownership:** model B. `app/globals.css` and `app/layout.tsx` are canonical runtime
sources. This file records accepted values and their use; it does not generate CSS.
No rebrand was introduced by the remote-assistance feature.

## Colors

Paper (`--paper`), ink (`--ink`) and reader (`--reader`) separate reading content
from controls. `--signal` means a primary action or active state. `--stop` means an
error or stop action; status always includes words, not only color.

`html.lt-dark` switches to a solid dark reading surface. `html.lt-desktop` uses the
existing transparent dark overlay. Preserve these distinct background models.
Forced-colors mode uses native scrollbar colors and ordinary focus outlines.

## Typography

Fraunces is for page titles and the wordmark. IBM Plex Sans, weights 400/500/600,
is for controls and body copy. Monospace is reserved for helper codes, shortcuts
and source code. Body copy uses relaxed line height; labels remain sentence case.
Long custom names wrap in previews and truncate only where navigation is bounded.

## Layout

Focused routes use HomeMenu and a natural document scroller. Remote assist uses a
64rem maximum width with 1rem mobile insets, 2rem at the small breakpoint. The
selected screen keeps its pixel aspect ratio; input coordinates use that visible
surface. Forms are natural height, with no viewport-sized clipping shell.

Controls have at least a 44px touch height. Action rows wrap on narrow screens.
Errors and statuses have dedicated space near the action they explain. App chrome
respects the native title bar offset. Host approval and stop remain visible as
separate actions.

## Elevation & Depth

Use existing `.glass` for chrome and `.reader-surface` for dense reading content.
The glass token includes a subtle border, blur and shadow. Do not stack additional
translucent surfaces behind paragraphs. The actual shared screen is unfiltered.

## Shapes

Pill buttons and inputs match existing settings/navigation. Panels use 1rem or
1.5rem radii. Display choices are bordered radio rows. The screen has a rounded
outer frame without distorting its pixels. Icons remain Lucide line icons.

## Components

| Contract token | Runtime owner | Consumers |
|---|---|---|
| background / foreground | `--paper` / `--ink` in globals.css | page and body text |
| primary / danger | `--signal` / `--stop` in globals.css | state labels, focus, errors |
| reader | `--reader`, `.reader-surface` | readable notices |
| body / display | `--font-body` / `--font-serif` in layout.tsx | forms, titles, wordmark |
| control | `.btn-signal`, `.btn-ghost`, `.btn-stop` | existing and new actions |
| scrollbar | `--scroll-thumb`, `--scroll-track`, global baseline | all scroll containers |

Buttons retain hover, pressed, keyboard focus, disabled and busy feedback. Disable
duplicate permission mutations; End session stays actionable. Status and error
text use live regions. A working operation may use an honest text status without
an artificial percentage or decorative spinner.

Native radio groups and file pickers are intentional: their platform behavior is
appropriate for display selection and a local PNG/JPEG icon. No new custom select
or modal primitive is needed. Inline messages stay visible until corrected.

Lucide icons supplement text; decorative icons are aria-hidden. The shared screen
is the only application-style keyboard region, with Escape returning to ordinary
page navigation. Motion follows existing short button transitions and reduced
motion rules; connection status never depends on animation.

Product copy says what happened, where it happened, and how to recover. Distinguish
an app/window appearance update from rebuilding the installed desktop identity.
Never describe an untested connection as live or an unmeasured latency as instant.

## Do's and Don'ts

- Do keep complete file names, helper codes and permission outcomes readable.
- Do reuse the existing CSS and native/browser theme distinction.
- Do keep remote control visibly revocable from the laptop.
- Don't use a color or icon as the sole permission indicator.
- Don't add a marketing hero or unrelated visual system to settings.
- Don't claim a live native-device test from a mocked browser test.

### Reconciled drift

| Existing inconsistency | Resolution in this feature |
|---|---|
| Settings and the compact desktop picker owned separate names | One canonical app identity; compatibility wrapper for existing callers |
| HomeMenu hardcoded the brand while Wordmark used a preference | Both consume the same identity |
| No shared scrollbar baseline | Global theme tokens, standards CSS plus WebKit fallback |

Other existing screens have not undergone a full UI migration. The focused audit
scope is recorded in `premium-ui.json`.

## Interview reference integration

The supplied product reference informs a quiet sidebar, compact sans-serif
workspace titles, bordered answer/result cards, and a transcript rail. Live,
Mock Lab and Feedback share one shell; existing paper/ink/teal runtime tokens
remain canonical across light and dark themes. Mock controls remain in document
flow on small screens. Factual session summaries replace illustrative percentages.
Settings uses the same compact navigation with Profile, AI answers, Audio and
Appearance sections backed by real preferences.
