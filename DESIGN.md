---
version: alpha
name: LiveTranscript
description: A precise conversation workspace with calm navigation and readable live answers.
colors:
  background: '#f5f7fb'
  foreground: '#172033'
  reader: '#ffffff'
  primary: '#2563eb'
  muted: '#5f6d82'
  line: '#e2e8f0'
  danger: '#b91c1c'
  dark-background: '#0d1422'
  dark-foreground: '#e8eef8'
  dark-primary: '#8bb0ff'
typography:
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
  display:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
  technical:
    fontFamily: 'ui-monospace, monospace'
rounded:
  control: '0.5rem'
  panel: '0.75rem'
spacing:
  page-inset: '1rem'
  panel-padding: '1.25rem'
  navigation-width: '224px'
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

This redesign follows the user's complete-site rebuild request and supplied
LiveTranscript reference. The product should feel like a careful technical tool:
compact navigation, strong reading hierarchy, distinct live and preparation
surfaces, and clear actions. The old warm serif / translucent pill system is
intentionally replaced across public and product routes in the same release.

The signature is the contrast between a pale, quiet workspace and a navy live
stage. Blue means an action or selection; green means an actual live/positive
state. The public site shows an explicitly illustrative product view, never
fabricated customer statistics, model results, testimonials, or live status.

Public routes can use larger typography and spacious sections. Product pages
prioritize the next action and reading density. English is the UI language;
user text uses normal Unicode font fallbacks. No new locale or market support
is implied.

**Ownership: model B.** `app/globals.css` owns runtime semantic tokens, controls,
themes and scrollbars. `app/layout.tsx` owns font loading. This file records
accepted values and rationale. CSS modules consume those tokens; they do not
own another copy of the shared palette. The fixed navy live stage and explicitly
illustrative marketing preview are deliberate business variants.

## Colors

`--paper` is the surrounding work surface, `--reader` is a solid content panel,
and `--ink` is main text. `--muted` remains readable at small sizes. `--line` and
`--line-strong` separate panels and controls. `--surface-soft`, `--sidebar`, and
`--hover-surface` organize the shell. `--accent-soft` and `--signal` show selection.

Buttons consume `--primary-fill`, not the text accent: in dark mode the bright
text accent must not become a background underneath white text. Dark button fill
is #315bd1, hover #3b68e1; dark surfaces are #0d1422 / #121d30 and text #e8eef8.
Semantic red is reserved for failure, stop and destructive actions. State is
always described in text as well as color.

Web dark mode uses solid surfaces. The native `lt-desktop` overlay retains its
separate transparent outer background and title-bar reservation. Shared workspace
navigation remains opaque enough to read. Focus mode is a reading preference;
the design makes no invisibility or proctoring compatibility claim.

## Typography

IBM Plex Sans is shared by the wordmark, headings, paragraphs and controls, with
weights 400/500/600/700. `--font-serif` is retained only as a compatibility alias
to `--font-body` for focused reading routes. No serif font is loaded.

Page titles are compact and semibold, usually 24–32px. Answer text has a relaxed
line height and a bounded reading width. Monospace is for code, measured timings,
and shortcuts. Long titles wrap; bounded navigation may truncate custom identity
text with the complete name available in its title and appearance settings.

## Layout

`WorkspaceShell` is the single navigation owner for Interview, AI workspace,
Repository, Practice, Transcripts, Remote assist and Settings. It uses a 224px
sticky sidebar from 1024px, with its own scroll when necessary. On smaller
screens a labeled in-flow disclosure provides all destinations; it closes on
Escape/outside pointer and restores keyboard focus on Escape. It is not a modal.
A skip link reaches the workspace content.

Live, Mock Lab and Feedback are deep-linked views of the same mounted interview
workspace. Capture continues during view changes. A page-owned navigation guard
can block departure through shared navigation. The shell must not own audio or
provider state. Recording, meeting and session reading surfaces retain a compact
HomeMenu so a large sidebar does not compete with the transcript.

Each page owns content scrolling. Long settings, Mock Lab and review forms keep
natural document height. Only the standalone desktop AI workspace is bounded to
the viewport, with an internal conversation scroller and reachable composer.
The setup rail is 15rem on wide displays and a disclosure at intermediate widths.
On phones the document scrolls normally. Form/action rows wrap; screen media
preserves its pixel aspect ratio. Native title-bar offsets remain respected.

## Elevation & Depth

Solid panels and thin borders carry structure. Shared `.glass` is a compatibility
class for solid web chrome with a minimal shadow; it no longer causes translucent
reading layers. Floating menus/dialogs may have stronger elevation. Buttons do
not jump on hover. The native overlay retains its platform-specific glass rule.

## Shapes

Shared buttons use 8px corners, panels usually 12px. Small status badges may be
pills. Do not use the same large pill shape for navigation, text fields, headings,
and every action. Icons are Lucide line icons paired with text; the waveform
brand mark uses a small blue square. Custom app names/icons remain user preferences.

## Components

| Semantic value | Runtime owner | Consumers |
|---|---|---|
| Background / foreground / reader | `--paper`, `--ink`, `--reader` | pages, panels, text |
| Muted / border | `--muted`, `--line`, `--line-strong` | secondary text, panel and field edges |
| Primary action | `--primary-fill`, `--primary-hover` | `.btn-signal` |
| Selected / focus | `--signal`, `--accent-soft` | navigation, focus outlines, tabs |
| Danger | `--stop`, `.btn-stop` | error text, stop / final deletion |
| Fonts | `--font-body`, compatibility `--font-serif` | all routes |
| Controls | `--radius-control`, shared `.btn-*` | ordinary actions |
| Navigation | WorkspaceShell and HomeMenu | full and focused product shells |
| Scrollbar | global scrollbar tokens and baseline | all owned overflow regions |

Native select and file picker popups are intentionally platform-owned. Controls
retain hover/focus/pressed/disabled/busy states, minimum 44px primary touch targets,
associated labels, and accessible status/error feedback. Reduced motion disables
decorative animation; meaning never depends on animation. Destructive dialogs
name the data and consequence, initially focus Cancel and restore focus.

## Do's and Don'ts

- Keep live actions, Stop and permission revocation visible.
- Distinguish saved sessions from an illustrative preview and actual metrics from promises.
- Keep source, resume and job-description context discoverable without burying the answer.
- Use the same labels, settings, navigation and response preferences across routes.
- Do not add fake scores, testimonials, model-speed guarantees, or active billing without a working flow.
- Do not report mocked audio or browser-only collaboration as a physical device test.

## Reconciled visual drift

| Previous rule / drift | Rebuild decision |
|---|---|
| Warm paper, serif headings and teal glass pills | Intentional site-wide migration to cool surfaces, IBM Plex Sans, blue actions and solid borders |
| Each product route owned a different sidebar or HomeMenu | WorkspaceShell is canonical for tool pages; HomeMenu remains the focused-reading variant |
| Selected button fill reused a light dark-mode text token | Separate primary-fill from signal text to preserve contrast |
| Public home described mainly transcription | Explain actual Live / AI / repository / practice / Mock Lab workflows and link directly |
| Library had an unbounded card collection | Bounded local pages over the 200 rows returned by the current API |

The migration preserves storage, permission, provider and capture contracts.
`UX-CONTRACT.md` owns behavior; `premium-ui.json` scopes static verification.
